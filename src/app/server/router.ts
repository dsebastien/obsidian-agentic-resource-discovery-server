import { z } from 'zod'
import type { CatalogService } from '../catalog/catalog-service'
import { handleMcpMessage } from '../mcp/mcp-server'
import type { SearchBackend, SearchFilter } from '../search/search-backend'
import type { SkillFileService } from '../skills/skill-file-server'
import type { ArdErrorResponse, SearchResultItem } from '../types/ard.types'

/**
 * The registry router: a pure function from a transport-agnostic request to a
 * transport-agnostic response.
 *
 * All endpoint behaviour — auth, CORS, catalog serving, search, listing — lives
 * here and is exercised directly in tests. {@link ArdHttpServer} is a thin
 * node:http adapter that translates sockets to/from these shapes. Nothing here
 * touches the network, which is what makes the whole surface testable.
 */

/** Header keys are lowercased; `path` is the pathname only (no query string). */
export interface RegistryRequest {
    method: string
    path: string
    query: URLSearchParams
    headers: Record<string, string>
    body: string
}

export interface RegistryResponse {
    status: number
    headers: Record<string, string>
    /** String for JSON/text responses; bytes for served skill files. */
    body: string | Uint8Array
}

export interface RouterDeps {
    catalog: CatalogService
    search: SearchBackend
    skillFiles: SkillFileService
    bearerToken: string
    /** Registry base URL, surfaced as `source` on each search result. */
    baseUrl: string
    enableCors: boolean
}

export type RouteHandler = (req: RegistryRequest) => Promise<RegistryResponse>

const SearchBodySchema = z.object({
    query: z.object({
        text: z.string().min(1),
        filter: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional()
    }),
    federation: z.enum(['auto', 'referrals', 'none']).optional(),
    pageSize: z.number().int().positive().max(100).optional(),
    pageToken: z.string().optional()
})

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 20

