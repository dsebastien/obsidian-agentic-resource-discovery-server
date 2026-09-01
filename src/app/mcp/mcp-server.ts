import type { CatalogService } from '../catalog/catalog-service'
import type { SearchBackend } from '../search/search-backend'
import type { SkillFileService } from '../skills/skill-file-server'
import { runSandbox } from './sandbox'

/**
 * Minimal MCP server over JSON-RPC 2.0 (Streamable HTTP, JSON mode).
 *
 * Implements just what an agent needs — `initialize`, `tools/list`,
 * `tools/call`, and the `initialized` notification — directly, rather than
 * pulling in the full `@modelcontextprotocol/sdk` (large) and its SSE transport.
 *
 * The tools follow the Code Mode pattern (progressive discovery): `search`
 * returns ranked metadata, `get_skill` fetches a single resource (optionally its
 * body), and `execute` runs model-written JavaScript against the catalog in a
 * sandbox — so the model can filter/aggregate without streaming everything
 * through its context window.
 */

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = { name: 'ard-registry', version: '1.0.0' }

export interface McpDeps {
    catalog: CatalogService
    search: SearchBackend
    skillFiles: SkillFileService
    /** Wall-clock limit for the execute sandbox (default 10s). */
    executeTimeoutMs?: number
}

interface JsonRpcMessage {
    jsonrpc: string
    id?: number | string
    method: string
    params?: Record<string, unknown>
}

interface JsonRpcResponse {
    jsonrpc: '2.0'
    id: number | string | null
    result?: unknown
    error?: { code: number; message: string }
}

/** Tools this endpoint exposes, in the order they are advertised. */
export const MCP_TOOL_NAMES = ['search', 'get_skill', 'execute'] as const

const TOOLS = [
    {
        name: 'search',
        description:
            'Search the local ARD registry by natural-language query. Returns ranked results ' +
            '(score 0-100) with metadata but NOT skill bodies — use get_skill for those.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Natural-language description of the need' },
                limit: { type: 'number' },
                filter: {
                    type: 'object',
                    properties: {
                        type: { type: 'array', items: { type: 'string' } },
                        tags: { type: 'array', items: { type: 'string' } },
                        capabilities: { type: 'array', items: { type: 'string' } }
                    }
                }
            },
            required: ['query']
        }
    },
    {
        name: 'get_skill',
        description:
            'Fetch one catalog entry by its URN identifier, optionally including the full SKILL.md body.',
        inputSchema: {
            type: 'object',
            properties: {
                identifier: { type: 'string' },
                include_body: { type: 'boolean' }
            },
            required: ['identifier']
        }
    },
    {
        name: 'execute',
        description:
            'Write JavaScript that calls the registry to discover/filter/aggregate resources in one ' +
            'shot. A `registry` global is pre-injected: registry.search(query, opts?) — same ranking ' +
            'as the search tool, opts = { limit, filter: { type, tags, capabilities } } — ' +
            'registry.get(identifier), registry.listAll(filter?). Return a value; it is JSON-serialized ' +
            'back. Sandboxed: no network, no filesystem, time- and memory-limited. Write plain JS.',
        inputSchema: {
            type: 'object',
            properties: { code: { type: 'string' } },
            required: ['code']
        }
    }
]

/**
 * Handle one JSON-RPC message. Returns a response object, or `null` for
 * notifications (messages without an `id`).
 */
export async function handleMcpMessage(
    message: unknown,
    deps: McpDeps
): Promise<JsonRpcResponse | null> {
    const msg = (message ?? {}) as JsonRpcMessage
    const isNotification = msg.id === undefined
    const id = msg.id ?? null

    if (typeof msg.method !== 'string') {
        return isNotification ? null : err(id, -32600, 'Invalid Request')
    }

    try {
        switch (msg.method) {
            case 'initialize':
                return ok(id, {
                    protocolVersion: PROTOCOL_VERSION,
                    capabilities: { tools: {} },
                    serverInfo: SERVER_INFO
                })
            case 'notifications/initialized':
            case 'notifications/cancelled':
                return null
            case 'ping':
                return ok(id, {})
            case 'tools/list':
                return ok(id, { tools: TOOLS })
            case 'tools/call':
                return ok(id, await callTool(msg.params ?? {}, deps))
            default:
                if (isNotification) return null
                return err(id, -32601, `Method not found: ${msg.method}`)
        }
    } catch (error) {
        return err(id, -32603, error instanceof Error ? error.message : String(error))
    }
}

