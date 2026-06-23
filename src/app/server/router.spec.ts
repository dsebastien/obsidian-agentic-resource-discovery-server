import { describe, it, expect, beforeEach } from 'bun:test'
import { createRouter, type RegistryRequest } from './router'
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
        representativeQueries: ['commit my changes']
    },
    {
        identifier: 'urn:air:obsidian:skills:note-analyzer',
        displayName: 'Note Analyzer',
        type: ArdMediaType.AiSkill,
        url: `${BASE_URL}/skills/note-analyzer/SKILL.md`,
        description: 'Analyze a markdown note.'
    },
    {
        identifier: 'urn:air:obsidian:mcp:weather',
        displayName: 'Weather MCP',
        type: ArdMediaType.McpServerCard,
        url: 'http://localhost:9000/card.json',
        description: 'Weather forecasts.'
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
        bearerToken: TOKEN,
        baseUrl: BASE_URL,
        enableCors: true
    })
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

    it('rejects a malformed search body with 400 and an error code', async () => {
        const res = await handle(authed({ method: 'POST', path: '/search', body: '{"nope":1}' }))
        expect(res.status).toBe(400)
        expect(JSON.parse(res.body as string).errorCode).toBeDefined()
    })

    it('returns 501 for the optional explore endpoint', async () => {
        const res = await handle(authed({ method: 'POST', path: '/explore', body: '{}' }))
        expect(res.status).toBe(501)
        expect(JSON.parse(res.body as string).errorCode).toBeDefined()
    })

    it('lists entries deterministically via GET /agents', async () => {
        const res = await handle(authed({ method: 'GET', path: '/agents' }))
        expect(res.status).toBe(200)
        const body = JSON.parse(res.body as string)
        expect(body.total).toBe(3)
        expect(body.items).toHaveLength(3)
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
})
