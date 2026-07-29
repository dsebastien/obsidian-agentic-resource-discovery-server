import { describe, it, expect } from 'bun:test'
import { runSandbox } from './sandbox'
import { LexicalSearchBackend } from '../search/lexical-search-backend'
import { ArdMediaType, type CatalogEntry } from '../types/ard.types'

const CATALOG = [
    {
        identifier: 'urn:air:obsidian:skills:git-commit',
        displayName: 'Git Commit Helper',
        type: 'application/ai-skill',
        description: 'Write a conventional commit message and commit staged changes.',
        tags: ['kind:effect'],
        capabilities: ['git.commit.write'],
        representativeQueries: ['commit my changes']
    },
    {
        identifier: 'urn:air:obsidian:skills:note-analyzer',
        displayName: 'Note Analyzer',
        type: 'application/ai-skill',
        description: 'Analyze a markdown note.',
        tags: ['kind:analyzer']
    }
]

describe('runSandbox (Code Mode)', () => {
    it('exposes registry.listAll() over the injected catalog', async () => {
        const result = await runSandbox('return registry.listAll().length', { catalog: CATALOG })
        expect(result).toEqual({ ok: true, value: 2 })
    })

    it('exposes registry.get() by identifier', async () => {
        const result = await runSandbox(
            'return registry.get("urn:air:obsidian:skills:git-commit").displayName',
            { catalog: CATALOG }
        )
        expect(result).toEqual({ ok: true, value: 'Git Commit Helper' })
    })

    it('exposes registry.search() with keyword ranking', async () => {
        const result = await runSandbox('return registry.search("commit").map(r => r.identifier)', {
            catalog: CATALOG
        })
        if (!result.ok) throw new Error(result.error)
        expect(result.value).toContain('urn:air:obsidian:skills:git-commit')
    })

    it('lets code filter and aggregate in one shot', async () => {
        const result = await runSandbox(
            'return registry.listAll({ type: "application/ai-skill" }).filter(e => (e.tags||[]).includes("kind:analyzer")).length',
            { catalog: CATALOG }
        )
        expect(result).toEqual({ ok: true, value: 1 })
    })

    it('returns an error (not a throw) for invalid code', async () => {
        const result = await runSandbox('this is not valid javascript {{{', { catalog: CATALOG })
        expect(result.ok).toBe(false)
    })

    it('enforces a wall-clock timeout on infinite loops', async () => {
        const result = await runSandbox('while (true) {}', { catalog: CATALOG }, { timeoutMs: 300 })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error.toLowerCase()).toContain('time')
    })

    it('has no host access (no fetch, no require, no process)', async () => {
        const result = await runSandbox('return typeof fetch + typeof require + typeof process', {
            catalog: CATALOG
        })
        expect(result).toEqual({ ok: true, value: 'undefinedundefinedundefined' })
    })

    it('filters registry.search() results like the HTTP search filter', async () => {
        const result = await runSandbox(
            'return registry.search("skill", { filter: { tags: ["kind:analyzer"] } }).map(r => r.identifier)',
            { catalog: RANKING_CATALOG }
        )
        if (!result.ok) throw new Error(result.error)
        expect(result.value).toEqual(['urn:air:obsidian:skills:note-analyzer'])
    })

    it('returns full entries with a relevance score', async () => {
        const result = await runSandbox('return registry.search("commit staged changes")[0]', {
            catalog: RANKING_CATALOG
        })
        if (!result.ok) throw new Error(result.error)
        const top = result.value as CatalogEntry & { score: number }
        expect(top.identifier).toBe('urn:air:obsidian:skills:git-commit')
        expect(top.description).toBeDefined()
        expect(top.score).toBeGreaterThan(0)
    })
})

/**
 * Ranking parity: `registry.search` inside the sandbox must order results
 * exactly like the lexical backend that powers `POST /search`, otherwise an
 * agent gets different answers depending on which door it walks through.
 */
const RANKING_CATALOG: CatalogEntry[] = [
    {
        identifier: 'urn:air:obsidian:skills:git-commit',
        displayName: 'Git Commit Helper',
        type: ArdMediaType.AiSkill,
        url: 'http://127.0.0.1:27182/skills/git-commit/SKILL.md',
        description: 'Write a conventional commit message and commit staged changes.',
        tags: ['kind:effect', 'git'],
        capabilities: ['git.commit.write'],
        representativeQueries: ['commit my changes', 'write a commit message']
    },
    {
        identifier: 'urn:air:obsidian:skills:git-rebase',
        displayName: 'Git Rebase Assistant',
        type: ArdMediaType.AiSkill,
        url: 'http://127.0.0.1:27182/skills/git-rebase/SKILL.md',
        description: 'Rebase a branch interactively and resolve conflicts.',
        tags: ['kind:effect', 'git'],
        capabilities: ['git.rebase.write']
    },
    {
        identifier: 'urn:air:obsidian:skills:note-analyzer',
        displayName: 'Note Analyzer',
        type: ArdMediaType.AiSkill,
        url: 'http://127.0.0.1:27182/skills/note-analyzer/SKILL.md',
        description: 'Analyze a markdown note and summarize its structure.',
        tags: ['kind:analyzer', 'notes'],
        representativeQueries: ['analyze this note', 'summarize my markdown skill']
    },
    {
        identifier: 'urn:air:obsidian:skills:daily-note',
        displayName: 'Daily Note Builder',
        type: ArdMediaType.AiSkill,
        url: 'http://127.0.0.1:27182/skills/daily-note/SKILL.md',
        description: 'Create a daily note from a template. A useful markdown skill.',
        tags: ['kind:generator', 'notes']
    },
    {
        identifier: 'urn:air:obsidian:mcp:weather',
        displayName: 'Weather MCP',
        type: ArdMediaType.McpServerCard,
        url: 'http://localhost:9000/card.json',
        description: 'Weather forecasts for a location.',
        tags: ['weather']
    }
]

const RANKING_QUERIES = [
    'commit',
    'commit staged changes',
    'git',
    'markdown note',
    'analyze',
    'weather forecast',
    'note'
]

describe('sandbox registry.search ranking parity', () => {
    it.each(RANKING_QUERIES)('ranks "%s" exactly like the lexical backend', async (query) => {
        const backend = new LexicalSearchBackend()
        await backend.index(RANKING_CATALOG)
        const expected = (await backend.search({ query, limit: 10 })).map((hit) => ({
            identifier: hit.entry.identifier,
            score: hit.score
        }))

        const result = await runSandbox(
            `return registry.search(${JSON.stringify(query)}).map(r => ({ identifier: r.identifier, score: r.score }))`,
            { catalog: RANKING_CATALOG }
        )
        if (!result.ok) throw new Error(result.error)
        expect(result.value).toEqual(expected)
        expect(expected.length).toBeGreaterThan(0)
    })

    it('honours the limit option like the backend does', async () => {
        const backend = new LexicalSearchBackend()
        await backend.index(RANKING_CATALOG)
        const expected = (await backend.search({ query: 'git', limit: 1 })).map(
            (hit) => hit.entry.identifier
        )

        const result = await runSandbox(
            'return registry.search("git", { limit: 1 }).map(r => r.identifier)',
            { catalog: RANKING_CATALOG }
        )
        if (!result.ok) throw new Error(result.error)
        expect(result.value).toEqual(expected)
    })
})
