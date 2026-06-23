import { describe, it, expect } from 'bun:test'
import { VectorStore } from './vector-store'

/** Build an L2-normalised vector from raw numbers. */
function unit(values: number[]): Float32Array {
    const v = Float32Array.from(values)
    const norm = Math.hypot(...values) || 1
    for (let i = 0; i < v.length; i++) {
        v[i] = (v[i] ?? 0) / norm
    }
    return v
}

describe('VectorStore', () => {
    it('ranks entries by cosine similarity to the query', () => {
        const store = new VectorStore()
        store.replace([
            { id: 'a', vector: unit([1, 0]) },
            { id: 'b', vector: unit([0, 1]) },
            { id: 'c', vector: unit([1, 1]) }
        ])

        const ranked = store.query(unit([1, 0]))
        expect(ranked.map((r) => r.id)).toEqual(['a', 'c', 'b'])
        expect(ranked[0]?.score).toBeCloseTo(1, 5)
        expect(ranked[2]?.score).toBeCloseTo(0, 5)
    })

    it('caps results at the requested limit', () => {
        const store = new VectorStore()
        store.replace([
            { id: 'a', vector: unit([1, 0]) },
            { id: 'b', vector: unit([0.9, 0.1]) },
            { id: 'c', vector: unit([0.8, 0.2]) }
        ])
        expect(store.query(unit([1, 0]), 2)).toHaveLength(2)
    })

    it('replace() swaps the whole set', () => {
        const store = new VectorStore()
        store.replace([{ id: 'a', vector: unit([1, 0]) }])
        store.replace([{ id: 'b', vector: unit([1, 0]) }])
        expect(store.query(unit([1, 0])).map((r) => r.id)).toEqual(['b'])
        expect(store.size).toBe(1)
    })

    it('is empty and returns nothing before anything is indexed', () => {
        const store = new VectorStore()
        expect(store.size).toBe(0)
        expect(store.query(unit([1, 0]))).toEqual([])
    })
})
