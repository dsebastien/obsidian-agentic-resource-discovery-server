import { describe, it, expect } from 'bun:test'
import type { CatalogEntry } from '../types/ard.types'
import type { Embedder } from './embedding/embedder'
import { SemanticSearchBackend } from './semantic-search-backend'

const entry = (id: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
    identifier: `urn:air:obsidian:skills:${id}`,
    displayName: id,
    type: 'application/ai-skill',
    url: `http://127.0.0.1/skills/${id}/SKILL.md`,
    ...over
})

const ENTRIES = [
    entry('git-commit', { description: 'craft git commit messages', tags: ['git'] }),
    entry('weather', { description: 'weather forecast and climate', tags: ['weather'] }),
    entry('calendar', { description: 'schedule meetings and events', tags: ['time'] })
]

/** Embedder driven by an explicit text→vector function; ready immediately. */
function fakeEmbedder(vec: (text: string) => number[], dims = 3): Embedder {
    let ready = false
    return {
        id: 'fake',
        dimensions: dims,
        isReady: () => ready,
        load: async () => {
            ready = true
        },
        embed: async (texts) => texts.map((t) => unit(vec(t)))
    }
}

/** Embedder whose load() always rejects — simulates a failed model download. */
function failingEmbedder(): Embedder {
    return {
        id: 'broken',
        dimensions: 3,
        isReady: () => false,
        load: async () => {
            throw new Error('model download failed')
        },
        embed: async () => {
            throw new Error('not loaded')
        }
    }
}

function unit(values: number[]): Float32Array {
    const v = Float32Array.from(values)
    const norm = Math.hypot(...values) || 1
    for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / norm
    return v
}

describe('SemanticSearchBackend', () => {
    it('serves lexical results immediately, before embeddings finish', async () => {
        const backend = new SemanticSearchBackend(fakeEmbedder(() => [1, 0, 0]))
        await backend.index(ENTRIES) // does not await background embedding
        expect(backend.isReady()).toBe(true)

        const results = await backend.search({ query: 'git commit' })
        expect(results[0]?.entry.identifier).toBe('urn:air:obsidian:skills:git-commit')
        expect(results[0]?.score).toBeGreaterThan(0)
    })

    it('fuses the vector signal once embeddings are ready', async () => {
        // Vectors push "weather" to the top for any query, so fusion must lift it
        // above the pure-lexical winner for a git query.
        const embedder = fakeEmbedder((text) =>
            text.includes('weather') ? [1, 0, 0] : text.startsWith('git') ? [1, 0, 0] : [0, 0, 1]
        )
        const backend = new SemanticSearchBackend(embedder)
        await backend.index(ENTRIES)
        await backend.whenEmbeddingsSettled()

        const results = await backend.search({ query: 'git' })
        const ids = results.map((r) => r.entry.identifier)
        // weather is vector-aligned with the query embedding → fused in near the top.
        expect(ids).toContain('urn:air:obsidian:skills:weather')
        expect(results.every((r) => r.score >= 1 && r.score <= 100)).toBe(true)
    })

    it('respects type/tag filters in fused results', async () => {
        const backend = new SemanticSearchBackend(fakeEmbedder(() => [1, 1, 1]))
        await backend.index(ENTRIES)
        await backend.whenEmbeddingsSettled()

        const results = await backend.search({ query: 'anything', filter: { tags: ['git'] } })
        expect(results).toHaveLength(1)
        expect(results[0]?.entry.identifier).toBe('urn:air:obsidian:skills:git-commit')
    })

    it('caps results at the requested limit', async () => {
        const backend = new SemanticSearchBackend(fakeEmbedder(() => [1, 1, 1]))
        await backend.index(ENTRIES)
        await backend.whenEmbeddingsSettled()
        expect(await backend.search({ query: 'a e i o u', limit: 2 })).toHaveLength(2)
    })

    it('degrades to lexical-only when the embedder fails to load', async () => {
        const backend = new SemanticSearchBackend(failingEmbedder())
        await backend.index(ENTRIES)
        await backend.whenEmbeddingsSettled() // must not throw

        expect(backend.isReady()).toBe(true)
        expect(backend.embeddingsReady).toBe(false)
        const results = await backend.search({ query: 'weather forecast' })
        expect(results[0]?.entry.identifier).toBe('urn:air:obsidian:skills:weather')
    })

    it('never contacts the embedder for an empty catalog', async () => {
        let loads = 0
        const embedder = { ...fakeEmbedder(() => [1, 0, 0]) }
        const counting: typeof embedder = {
            ...embedder,
            load: async () => {
                loads++
                await embedder.load()
            }
        }
        const backend = new SemanticSearchBackend(counting)
        await backend.index([])
        await backend.whenEmbeddingsSettled()
        expect(loads).toBe(0)
        expect(backend.embeddingsReady).toBe(false)
        expect(await backend.search({ query: 'anything' })).toEqual([])
    })

    it('a reindex replaces the prior vectors', async () => {
        const backend = new SemanticSearchBackend(fakeEmbedder(() => [1, 0, 0]))
        await backend.index(ENTRIES)
        await backend.whenEmbeddingsSettled()
        await backend.index([entry('only', { description: 'lonely entry' })])
        await backend.whenEmbeddingsSettled()

        const results = await backend.search({ query: 'lonely' })
        expect(results.map((r) => r.entry.identifier)).toEqual(['urn:air:obsidian:skills:only'])
    })
})
