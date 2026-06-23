/** One indexed vector keyed by catalog-entry identifier. */
export interface VectorRecord {
    id: string
    /** L2-normalised embedding (so cosine similarity == dot product). */
    vector: Float32Array
}

/** A ranked vector hit: identifier + cosine similarity in [-1, 1]. */
export interface VectorHit {
    id: string
    score: number
}

/**
 * In-memory nearest-neighbour store over L2-normalised embeddings.
 *
 * Pure and synchronous — the embedding work happens upstream in the
 * {@link Embedder}; this just holds the vectors and ranks them by cosine
 * similarity (a dot product, since inputs are unit vectors). A brute-force scan
 * is ample for catalogs of a few hundred short entries.
 */
export class VectorStore {
    private records: VectorRecord[] = []

    /** Replace the entire vector set (e.g. after a reindex). */
    replace(records: VectorRecord[]): void {
        this.records = records
    }

    get size(): number {
        return this.records.length
    }

    /** Entries ranked by descending cosine similarity, capped at `limit`. */
    query(vector: Float32Array, limit = this.records.length): VectorHit[] {
        const hits: VectorHit[] = this.records.map((record) => ({
            id: record.id,
            score: dot(vector, record.vector)
        }))
        hits.sort((a, b) => b.score - a.score)
        return limit >= hits.length ? hits : hits.slice(0, limit)
    }
}

/** Dot product; with unit-length inputs this equals cosine similarity. */
function dot(a: Float32Array, b: Float32Array): number {
    const n = Math.min(a.length, b.length)
    let sum = 0
    for (let i = 0; i < n; i++) {
        sum += (a[i] ?? 0) * (b[i] ?? 0)
    }
    return sum
}
