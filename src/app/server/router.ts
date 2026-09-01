import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { LocalArtifactStore } from '../artifacts/local-artifact-store'
import type { CatalogService } from '../catalog/catalog-service'
import { handleMcpMessage } from '../mcp/mcp-server'
import { matchesFilter } from '../search/search-utils'
import type { SearchBackend, SearchFilter } from '../search/search-backend'
import type { SkillFileService } from '../skills/skill-file-server'
import {
    ArdMediaType,
    type ArdErrorResponse,
    type CatalogEntry,
    type SearchResultItem
} from '../types/ard.types'

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
    /** URN-bound artifacts (SKILL.md files, subagent definitions). */
    artifacts: LocalArtifactStore
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
    /**
     * Alias of `pageSize`. The MCP `search` tool, `/explore` and the Code Mode
     * `registry.search(query, { limit })` all call it `limit`, and agents carry
     * that name over to REST; before this alias the field was silently dropped
     * and the default page came back. `pageSize` (the ARD spec name) wins when
     * both are present.
     */
    limit: z.number().int().positive().max(100).optional(),
    pageToken: z.string().optional()
})

/** Facets `/explore` can aggregate; also the default set when none is requested. */
const FACET_NAMES = ['type', 'tags', 'capabilities'] as const
type FacetName = (typeof FACET_NAMES)[number]

