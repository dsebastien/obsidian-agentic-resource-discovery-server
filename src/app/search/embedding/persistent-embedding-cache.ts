import { decodeVector, encodeVector, type EmbeddingCache } from './embedding-cache'

/**
 * Where a {@link PersistentEmbeddingCache} keeps its bytes.
 *
 * A two-method seam so the cache is unit-testable without Obsidian: the plugin
 * backs it with the vault adapter (a side file next to the plugin), tests back
 * it with a string.
 */
export interface EmbeddingCacheStorage {
    /** Cached payload, or null when nothing has been written yet. */
    read(): Promise<string | null>
    write(data: string): Promise<void>
}

interface CacheFile {
    version: number
    vectors: Record<string, string>
}

const CACHE_VERSION = 1

/**
 * Embedding cache persisted through an injected {@link EmbeddingCacheStorage}.
 *
 * Load it once at startup; from then on it answers synchronously and is written
 * back at the end of a build. Corrupt or unreadable payloads degrade to an empty
 * cache (a slow rebuild), never to an error — a cache is never load-bearing.
 */
export class PersistentEmbeddingCache implements EmbeddingCache {
    private vectors = new Map<string, Float32Array>()
    /** Skip the write when a build was a full cache hit. */
    private dirty = false

    constructor(private readonly storage: EmbeddingCacheStorage) {}

    /** Read the persisted vectors. Safe to call again (replaces the contents). */
    async load(): Promise<void> {
        this.vectors = new Map()
        this.dirty = false
        let raw: string | null
        try {
            raw = await this.storage.read()
        } catch {
            return
        }
        if (!raw) {
            return
        }
        let parsed: unknown
        try {
            parsed = JSON.parse(raw)
        } catch {
            return
        }
        const file = parsed as Partial<CacheFile> | null
        if (!file || file.version !== CACHE_VERSION || typeof file.vectors !== 'object') {
            return
        }
        for (const [key, encoded] of Object.entries(file.vectors ?? {})) {
            if (typeof encoded !== 'string') {
                continue
            }
            const vector = decodeVector(encoded)
            if (vector) {
                this.vectors.set(key, vector)
            }
        }
    }

    get(key: string): Float32Array | undefined {
        return this.vectors.get(key)
    }

    set(key: string, vector: Float32Array): void {
        this.vectors.set(key, vector)
        this.dirty = true
    }

    async save(keysInUse: string[]): Promise<void> {
        const keep = new Set(keysInUse)
        // Pruning is itself a change worth persisting (skills were deleted).
        for (const key of [...this.vectors.keys()]) {
            if (!keep.has(key)) {
                this.vectors.delete(key)
                this.dirty = true
            }
        }
        if (!this.dirty) {
            return
        }
        const vectors: Record<string, string> = {}
        for (const [key, vector] of this.vectors) {
            vectors[key] = encodeVector(vector)
        }
        const file: CacheFile = { version: CACHE_VERSION, vectors }
        try {
            await this.storage.write(JSON.stringify(file))
            this.dirty = false
        } catch {
            // Best-effort: a failed write only costs a rebuild next time.
        }
    }

    /** Number of cached vectors (diagnostics/tests). */
    get size(): number {
        return this.vectors.size
    }
}
