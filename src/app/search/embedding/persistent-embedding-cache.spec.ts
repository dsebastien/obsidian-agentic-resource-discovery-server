import { describe, it, expect } from 'bun:test'
import {
    decodeVector,
    embeddingCacheKey,
    encodeVector,
    NullEmbeddingCache
} from './embedding-cache'
import { PersistentEmbeddingCache, type EmbeddingCacheStorage } from './persistent-embedding-cache'

/** In-memory storage standing in for the vault side file. */
function fakeStorage(initial: string | null = null): EmbeddingCacheStorage & {
    data: string | null
    writes: number
} {
    return {
        data: initial,
        writes: 0,
        async read() {
            return this.data
        },
        async write(data: string) {
            this.data = data
            this.writes++
        }
    }
}

const vec = (...values: number[]): Float32Array => Float32Array.from(values)

describe('embeddingCacheKey', () => {
    it('is stable for the same embedder and text', () => {
        expect(embeddingCacheKey('m', 3, 'hello')).toBe(embeddingCacheKey('m', 3, 'hello'))
    })

    it('changes when the text, model, or dimensions change', () => {
        const base = embeddingCacheKey('m', 3, 'hello')
        expect(embeddingCacheKey('m', 3, 'hello!')).not.toBe(base)
        expect(embeddingCacheKey('other-model', 3, 'hello')).not.toBe(base)
        expect(embeddingCacheKey('m', 768, 'hello')).not.toBe(base)
    })
})

describe('vector encoding', () => {
    it('round-trips a vector', () => {
        const original = vec(0.5, -0.25, 1)
        expect([...(decodeVector(encodeVector(original)) ?? [])]).toEqual([...original])
    })

    it('rejects a malformed payload', () => {
        expect(decodeVector('')).toBeNull()
        expect(decodeVector(Buffer.from([1, 2, 3]).toString('base64'))).toBeNull()
    })
})

describe('NullEmbeddingCache', () => {
    it('never returns anything and never throws', async () => {
        const cache = new NullEmbeddingCache()
        cache.set()
        expect(cache.get()).toBeUndefined()
        await cache.save()
    })
})

describe('PersistentEmbeddingCache', () => {
    it('persists vectors and reads them back after a reload', async () => {
        const storage = fakeStorage()
        const cache = new PersistentEmbeddingCache(storage)
        await cache.load()
        cache.set('a', vec(1, 0, 0))
        await cache.save(['a'])

        const reloaded = new PersistentEmbeddingCache(storage)
        await reloaded.load()
        expect([...(reloaded.get('a') ?? [])]).toEqual([1, 0, 0])
    })

    it('drops keys that are no longer in use', async () => {
        const storage = fakeStorage()
        const cache = new PersistentEmbeddingCache(storage)
        await cache.load()
        cache.set('a', vec(1, 0, 0))
        cache.set('b', vec(0, 1, 0))
        await cache.save(['a'])

        expect(cache.size).toBe(1)
        const reloaded = new PersistentEmbeddingCache(storage)
        await reloaded.load()
        expect(reloaded.get('b')).toBeUndefined()
    })

    it('skips the write when nothing changed', async () => {
        const storage = fakeStorage()
        const cache = new PersistentEmbeddingCache(storage)
        await cache.load()
        cache.set('a', vec(1, 0, 0))
        await cache.save(['a'])
        expect(storage.writes).toBe(1)

        await cache.save(['a'])
        expect(storage.writes).toBe(1)
    })

    it('degrades to an empty cache on corrupt or unreadable payloads', async () => {
        const corrupt = new PersistentEmbeddingCache(fakeStorage('not json at all'))
        await corrupt.load()
        expect(corrupt.size).toBe(0)

        const wrongVersion = new PersistentEmbeddingCache(
            fakeStorage(JSON.stringify({ version: 99, vectors: { a: 'AAAA' } }))
        )
        await wrongVersion.load()
        expect(wrongVersion.size).toBe(0)

        const unreadable = new PersistentEmbeddingCache({
            read: async () => {
                throw new Error('EACCES')
            },
            write: async () => undefined
        })
        await unreadable.load()
        expect(unreadable.size).toBe(0)
    })

    it('swallows a failed write (a cache is never load-bearing)', async () => {
        const cache = new PersistentEmbeddingCache({
            read: async () => null,
            write: async () => {
                throw new Error('disk full')
            }
        })
        await cache.load()
        cache.set('a', vec(1, 0, 0))
        await cache.save(['a']) // must not throw
        expect([...(cache.get('a') ?? [])]).toEqual([1, 0, 0])
    })
})
