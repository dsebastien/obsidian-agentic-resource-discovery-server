import { describe, it, expect, beforeEach } from 'bun:test'
import { handleMcpMessage, type McpDeps } from './mcp-server'
import { CatalogService } from '../catalog/catalog-service'
import { LexicalSearchBackend } from '../search/lexical-search-backend'
import { ArdMediaType, type CatalogEntry } from '../types/ard.types'

const ENTRIES: CatalogEntry[] = [
    {
        identifier: 'urn:air:obsidian:skills:git-commit',
        displayName: 'Git Commit Helper',
        type: ArdMediaType.AiSkill,
        url: 'http://127.0.0.1/skills/git-commit/SKILL.md',
        description: 'Write a conventional commit message.',
        representativeQueries: ['commit my changes']
    }
]

async function makeDeps(): Promise<McpDeps> {
    const catalog = new CatalogService({ displayName: 'Test', identifier: 'obsidian' })
    catalog.replaceEntries(ENTRIES)
    const search = new LexicalSearchBackend()
    await search.index(ENTRIES)
    return {
        catalog,
        search,
        executeTimeoutMs: 400,
        skillFiles: {
            manifest: async () => null,
            file: async () => ({
                contentType: 'text/markdown',
                body: new TextEncoder().encode('# Git Commit\nbody')
            })
        }
    }
}

const call = (id: number, name: string, args: object) =>
    handleMcpMessage(
        { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
        deps
    )

let deps: McpDeps

describe('handleMcpMessage', () => {
    beforeEach(async () => {
        deps = await makeDeps()
    })

    it('responds to initialize with server info and tool capability', async () => {
        const res: any = await handleMcpMessage(
            { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
            deps
        )
        expect(res.result.serverInfo.name).toBeDefined()
        expect(res.result.capabilities.tools).toBeDefined()
    })

    it('lists the search, get_skill, and execute tools', async () => {
        const res: any = await handleMcpMessage(
            { jsonrpc: '2.0', id: 2, method: 'tools/list' },
            deps
        )
        const names = res.result.tools.map((t: { name: string }) => t.name)
        expect(names).toEqual(expect.arrayContaining(['search', 'get_skill', 'execute']))
    })

    it('runs the search tool', async () => {
        const res: any = await call(3, 'search', { query: 'commit' })
        expect(res.result.structuredContent.results[0].identifier).toBe(
            'urn:air:obsidian:skills:git-commit'
        )
    })

    it('runs the get_skill tool with body', async () => {
        const res: any = await call(4, 'get_skill', {
            identifier: 'urn:air:obsidian:skills:git-commit',
            include_body: true
        })
        expect(res.result.structuredContent.entry.displayName).toBe('Git Commit Helper')
        expect(res.result.structuredContent.body).toContain('# Git Commit')
    })

    it('runs the execute tool (Code Mode) against the catalog', async () => {
        const res: any = await call(5, 'execute', { code: 'return registry.listAll().length' })
        expect(res.result.structuredContent.result).toBe(1)
        expect(res.result.isError).toBeFalsy()
    })

    it('reports execute errors as tool errors, not RPC errors', async () => {
        const res: any = await call(6, 'execute', { code: 'while(true){}' })
        expect(res.result.isError).toBe(true)
    })

    it('returns null for the initialized notification', async () => {
        const res = await handleMcpMessage(
            { jsonrpc: '2.0', method: 'notifications/initialized' },
            deps
        )
        expect(res).toBeNull()
    })

    it('errors on an unknown method', async () => {
        const res: any = await handleMcpMessage(
            { jsonrpc: '2.0', id: 7, method: 'bogus/method' },
            deps
        )
        expect(res.error.code).toBe(-32601)
    })
})
