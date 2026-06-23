import { describe, it, expect, afterEach } from 'bun:test'
import { ArdHttpServer } from './http-server'
import { createRouter } from './router'
import { CatalogService } from '../catalog/catalog-service'
import { LexicalSearchBackend } from '../search/lexical-search-backend'
import { ArdMediaType, type CatalogEntry } from '../types/ard.types'

const TOKEN = 'integration-token'

const ENTRY: CatalogEntry = {
    identifier: 'urn:air:obsidian:skills:git-commit-helper',
    displayName: 'Git Commit Helper',
    type: ArdMediaType.AiSkill,
    url: 'http://127.0.0.1/skills/git-commit-helper/SKILL.md',
    description: 'Write a conventional commit message.',
    representativeQueries: ['commit my changes']
}

async function startServer(): Promise<ArdHttpServer> {
    const catalog = new CatalogService({ displayName: 'Test', identifier: 'obsidian' })
    catalog.replaceEntries([ENTRY])
    const search = new LexicalSearchBackend()
    await search.index([ENTRY])
    const handler = createRouter({
        catalog,
        search,
        skillFiles: { manifest: async () => null, file: async () => 'not-found' as const },
        bearerToken: TOKEN,
        baseUrl: 'http://127.0.0.1',
        enableCors: true
    })
    const server = new ArdHttpServer(handler)
    await server.start(0) // ephemeral port
    return server
}

describe('ArdHttpServer', () => {
    let server: ArdHttpServer | undefined

    afterEach(async () => {
        await server?.stop()
        server = undefined
    })

    it('binds to an ephemeral loopback port and reports running', async () => {
        server = await startServer()
        expect(server.isRunning).toBe(true)
        expect(server.port).toBeGreaterThan(0)
    })

    it('rejects an oversized request body with 413', async () => {
        server = await startServer()
        const res = await fetch(`http://127.0.0.1:${server.port}/search`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'authorization': `Bearer ${TOKEN}` },
            body: 'x'.repeat(6 * 1024 * 1024) // > 5 MB cap
        })
        expect(res.status).toBe(413)
    })

    it('serves the public catalog over HTTP', async () => {
        server = await startServer()
        const res = await fetch(`http://127.0.0.1:${server.port}/.well-known/ai-catalog.json`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as { specVersion: string; entries: unknown[] }
        expect(body.specVersion).toBe('1.0')
        expect(body.entries).toHaveLength(1)
    })

    it('runs an authenticated search over HTTP', async () => {
        server = await startServer()
        const res = await fetch(`http://127.0.0.1:${server.port}/search`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'authorization': `Bearer ${TOKEN}` },
            body: JSON.stringify({ query: { text: 'commit changes' } })
        })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { results: Array<{ identifier: string }> }
        expect(body.results[0]?.identifier).toBe('urn:air:obsidian:skills:git-commit-helper')
    })

    it('rejects an unauthenticated protected request over HTTP', async () => {
        server = await startServer()
        const res = await fetch(`http://127.0.0.1:${server.port}/search`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: { text: 'x' } })
        })
        expect(res.status).toBe(401)
    })

    it('releases the port on stop so it can be rebound', async () => {
        server = await startServer()
        const port = server.port!
        await server.stop()
        expect(server.isRunning).toBe(false)

        const handler = createRouter({
            catalog: new CatalogService({ displayName: 'T' }),
            search: new LexicalSearchBackend(),
            skillFiles: { manifest: async () => null, file: async () => 'not-found' as const },
            bearerToken: TOKEN,
            baseUrl: 'http://127.0.0.1',
            enableCors: true
        })
        const second = new ArdHttpServer(handler)
        await second.start(port) // must not throw EADDRINUSE
        expect(second.isRunning).toBe(true)
        await second.stop()
    })
})
