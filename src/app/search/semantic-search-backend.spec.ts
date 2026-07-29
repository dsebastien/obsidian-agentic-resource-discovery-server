import { describe, it, expect } from 'bun:test'
import type { CatalogEntry } from '../types/ard.types'
import type { Embedder } from './embedding/embedder'
import type { EmbeddingCache } from './embedding/embedding-cache'
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

/** Wraps an embedder to count load()/embed() work. */
function counting(embedder: Embedder): { embedder: Embedder; loads: number; embedded: number } {
    const counters = {
        loads: 0,
        embedded: 0,
        embedder: {
            ...embedder,
            load: async () => {
                counters.loads++
                await embedder.load()
            },
            embed: async (texts: string[]) => {
                counters.embedded += texts.length
                return embedder.embed(texts)
            }
        }
    }
    return counters
}

/** In-memory embedding cache that survives across backend instances. */
function countingCache(): EmbeddingCache & { vectors: Map<string, Float32Array>; saves: number } {
    return {
        vectors: new Map<string, Float32Array>(),
        saves: 0,
        get(key: string) {
            return this.vectors.get(key)
        },
        set(key: string, vector: Float32Array) {
            this.vectors.set(key, vector)
        },
        async save(keysInUse: string[]) {
            this.saves++
            const keep = new Set(keysInUse)
            for (const key of [...this.vectors.keys()]) {
                if (!keep.has(key)) this.vectors.delete(key)
            }
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

    it('degrades to lexical-only when the embedder fails to load, marking state failed', async () => {
        const backend = new SemanticSearchBackend(failingEmbedder())
        await backend.index(ENTRIES)
        await backend.whenEmbeddingsSettled() // must not throw

        expect(backend.isReady()).toBe(true)
        expect(backend.embeddingsReady).toBe(false)
        expect(backend.embeddingState).toBe('failed')
        const results = await backend.search({ query: 'weather forecast' })
        expect(results[0]?.entry.identifier).toBe('urn:air:obsidian:skills:weather')
    })

    it('flips to failed after repeated query-time embed failures, serving lexical meanwhile', async () => {
        let failQueries = false
        const embedder: Embedder = {
            id: 'flaky-query',
            dimensions: 3,
            isReady: () => true,
            load: async () => {},
            // Build embeds the whole entry set (length > 1); a query embeds 1 text.
            embed: async (texts) => {
                if (failQueries && texts.length === 1) {
                    throw new Error('server died after build')
                }
                return texts.map(() => unit([1, 0, 0]))
            }
        }
        const backend = new SemanticSearchBackend(embedder)
        await backend.index(ENTRIES)
        await backend.whenEmbeddingsSettled()
        expect(backend.embeddingState).toBe('ready')

        failQueries = true
        for (let i = 0; i < 3; i++) {
            const results = await backend.search({ query: 'git' })
            expect(results.length).toBeGreaterThan(0) // lexical fallback keeps serving
        }
        expect(backend.embeddingState).toBe('failed') // now the supervisor will retry
    })

    it('reports embeddingState across the build lifecycle', async () => {
        const backend = new SemanticSearchBackend(fakeEmbedder(() => [1, 0, 0]))
        expect(backend.embeddingState).toBe('idle')
        await backend.index(ENTRIES)
        expect(backend.embeddingState).toBe('building') // synchronous after index()
        await backend.whenEmbeddingsSettled()
        expect(backend.embeddingState).toBe('ready')
    })

    it('keeps state idle for an empty catalog (nothing to build)', async () => {
        const backend = new SemanticSearchBackend(fakeEmbedder(() => [1, 0, 0]))
        await backend.index([])
        await backend.whenEmbeddingsSettled()
        expect(backend.embeddingState).toBe('idle')
    })

    it('recovers to ready when a reindex follows a failed build', async () => {
        // Embedder fails the first load, then succeeds — mimics a server that
        // comes up after the plugin (the supervisor reindexes on failure).
        let failNext = true
        const embedder: Embedder = {
            id: 'flaky',
            dimensions: 3,
            isReady: () => !failNext,
            load: async () => {
                if (failNext) {
                    failNext = false
                    throw new Error('server not up yet')
                }
            },
            embed: async (texts) => texts.map(() => unit([1, 0, 0]))
        }
        const backend = new SemanticSearchBackend(embedder)
        await backend.index(ENTRIES)
        await backend.whenEmbeddingsSettled()
        expect(backend.embeddingState).toBe('failed')

        await backend.index(ENTRIES) // supervisor retry
        await backend.whenEmbeddingsSettled()
        expect(backend.embeddingState).toBe('ready')
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

    it('embeds nothing on a warm start with an unchanged catalog', async () => {
        const cache = countingCache()
        const first = counting(fakeEmbedder(() => [1, 0, 0]))
        const warm = new SemanticSearchBackend(first.embedder, cache)
        await warm.index(ENTRIES)
        await warm.whenEmbeddingsSettled()
        expect(first.embedded).toBe(3)
        expect(cache.saves).toBe(1)

        const second = counting(fakeEmbedder(() => [1, 0, 0]))
        const restarted = new SemanticSearchBackend(second.embedder, cache)
        await restarted.index(ENTRIES)
        await restarted.whenEmbeddingsSettled()

        expect(second.embedded).toBe(0)
        expect(second.loads).toBe(0) // the embedder is never even contacted
        expect(restarted.embeddingState).toBe('ready')
    })

    it('re-embeds only the entry whose text changed', async () => {
        const cache = countingCache()
        const first = counting(fakeEmbedder(() => [1, 0, 0]))
        const backend = new SemanticSearchBackend(first.embedder, cache)
        await backend.index(ENTRIES)
        await backend.whenEmbeddingsSettled()

        const edited = [
            ENTRIES[0] as CatalogEntry,
            ENTRIES[1] as CatalogEntry,
            entry('calendar', { description: 'schedule meetings, events and reminders' })
        ]
        const second = counting(fakeEmbedder(() => [0, 1, 0]))
        const rebuilt = new SemanticSearchBackend(second.embedder, cache)
        await rebuilt.index(edited)
        await rebuilt.whenEmbeddingsSettled()

        expect(second.embedded).toBe(1)
        expect(rebuilt.embeddingState).toBe('ready')
    })

    it('invalidates the cache when the embedding model changes', async () => {
        const cache = countingCache()
        const first = counting(fakeEmbedder(() => [1, 0, 0]))
        const backend = new SemanticSearchBackend(first.embedder, cache)
        await backend.index(ENTRIES)
        await backend.whenEmbeddingsSettled()

        const other = counting({ ...fakeEmbedder(() => [0, 1, 0]), id: 'other-model' })
        const switched = new SemanticSearchBackend(other.embedder, cache)
        await switched.index(ENTRIES)
        await switched.whenEmbeddingsSettled()

        expect(other.embedded).toBe(3)
    })

    it('does not cache anything when the build fails', async () => {
        const cache = countingCache()
        const backend = new SemanticSearchBackend(failingEmbedder(), cache)
        await backend.index(ENTRIES)
        await backend.whenEmbeddingsSettled()
        expect(backend.embeddingState).toBe('failed')
        expect(cache.vectors.size).toBe(0)
        expect(cache.saves).toBe(0)
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
