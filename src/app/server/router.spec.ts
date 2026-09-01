import { describe, it, expect, beforeEach } from 'bun:test'
import { createRouter, type RegistryRequest } from './router'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalArtifactStore } from '../artifacts/local-artifact-store'
import { CatalogService } from '../catalog/catalog-service'
import { LexicalSearchBackend } from '../search/lexical-search-backend'
import { ArdMediaType, type CatalogEntry } from '../types/ard.types'

const TOKEN = 'test-token'
const BASE_URL = 'http://127.0.0.1:27182'

const ENTRIES: CatalogEntry[] = [
    {
        identifier: 'urn:air:obsidian:skills:git-commit-helper',
        displayName: 'Git Commit Helper',
        type: ArdMediaType.AiSkill,
        url: `${BASE_URL}/skills/git-commit-helper/SKILL.md`,
        description: 'Write a conventional commit message and commit staged changes.',
        capabilities: ['git.commit.write'],
        tags: ['git', 'kind:writer'],
        representativeQueries: ['commit my changes']
    },
    {
        identifier: 'urn:air:obsidian:skills:note-analyzer',
        displayName: 'Note Analyzer',
        type: ArdMediaType.AiSkill,
        url: `${BASE_URL}/skills/note-analyzer/SKILL.md`,
        description: 'Analyze a markdown note.',
        tags: ['notes', 'kind:analyzer']
    },
    {
        identifier: 'urn:air:obsidian:mcp:weather',
        displayName: 'Weather MCP',
        type: ArdMediaType.McpServerCard,
        url: 'http://localhost:9000/card.json',
        description: 'Weather forecasts.',
        tags: ['weather']
    }
]

const fakeSkillFiles = {
    manifest: async (name: string) =>
        name === 'git-commit-helper'
            ? {
                  name,
                  files: [
                      {
                          path: 'SKILL.md',
                          url: `${BASE_URL}/skills/git-commit-helper/SKILL.md`,
                          type: 'text/markdown',
                          size: 7
                      }
                  ]
              }
            : null,
    file: async (name: string, relPath: string) => {
        if (name !== 'git-commit-helper') return 'not-found' as const
        if (relPath.includes('..')) return 'forbidden' as const
        if (relPath === 'SKILL.md') {
            return {
                contentType: 'text/markdown; charset=utf-8',
                body: new TextEncoder().encode('# Skill')
            }
        }
        return 'not-found' as const
    }
}

async function buildRouter() {
    const catalog = new CatalogService({ displayName: 'Test', identifier: 'obsidian' })
    catalog.replaceEntries(ENTRIES)
    const search = new LexicalSearchBackend()
    await search.index(ENTRIES)
    return createRouter({
        catalog,
        search,
        skillFiles: fakeSkillFiles,
        artifacts: new LocalArtifactStore(),
        bearerToken: TOKEN,
        baseUrl: BASE_URL,
        enableCors: true
    })
}

function routerDeps(search: LexicalSearchBackend) {
    const catalog = new CatalogService({ displayName: 'Test', identifier: 'obsidian' })
    catalog.replaceEntries(ENTRIES)
    return {
        catalog,
        search,
        skillFiles: fakeSkillFiles,
        artifacts: new LocalArtifactStore(),
        bearerToken: TOKEN,
        baseUrl: BASE_URL,
        enableCors: true
    }
}

/** A lexical backend that records the `limit` each search was asked for. */
function spyBackend() {
    const seen: number[] = []
    class SpyBackend extends LexicalSearchBackend {
        override async search(request: Parameters<LexicalSearchBackend['search']>[0]) {
            seen.push(request.limit ?? -1)
            return super.search(request)
        }
    }
    const spy = new SpyBackend()
    return { spy, seen }
}

function req(
    over: Partial<RegistryRequest> & Pick<RegistryRequest, 'method' | 'path'>
): RegistryRequest {
    return {
        query: new URLSearchParams(),
        headers: {},
        body: '',
        ...over
    }
}