export function createRouter(deps: RouterDeps): RouteHandler {
    return async (req: RegistryRequest): Promise<RegistryResponse> => {
        if (req.method === 'OPTIONS') {
            return { status: 204, headers: corsHeaders(deps), body: '' }
        }

        // ----- Public routes (no auth) -----
        if (req.method === 'GET' && req.path === '/.well-known/ai-catalog.json') {
            // The ARD spec mandates Content-Type: application/json for the
            // catalog (its conceptual media type is application/ai-catalog+json).
            return json(deps, 200, deps.catalog.toCatalog())
        }
        if (req.method === 'GET' && req.path === '/health') {
            return json(deps, 200, { status: 'ok' })
        }

        // ----- Everything else requires the bearer token -----
        if (!isAuthenticated(req, deps.bearerToken)) {
            return errorResponse(deps, 401, 'UNAUTHENTICATED', 'Missing or invalid bearer token', {
                'www-authenticate': 'Bearer realm="ard-registry"'
            })
        }

        if (req.method === 'POST' && req.path === '/search') {
            return handleSearch(deps, req)
        }
        if (req.method === 'POST' && req.path === '/explore') {
            return errorResponse(
                deps,
                501,
                'NOT_IMPLEMENTED',
                'The /explore endpoint is not supported by this registry.'
            )
        }
        if (req.method === 'GET' && req.path === '/agents') {
            return handleAgents(deps, req)
        }
        if (req.method === 'GET' && req.path.startsWith('/skills/')) {
            return handleSkillFile(deps, req)
        }
        if (req.method === 'POST' && req.path === '/mcp') {
            return handleMcp(deps, req)
        }

        return errorResponse(deps, 404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`)
    }
}

async function handleMcp(deps: RouterDeps, req: RegistryRequest): Promise<RegistryResponse> {
    let parsed: unknown
    try {
        parsed = JSON.parse(req.body || 'null')
    } catch {
        return json(deps, 200, {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' }
        })
    }

    const mcpDeps = { catalog: deps.catalog, search: deps.search, skillFiles: deps.skillFiles }

    if (Array.isArray(parsed)) {
        const responses = (
            await Promise.all(parsed.map((m) => handleMcpMessage(m, mcpDeps)))
        ).filter((r) => r !== null)
        return responses.length > 0
            ? json(deps, 200, responses)
            : { status: 202, headers: corsHeaders(deps), body: '' }
    }

    const response = await handleMcpMessage(parsed, mcpDeps)
    return response
        ? json(deps, 200, response)
        : { status: 202, headers: corsHeaders(deps), body: '' }
}

async function handleSkillFile(deps: RouterDeps, req: RegistryRequest): Promise<RegistryResponse> {
    const rest = req.path.slice('/skills/'.length)
    const slash = rest.indexOf('/')

    // GET /skills/<name> → bundle manifest
    if (slash === -1) {
        const name = safeDecode(rest)
        const manifest = name === null ? null : await deps.skillFiles.manifest(name)
        return manifest
            ? json(deps, 200, manifest)
            : errorResponse(deps, 404, 'NOT_FOUND', `Unknown skill: ${rest}`)
    }

    // GET /skills/<name>/<relPath> → bundled file
    const name = safeDecode(rest.slice(0, slash))
    if (name === null) {
        return errorResponse(deps, 400, 'INVALID_ARGUMENT', 'Malformed skill name.')
    }
    const relPath = rest.slice(slash + 1)
    const result = await deps.skillFiles.file(name, relPath)
    if (result === 'not-found') {
        return errorResponse(deps, 404, 'NOT_FOUND', `Not found: ${req.path}`)
    }
    if (result === 'forbidden') {
        return errorResponse(
            deps,
            403,
            'PERMISSION_DENIED',
            'File is outside the skill or not a served type.'
        )
    }
    return {
        status: 200,
        headers: { 'content-type': result.contentType, ...corsHeaders(deps) },
        body: result.body
    }
}

function safeDecode(value: string): string | null {
    try {
        return decodeURIComponent(value)
    } catch {
        return null
    }
}

async function handleSearch(deps: RouterDeps, req: RegistryRequest): Promise<RegistryResponse> {
    let parsed: unknown
    try {
        parsed = JSON.parse(req.body || '{}')
    } catch {
        return errorResponse(deps, 400, 'INVALID_ARGUMENT', 'Request body is not valid JSON.')
    }

    const result = SearchBodySchema.safeParse(parsed)
    if (!result.success) {
        const issue = result.error.issues[0]
        const where = issue?.path.join('.') || 'body'
        return errorResponse(deps, 400, 'INVALID_ARGUMENT', `Invalid search request (${where}).`)
    }

    const { query, pageSize } = result.data
    const hits = await deps.search.search({
        query: query.text,
        limit: pageSize ?? 10,
        filter: toBackendFilter(query.filter)
    })
    const results: SearchResultItem[] = hits.map((hit) => ({
        ...hit.entry,
        score: hit.score,
        source: deps.baseUrl
    }))
    return json(deps, 200, { results })
}

function handleAgents(deps: RouterDeps, req: RegistryRequest): RegistryResponse {
    const typeFilter = req.query.get('type')
    let items = deps.catalog.listAll()
    if (typeFilter) {
        items = items.filter((entry) => entry.type === typeFilter)
    }
    const total = items.length

    const pageSize = clamp(
        Number.parseInt(req.query.get('pageSize') ?? '', 10) || DEFAULT_PAGE_SIZE,
        1,
        MAX_PAGE_SIZE
    )
    const offset = decodePageToken(req.query.get('pageToken'))
    const page = items.slice(offset, offset + pageSize)
    const nextOffset = offset + pageSize
    const pageToken = nextOffset < total ? encodePageToken(nextOffset) : undefined

    return json(deps, 200, { items: page, total, ...(pageToken ? { pageToken } : {}) })
}

// ----- Helpers -----

function isAuthenticated(req: RegistryRequest, token: string): boolean {
    return token.length > 0 && req.headers['authorization'] === `Bearer ${token}`
}

function toBackendFilter(filter?: Record<string, string | string[]>): SearchFilter | undefined {
    if (!filter) {
        return undefined
    }
    const asArray = (value: string | string[]): string[] => (Array.isArray(value) ? value : [value])
    const result: SearchFilter = {}
    if (filter['type'] !== undefined) result.type = asArray(filter['type'])
    if (filter['tags'] !== undefined) result.tags = asArray(filter['tags'])
    if (filter['capabilities'] !== undefined) result.capabilities = asArray(filter['capabilities'])
    return result
}

function corsHeaders(deps: RouterDeps): Record<string, string> {
    if (!deps.enableCors) {
        return {}
    }
    return {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'Content-Type, Authorization, mcp-session-id'
    }
}

function json(
    deps: RouterDeps,
    status: number,
    body: unknown,
    contentType = 'application/json'
): RegistryResponse {
    return {
        status,
        headers: {
            'content-type': `${contentType}; charset=utf-8`,
            ...corsHeaders(deps)
        },
        body: JSON.stringify(body)
    }
}

function errorResponse(
    deps: RouterDeps,
    status: number,
    errorCode: string,
    message: string,
    extraHeaders: Record<string, string> = {}
): RegistryResponse {
    const body: ArdErrorResponse = { errorCode, message }
    const res = json(deps, status, body)
    return { ...res, headers: { ...res.headers, ...extraHeaders } }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

function encodePageToken(offset: number): string {
    return Buffer.from(String(offset), 'utf-8').toString('base64')
}

function decodePageToken(token: string | null): number {
    if (!token) {
        return 0
    }
    const decoded = Number.parseInt(Buffer.from(token, 'base64').toString('utf-8'), 10)
    return Number.isInteger(decoded) && decoded >= 0 ? decoded : 0
}
