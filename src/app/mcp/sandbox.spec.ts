import { describe, it, expect } from 'bun:test'
import { runSandbox } from './sandbox'

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
})