function authed(
    over: Partial<RegistryRequest> & Pick<RegistryRequest, 'method' | 'path'>
): RegistryRequest {
    return req({ ...over, headers: { authorization: `Bearer ${TOKEN}`, ...over.headers } })
}

describe('registry router', () => {
    let handle: Awaited<ReturnType<typeof buildRouter>>

    beforeEach(async () => {
        handle = await buildRouter()
    })

    it('answers CORS preflight with 204 and CORS headers', async () => {
        const res = await handle(req({ method: 'OPTIONS', path: '/search' }))
        expect(res.status).toBe(204)
        expect(res.headers['access-control-allow-origin']).toBe('*')
    })

    it('serves the public catalog without auth', async () => {
        const res = await handle(req({ method: 'GET', path: '/.well-known/ai-catalog.json' }))
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toContain('application/json')
        expect(res.headers['access-control-allow-origin']).toBe('*')
        const body = JSON.parse(res.body as string)
        expect(body.specVersion).toBe('1.0')
        expect(body.entries).toHaveLength(3)
    })

    it('serves a public health check', async () => {
        const res = await handle(req({ method: 'GET', path: '/health' }))
        expect(res.status).toBe(200)
        expect(JSON.parse(res.body as string).status).toBe('ok')
    })

    it('requires auth for GET /status', async () => {
        const res = await handle(req({ method: 'GET', path: '/status' }))
        expect(res.status).toBe(401)
    })

    it('reports catalog size and search backend on GET /status', async () => {
        const res = await handle(authed({ method: 'GET', path: '/status' }))
        expect(res.status).toBe(200)
        const body = JSON.parse(res.body as string)
        expect(body.status).toBe('ok')
        expect(body.catalog.entries).toBe(3)
        expect(body.search.backend).toBe('lexical')
        expect(body.search.ready).toBe(true)
        // The lexical backend has no dense signal, so no embedding state at all.
        expect(body.search.embeddings).toBeNull()
    })

    it('tracks the embedding state across requests on GET /status', async () => {
        // A backend whose state is a real getter (like SemanticSearchBackend),
        // not a data property snapshotted at construction time.
        class StatefulBackend extends LexicalSearchBackend {
            state: 'building' | 'ready' | 'failed' = 'building'
            get embeddingState() {
                return this.state
            }
        }
        const search = new StatefulBackend()
        await search.index(ENTRIES)
        const handleSemantic = createRouter({ ...routerDeps(search) })

        let body = JSON.parse(
            (await handleSemantic(authed({ method: 'GET', path: '/status' }))).body as string
        )
        expect(body.status).toBe('ok') // still searchable, just lexical-only
        expect(body.search.embeddings).toEqual({ state: 'building', ready: false })

        search.state = 'ready'
        body = JSON.parse(
            (await handleSemantic(authed({ method: 'GET', path: '/status' }))).body as string
        )
        expect(body.search.embeddings).toEqual({ state: 'ready', ready: true })

        search.state = 'failed'
        body = JSON.parse(
            (await handleSemantic(authed({ method: 'GET', path: '/status' }))).body as string
        )
        expect(body.status).toBe('degraded')
        expect(body.search.embeddings).toEqual({ state: 'failed', ready: false })
    })

    it('reports degraded on GET /status when the backend has no index yet', async () => {
        const search = new LexicalSearchBackend() // never indexed
        const handleCold = createRouter({ ...routerDeps(search) })
        const body = JSON.parse(
            (await handleCold(authed({ method: 'GET', path: '/status' }))).body as string
        )
        expect(body.status).toBe('degraded')
        expect(body.search.ready).toBe(false)
    })

    it('serves a subagent definition on GET /subagents/<name>.md, bearer-gated', async () => {
        const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ard-router-')))
        writeFileSync(join(dir, 'editor.md'), '---\ndescription: d\n---\nYou are the editor.')
        const artifacts = new LocalArtifactStore([
            {
                urn: 'urn:air:obsidian:subagents:editor',
                path: join(dir, 'editor.md'),
                root: dir,
                contentType: 'text/markdown; charset=utf-8',
                route: '/subagents/editor.md'
            }
        ])
        const search = new LexicalSearchBackend()
        await search.index(ENTRIES)
        const handleAgents = createRouter({ ...routerDeps(search), artifacts })

        expect(
            (await handleAgents(req({ method: 'GET', path: '/subagents/editor.md' }))).status
        ).toBe(401)
        const res = await handleAgents(authed({ method: 'GET', path: '/subagents/editor.md' }))
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toContain('text/markdown')
        expect(new TextDecoder().decode(res.body as Uint8Array)).toContain('You are the editor.')
        expect(
            (await handleAgents(authed({ method: 'GET', path: '/subagents/nope.md' }))).status
        ).toBe(404)
        expect(
            (await handleAgents(authed({ method: 'GET', path: '/subagents/../editor.md' }))).status
        ).toBe(404)
    })

    it('counts families on GET /status', async () => {
        const catalog = new CatalogService({ displayName: 'Test', identifier: 'obsidian' })
        catalog.replaceEntries([
            ...ENTRIES,
            {
                identifier: 'urn:air:obsidian:subagents:editor',
                displayName: 'Editor',
                type: ArdMediaType.AiAgent,
                url: `${BASE_URL}/subagents/editor.md`
            }
        ])
        const search = new LexicalSearchBackend()
        await search.index(catalog.listAll())
        const handleMixed = createRouter({ ...routerDeps(search), catalog })
        const body = JSON.parse(
            (await handleMixed(authed({ method: 'GET', path: '/status' }))).body as string
        )
        expect(body.catalog).toEqual({ entries: 4, skills: 2, subagents: 1, manual: 1 })
    })

    it('rejects search without a bearer token', async () => {
        const res = await handle(
            req({ method: 'POST', path: '/search', body: JSON.stringify({ query: { text: 'x' } }) })
        )
        expect(res.status).toBe(401)
    })

    it('rejects search with a wrong bearer token', async () => {
        const res = await handle(
            req({
                method: 'POST',
                path: '/search',
                headers: { authorization: 'Bearer nope' },
                body: JSON.stringify({ query: { text: 'x' } })
            })
        )
        expect(res.status).toBe(401)
    })

    it('runs an authenticated search and returns ranked ARD results', async () => {
        const res = await handle(
            authed({
                method: 'POST',
                path: '/search',
                body: JSON.stringify({ query: { text: 'commit staged changes' } })
            })
        )
        expect(res.status).toBe(200)
        const body = JSON.parse(res.body as string)
        expect(body.results[0].identifier).toBe('urn:air:obsidian:skills:git-commit-helper')
        expect(typeof body.results[0].score).toBe('number')
        expect(body.results[0].source).toBe(BASE_URL)
    })

    it('applies search filters from the request body', async () => {
        const res = await handle(
            authed({
                method: 'POST',
                path: '/search',
                body: JSON.stringify({
                    query: { text: 'weather forecast', filter: { type: 'application/ai-skill' } }
                })
            })
        )
        const body = JSON.parse(res.body as string)
        expect(body.results.every((r: { type: string }) => r.type === 'application/ai-skill')).toBe(
            true
        )
    })

    it('forwards pageSize to the search backend on POST /search', async () => {
        const { spy, seen } = spyBackend()
        const handleSpy = createRouter({ ...routerDeps(spy) })
        await handleSpy(
            authed({
                method: 'POST',
                path: '/search',
                body: JSON.stringify({ query: { text: 'anything' }, pageSize: 3 })
            })
        )
        expect(seen).toEqual([3])
    })

    it('accepts limit as an alias of pageSize on POST /search', async () => {
        // The MCP search tool, /explore and the Code Mode registry all say
        // `limit`; agents carry that name over to REST. Honour it instead of
        // silently returning the default page.
        const { spy, seen } = spyBackend()
        const handleSpy = createRouter({ ...routerDeps(spy) })
        await handleSpy(
            authed({
                method: 'POST',
                path: '/search',
                body: JSON.stringify({ query: { text: 'anything' }, limit: 7 })
            })
        )
        expect(seen).toEqual([7])
    })

    it('lets pageSize win over limit when both are sent', async () => {
        const { spy, seen } = spyBackend()
        const handleSpy = createRouter({ ...routerDeps(spy) })
        await handleSpy(
            authed({
                method: 'POST',
                path: '/search',
                body: JSON.stringify({ query: { text: 'anything' }, pageSize: 2, limit: 9 })
            })
        )
        expect(seen).toEqual([2])
    })

    it('defaults to 10 results on POST /search when neither pageSize nor limit is sent', async () => {
        const { spy, seen } = spyBackend()
        const handleSpy = createRouter({ ...routerDeps(spy) })
        await handleSpy(
            authed({
                method: 'POST',
                path: '/search',
                body: JSON.stringify({ query: { text: 'anything' } })
            })
        )
        expect(seen).toEqual([10])
    })

    it('rejects an out-of-range limit on POST /search', async () => {
        const res = await handle(
            authed({
                method: 'POST',
                path: '/search',
                body: JSON.stringify({ query: { text: 'note' }, limit: 0 })
            })
        )
        expect(res.status).toBe(400)
        expect(JSON.parse(res.body as string).message).toContain('limit')
    })

    it('rejects a malformed search body with 400 and an error code', async () => {
        const res = await handle(authed({ method: 'POST', path: '/search', body: '{"nope":1}' }))
        expect(res.status).toBe(400)
        expect(JSON.parse(res.body as string).errorCode).toBeDefined()
    })

    it('facets the whole catalog on POST /explore', async () => {
        const res = await handle(authed({ method: 'POST', path: '/explore', body: '{}' }))
        expect(res.status).toBe(200)
        const body = JSON.parse(res.body as string)
        expect(body.total).toBe(3)
        expect(body.facets.type).toEqual([
            { value: 'application/ai-skill', count: 2 },
            { value: 'application/mcp-server-card+json', count: 1 }
        ])
        // Ties are broken alphabetically so the response is deterministic.
        expect(body.facets.tags).toEqual([
            { value: 'git', count: 1 },
            { value: 'kind:analyzer', count: 1 },
            { value: 'kind:writer', count: 1 },
            { value: 'notes', count: 1 },
            { value: 'weather', count: 1 }
        ])
        expect(body.facets.capabilities).toEqual([{ value: 'git.commit.write', count: 1 }])
    })

    it('narrows POST /explore facets with a filter', async () => {
        const res = await handle(
            authed({
                method: 'POST',
                path: '/explore',
                body: JSON.stringify({ query: { filter: { type: 'application/ai-skill' } } })
            })
        )
        const body = JSON.parse(res.body as string)
        expect(body.total).toBe(2)
        expect(body.facets.type).toEqual([{ value: 'application/ai-skill', count: 2 }])
        expect(body.facets.tags.map((f: { value: string }) => f.value)).not.toContain('weather')
    })

    it('narrows POST /explore facets with a query text', async () => {
        const res = await handle(
            authed({
                method: 'POST',
                path: '/explore',
                body: JSON.stringify({ query: { text: 'commit staged changes' } })
            })
        )
        const body = JSON.parse(res.body as string)
        expect(body.total).toBeGreaterThan(0)
        expect(body.facets.capabilities).toEqual([{ value: 'git.commit.write', count: 1 }])
    })

    it('returns only the requested POST /explore facets', async () => {
        const res = await handle(
            authed({ method: 'POST', path: '/explore', body: JSON.stringify({ facets: ['type'] }) })
        )
        const body = JSON.parse(res.body as string) as { facets: Record<string, unknown> }
        expect(Object.keys(body.facets)).toEqual(['type'])
    })

    it('rejects a malformed POST /explore body with 400', async () => {
        const res = await handle(
            authed({ method: 'POST', path: '/explore', body: '{"facets":[123]}' })
        )
        expect(res.status).toBe(400)
        expect(JSON.parse(res.body as string).errorCode).toBeDefined()
    })

    it('requires auth for POST /explore', async () => {
        const res = await handle(req({ method: 'POST', path: '/explore', body: '{}' }))
        expect(res.status).toBe(401)
    })

    it('facets an empty catalog into empty lists', async () => {
        const catalog = new CatalogService({ displayName: 'Empty', identifier: 'obsidian' })
        catalog.replaceEntries([])
        const search = new LexicalSearchBackend()
        await search.index([])
        const empty = createRouter({
            catalog,
            search,
            skillFiles: fakeSkillFiles,
            artifacts: new LocalArtifactStore(),
            bearerToken: TOKEN,
            baseUrl: BASE_URL,
            enableCors: true
        })
        const res = await empty(authed({ method: 'POST', path: '/explore', body: '{}' }))
        expect(res.status).toBe(200)
        const body = JSON.parse(res.body as string)
        expect(body.total).toBe(0)
        expect(body.facets).toEqual({ type: [], tags: [], capabilities: [] })
    })

    it('lists entries deterministically via GET /agents', async () => {
        const res = await handle(authed({ method: 'GET', path: '/agents' }))
        expect(res.status).toBe(200)
        const body = JSON.parse(res.body as string)
        expect(body.total).toBe(3)
        expect(body.items).toHaveLength(3)
    })

    it('filters GET /agents by type', async () => {
        const res = await handle(
            authed({
                method: 'GET',
                path: '/agents',
                query: new URLSearchParams({ type: 'application/mcp-server-card+json' })
            })
        )
        const body = JSON.parse(res.body as string)
        expect(body.total).toBe(1)
        expect(body.items[0].identifier).toBe('urn:air:obsidian:mcp:weather')
    })

    it('filters GET /agents by tags (any-match)', async () => {
        const res = await handle(
            authed({ method: 'GET', path: '/agents', query: new URLSearchParams({ tags: 'git' }) })
        )
        const body = JSON.parse(res.body as string)
        expect(body.total).toBe(1)
        expect(body.items[0].identifier).toBe('urn:air:obsidian:skills:git-commit-helper')
    })

    it('filters GET /agents by capabilities', async () => {
        const res = await handle(
            authed({
                method: 'GET',
                path: '/agents',
                query: new URLSearchParams({ capabilities: 'git.commit.write' })
            })
        )
        const body = JSON.parse(res.body as string)
        expect(body.total).toBe(1)
        expect(body.items[0].identifier).toBe('urn:air:obsidian:skills:git-commit-helper')
    })

    it('accepts comma-separated and repeated filter values on GET /agents', async () => {
        const comma = await handle(
            authed({
                method: 'GET',
                path: '/agents',
                query: new URLSearchParams({ tags: 'git,notes' })
            })
        )
        expect(JSON.parse(comma.body as string).total).toBe(2)

        const repeated = new URLSearchParams()
        repeated.append('tags', 'git')
        repeated.append('tags', 'notes')
        const res = await handle(authed({ method: 'GET', path: '/agents', query: repeated }))
        expect(JSON.parse(res.body as string).total).toBe(2)
    })

    it('combines GET /agents filters with pagination', async () => {
        const query = new URLSearchParams({
            type: 'application/ai-skill',
            tags: 'git,notes',
            pageSize: '1'
        })
        const first = await handle(authed({ method: 'GET', path: '/agents', query }))
        const firstBody = JSON.parse(first.body as string)
        expect(firstBody.total).toBe(2)
        expect(firstBody.items).toHaveLength(1)
        expect(firstBody.pageToken).toBeDefined()

        query.set('pageToken', String(firstBody.pageToken))
        const second = await handle(authed({ method: 'GET', path: '/agents', query }))
        const secondBody = JSON.parse(second.body as string)
        expect(secondBody.total).toBe(2)
        expect(secondBody.items[0].identifier).not.toBe(firstBody.items[0].identifier)
        expect(secondBody.pageToken).toBeUndefined()
    })

    it('returns an empty page when no entry matches the GET /agents filter', async () => {
        const res = await handle(
            authed({
                method: 'GET',
                path: '/agents',
                query: new URLSearchParams({ tags: 'nothing-matches' })
            })
        )
        const body = JSON.parse(res.body as string)
        expect(body.total).toBe(0)
        expect(body.items).toEqual([])
    })

    it('paginates GET /agents with a page token', async () => {
        const first = await handle(
            authed({
                method: 'GET',
                path: '/agents',
                query: new URLSearchParams({ pageSize: '1' })
            })
        )
        const firstBody = JSON.parse(first.body as string)
        expect(firstBody.items).toHaveLength(1)
        expect(firstBody.pageToken).toBeDefined()

        const second = await handle(
            authed({
                method: 'GET',
                path: '/agents',
                query: new URLSearchParams({ pageSize: '1', pageToken: firstBody.pageToken })
            })
        )
        const secondBody = JSON.parse(second.body as string)
        expect(secondBody.items[0].identifier).not.toBe(firstBody.items[0].identifier)
    })

    it('404s an unknown route', async () => {
        const res = await handle(authed({ method: 'GET', path: '/nope' }))
        expect(res.status).toBe(404)
    })

    it('serves a skill bundle manifest', async () => {
        const res = await handle(authed({ method: 'GET', path: '/skills/git-commit-helper' }))
        expect(res.status).toBe(200)
        expect(JSON.parse(res.body as string).files[0].path).toBe('SKILL.md')
    })

    it('serves a skill file with its content type', async () => {
        const res = await handle(
            authed({ method: 'GET', path: '/skills/git-commit-helper/SKILL.md' })
        )
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toContain('text/markdown')
        expect(new TextDecoder().decode(res.body as Uint8Array)).toBe('# Skill')
    })

    it('forbids skill path traversal with 403', async () => {
        const res = await handle(
            authed({ method: 'GET', path: '/skills/git-commit-helper/../secret' })
        )
        expect(res.status).toBe(403)
    })

    it('404s an unknown skill', async () => {
        const res = await handle(authed({ method: 'GET', path: '/skills/unknown' }))
        expect(res.status).toBe(404)
    })

    it('requires auth for skill files', async () => {
        const res = await handle(req({ method: 'GET', path: '/skills/git-commit-helper/SKILL.md' }))
        expect(res.status).toBe(401)
    })

    it('handles an MCP tools/call over POST /mcp', async () => {
        const res = await handle(
            authed({
                method: 'POST',
                path: '/mcp',
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: 'search', arguments: { query: 'commit' } }
                })
            })
        )
        expect(res.status).toBe(200)
        const body = JSON.parse(res.body as string)
        expect(body.result.structuredContent.results[0].identifier).toBe(
            'urn:air:obsidian:skills:git-commit-helper'
        )
    })

    it('returns 202 for an MCP notification', async () => {
        const res = await handle(
            authed({
                method: 'POST',
                path: '/mcp',
                body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
            })
        )
        expect(res.status).toBe(202)
    })

    it('requires auth for /mcp', async () => {
        const res = await handle(req({ method: 'POST', path: '/mcp', body: '{}' }))
        expect(res.status).toBe(401)
    })
})
