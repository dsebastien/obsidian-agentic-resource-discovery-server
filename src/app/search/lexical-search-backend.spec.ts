import { describe, it, expect, beforeEach } from 'bun:test'
import { LexicalSearchBackend } from './lexical-search-backend'
import { ArdMediaType, type CatalogEntry } from '../types/ard.types'

const skill = (over: Partial<CatalogEntry>): CatalogEntry => ({
    identifier: 'urn:air:obsidian:skills:placeholder',
    displayName: 'Placeholder',
    type: ArdMediaType.AiSkill,
    url: 'http://127.0.0.1/skills/placeholder/SKILL.md',
    ...over
})

const CORPUS: CatalogEntry[] = [
    skill({
        identifier: 'urn:air:obsidian:skills:git-commit-helper',
        displayName: 'Git Commit Helper',
        description: 'Write a conventional commit message and commit staged changes.',
        tags: ['kind:effect', 'uses-bash'],
        capabilities: ['git.commit.write'],
        representativeQueries: ['commit my changes', 'write a git commit message']
    }),
    skill({
        identifier: 'urn:air:obsidian:skills:note-analyzer',
        displayName: 'Note Analyzer',
        description: 'Analyze a markdown note for structure and readability.',
        tags: ['kind:analyzer'],
        capabilities: ['vault.note.analyze'],
        representativeQueries: ['analyze this note']
    }),
    skill({
        identifier: 'urn:air:obsidian:mcp:weather',
        displayName: 'Weather MCP',
        type: ArdMediaType.McpServerCard,
        url: 'http://localhost:9000/card.json',
        description: 'Fetch current weather and forecasts.',
        tags: ['domain:weather']
    })
]

describe('LexicalSearchBackend', () => {
    let backend: LexicalSearchBackend

    beforeEach(async () => {
        backend = new LexicalSearchBackend()
        await backend.index(CORPUS)
    })

    it('is ready after indexing', () => {
        expect(backend.isReady()).toBe(true)
    })

    it('ranks the most relevant entry first', async () => {
        const results = await backend.search({ query: 'commit staged changes' })
        expect(results[0]?.entry.identifier).toBe('urn:air:obsidian:skills:git-commit-helper')
    })

    it('scores results on a 0-100 scale with headroom at the top', async () => {
        const results = await backend.search({ query: 'commit' })
        expect(results.length).toBeGreaterThan(0)
        for (const r of results) {
            expect(r.score).toBeGreaterThanOrEqual(0)
            expect(r.score).toBeLessThanOrEqual(100)
        }
        // results are sorted by descending score
        const scores = results.map((r) => r.score)
        expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    })

    it('returns no results for a query that matches nothing', async () => {
        expect(await backend.search({ query: 'zzzznonexistentterm' })).toEqual([])
    })

    it('matches representative queries and capabilities, not just the title', async () => {
        const results = await backend.search({ query: 'analyze' })
        expect(results.map((r) => r.entry.identifier)).toContain(
            'urn:air:obsidian:skills:note-analyzer'
        )
    })

    it('filters by entry type', async () => {
        const results = await backend.search({
            query: 'weather forecast',
            filter: { type: [ArdMediaType.AiSkill] }
        })
        expect(results.every((r) => r.entry.type === ArdMediaType.AiSkill)).toBe(true)
        expect(results.map((r) => r.entry.identifier)).not.toContain('urn:air:obsidian:mcp:weather')
    })

    it('honours the result limit', async () => {
        const results = await backend.search({ query: 'a', limit: 1 })
        expect(results.length).toBeLessThanOrEqual(1)
    })

    it('re-indexing replaces the previous corpus', async () => {
        await backend.index([CORPUS[1]!])
        const results = await backend.search({ query: 'commit' })
        expect(results.map((r) => r.entry.identifier)).not.toContain(
            'urn:air:obsidian:skills:git-commit-helper'
        )
    })
})