async function callTool(params: Record<string, unknown>, deps: McpDeps): Promise<unknown> {
    const name = params['name'] as string
    const args = (params['arguments'] as Record<string, unknown>) ?? {}

    switch (name) {
        case 'search':
            return toolSearch(args, deps)
        case 'get_skill':
            return toolGetSkill(args, deps)
        case 'execute':
            return toolExecute(args, deps)
        default:
            return toolError(`Unknown tool: ${name}`)
    }
}

const MAX_SEARCH_LIMIT = 100
const DEFAULT_SEARCH_LIMIT = 10

function clampLimit(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SEARCH_LIMIT
    return Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.trunc(value)))
}

async function toolSearch(args: Record<string, unknown>, deps: McpDeps): Promise<unknown> {
    const query = typeof args['query'] === 'string' ? args['query'] : ''
    // Same contract as POST /search: an integer in 1..100, default 10. Out-of-range
    // values are clamped rather than rejected — a tool call is a conversation, not
    // a wire schema, and "give me 500" should mean "as many as you allow".
    const limit = clampLimit(args['limit'])
    const filter = args['filter'] as
        | { type?: string[]; tags?: string[]; capabilities?: string[] }
        | undefined
    const hits = await deps.search.search({ query, limit, filter })
    const results = hits.map((h) => ({
        identifier: h.entry.identifier,
        displayName: h.entry.displayName,
        type: h.entry.type,
        description: h.entry.description,
        score: h.score
    }))
    return toolResult(`Found ${results.length} result(s).`, { results })
}

async function toolGetSkill(args: Record<string, unknown>, deps: McpDeps): Promise<unknown> {
    const identifier = typeof args['identifier'] === 'string' ? args['identifier'] : ''
    const entry = deps.catalog.getEntry(identifier)
    if (!entry) {
        return toolError(`Not found: ${identifier}`)
    }
    let body: string | undefined
    if (args['include_body'] === true && typeof entry.url === 'string') {
        body = await fetchSkillBody(entry.url, deps)
    }
    return toolResult(entry.displayName, { entry, body })
}

async function toolExecute(args: Record<string, unknown>, deps: McpDeps): Promise<unknown> {
    const code = typeof args['code'] === 'string' ? args['code'] : ''
    const result = await runSandbox(
        code,
        { catalog: deps.catalog.listAll() },
        {
            timeoutMs: deps.executeTimeoutMs
        }
    )
    if (!result.ok) {
        return toolError(`Execution error: ${result.error}`)
    }
    return toolResult(JSON.stringify(result.value, null, 2), { result: result.value })
}

/** Read a skill body via the file service by parsing its /skills/<name>/ URL. */
async function fetchSkillBody(url: string, deps: McpDeps): Promise<string | undefined> {
    const match = url.match(/\/skills\/([^/]+)\/(.+)$/)
    if (!match) return undefined
    const name = safeDecode(match[1]!)
    const relPath = match[2]!
    if (name === null) return undefined
    const file = await deps.skillFiles.file(name, relPath)
    if (file === 'not-found' || file === 'forbidden') return undefined
    return new TextDecoder().decode(file.body)
}

function safeDecode(value: string): string | null {
    try {
        return decodeURIComponent(value)
    } catch {
        return null
    }
}

function toolResult(text: string, structuredContent: unknown): unknown {
    return { content: [{ type: 'text', text }], structuredContent }
}

function toolError(text: string): unknown {
    return { content: [{ type: 'text', text }], isError: true }
}

function ok(id: number | string | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result }
}

function err(id: number | string | null, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } }
}