const ExploreBodySchema = z.object({
    query: z
        .object({
            text: z.string().optional(),
            filter: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional()
        })
        .optional(),
    /** Which facets to aggregate; defaults to all of them. */
    facets: z.array(z.enum(FACET_NAMES)).nonempty().optional(),
    /** Max values returned per facet. */
    limit: z.number().int().positive().max(1000).optional()
})

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 20
const DEFAULT_SEARCH_LIMIT = 10
const DEFAULT_FACET_LIMIT = 100

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

        if (req.method === 'GET' && req.path === '/status') {
            return handleStatus(deps)
        }
        if (req.method === 'POST' && req.path === '/search') {
            return handleSearch(deps, req)
        }
        if (req.method === 'POST' && req.path === '/explore') {
            return handleExplore(deps, req)
        }
        if (req.method === 'GET' && req.path === '/agents') {
            return handleAgents(deps, req)
        }
        if (req.method === 'GET' && req.path.startsWith('/skills/')) {
            return handleSkillFile(deps, req)
        }
        if (req.method === 'GET' && req.path.startsWith('/subagents/')) {
            return handleArtifactRoute(deps, req)
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

    const mcpDeps = { catalog: deps.catalog, search: deps.search, artifacts: deps.artifacts }

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

/** Serve a flat artifact (a subagent definition) by its exact registry route. */
async function handleArtifactRoute(
    deps: RouterDeps,
    req: RegistryRequest
): Promise<RegistryResponse> {
    const result = await deps.artifacts.serveRoute(req.path)
    if (result === 'not-found') {
        return errorResponse(deps, 404, 'NOT_FOUND', `Not found: ${req.path}`)
    }
    if (result === 'forbidden') {
        return errorResponse(deps, 403, 'PERMISSION_DENIED', 'Artifact is outside its root.')
    }
    return {
        status: 200,
        headers: { 'content-type': result.contentType, ...corsHeaders(deps) },
        body: result.body
    }
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

/**
 * Registry readiness for agents and operators: how many entries are served and
 * which search backend answers, including whether its dense signal is live.
 *
 * `/health` stays a public liveness ping; this is the authenticated
 * "is search actually semantic yet?" answer. Semantic backends serve
 * lexical-only results while their embeddings build, and a client couldn't
 * tell that apart from the outside before this endpoint existed.
 *
 * Always HTTP 200 — it is a report, not a probe. `status` is `ok` when the
 * backend can serve queries and no secondary index has failed, `degraded`
 * otherwise (no index yet, or embeddings `failed` → lexical-only for good
 * until a rebuild). A `building` secondary index is still `ok`: search
 * works, it just isn't semantic yet — read `search.embeddings` for that.
 */
function handleStatus(deps: RouterDeps): RegistryResponse {
    const ready = deps.search.isReady()
    const state = deps.search.embeddingState
    const degraded = !ready || state === 'failed'
    return json(deps, 200, {
        status: degraded ? 'degraded' : 'ok',
        catalog: catalogCounts(deps),
        search: {
            backend: deps.search.name,
            ready,
            embeddings: state === undefined ? null : { state, ready: state === 'ready' }
        }
    })
}

function catalogCounts(deps: RouterDeps): Record<string, number> {
    let skills = 0
    let subagents = 0
    const all = deps.catalog.listAll()
    for (const entry of all) {
        if (entry.type === ArdMediaType.AiSkill) skills++
        else if (entry.type === ArdMediaType.AiAgent) subagents++
    }
    return { entries: all.length, skills, subagents, manual: all.length - skills - subagents }
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

    const { query, pageSize, limit } = result.data
    const hits = await deps.search.search({
        query: query.text,
        limit: pageSize ?? limit ?? DEFAULT_SEARCH_LIMIT,
        filter: toBackendFilter(query.filter)
    })
    const results: SearchResultItem[] = hits.map((hit) => ({
        ...hit.entry,
        score: hit.score,
        source: deps.baseUrl
    }))
    return json(deps, 200, { results })
}

/**
 * Facet the catalog: value counts for type/tags/capabilities over the entries
 * that survive an optional query + filter.
 *
 * The narrowing reuses the same seams as `/search` — {@link matchesFilter} for
 * the structured filter and the {@link SearchBackend} for free text — so a facet
 * count always describes exactly the set `/search` would return.
 */
async function handleExplore(deps: RouterDeps, req: RegistryRequest): Promise<RegistryResponse> {
    let parsed: unknown
    try {
        parsed = JSON.parse(req.body || '{}')
    } catch {
        return errorResponse(deps, 400, 'INVALID_ARGUMENT', 'Request body is not valid JSON.')
    }

    const result = ExploreBodySchema.safeParse(parsed)
    if (!result.success) {
        const issue = result.error.issues[0]
        const where = issue?.path.join('.') || 'body'
        return errorResponse(deps, 400, 'INVALID_ARGUMENT', `Invalid explore request (${where}).`)
    }

    const { query, facets, limit } = result.data
    const filter = toBackendFilter(query?.filter)
    let items = deps.catalog.listAll().filter((entry) => matchesFilter(entry, filter))

    const text = query?.text?.trim()
    if (text) {
        // Rank-then-facet: ask for everything that could match so the counts
        // cover the full result set rather than a first page of it.
        const hits = await deps.search.search({
            query: text,
            limit: Math.max(items.length, 1),
            filter
        })
        items = hits.map((hit) => hit.entry)
    }

    const requested = facets ?? FACET_NAMES
    const perFacetLimit = limit ?? DEFAULT_FACET_LIMIT
    const counted: Record<string, FacetValue[]> = {}
    for (const facet of requested) {
        counted[facet] = countFacet(items, facet).slice(0, perFacetLimit)
    }

    return json(deps, 200, { total: items.length, facets: counted })
}

interface FacetValue {
    value: string
    count: number
}

/** Value counts for one facet, most frequent first, ties broken alphabetically. */
function countFacet(entries: CatalogEntry[], facet: FacetName): FacetValue[] {
    const counts = new Map<string, number>()
    for (const entry of entries) {
        const values = facet === 'type' ? [entry.type] : (entry[facet] ?? [])
        for (const value of values) {
            counts.set(value, (counts.get(value) ?? 0) + 1)
        }
    }
    return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

function handleAgents(deps: RouterDeps, req: RegistryRequest): RegistryResponse {
    const filter = queryFilter(req.query)
    const items = deps.catalog.listAll().filter((entry) => matchesFilter(entry, filter))
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
    if (token.length === 0) {
        return false
    }
    const presented = req.headers['authorization']
    if (typeof presented !== 'string') {
        return false
    }
    // Constant-time compare so a wrong token can't be guessed byte-by-byte via
    // response timing. Length is compared first (timingSafeEqual requires equal
    // lengths) — token length is not secret.
    const expected = new TextEncoder().encode(`Bearer ${token}`)
    const actual = new TextEncoder().encode(presented)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/**
 * Build a {@link SearchFilter} from `GET /agents` query params, so listing and
 * searching share one filter vocabulary (type/tags/capabilities, any-match).
 * Values may be repeated (`?tags=a&tags=b`) or comma-separated (`?tags=a,b`).
 */
function queryFilter(query: URLSearchParams): SearchFilter | undefined {
    const filter: SearchFilter = {}
    for (const key of FACET_NAMES) {
        const values = query
            .getAll(key)
            .flatMap((raw) => raw.split(','))
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        if (values.length > 0) {
            filter[key] = values
        }
    }
    return Object.keys(filter).length > 0 ? filter : undefined
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
