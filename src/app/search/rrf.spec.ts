import { describe, it, expect } from 'bun:test'
import { reciprocalRankFusion, fusedToArdScores, RRF_K } from './rrf'

describe('reciprocalRankFusion', () => {
    it('favours being top-in-one-list over middle-in-both', () => {
        const bm25 = ['a', 'b', 'c']
        const vec = ['c', 'b', 'a']
        const fused = reciprocalRankFusion([bm25, vec])
        // a and c are each top in one list; b is middle in both. RRF's convexity
        // (1/60 + 1/62 > 2/61) ranks the agreed-middle b last.
        expect(fused[fused.length - 1]?.id).toBe('b')
        expect(fused.map((f) => f.id).sort()).toEqual(['a', 'b', 'c'])
    })

    it('includes ids present in only one list', () => {
        const fused = reciprocalRankFusion([['a'], ['b']])
        expect(fused.map((f) => f.id).sort()).toEqual(['a', 'b'])
    })

    it('an id agreed top by both lists beats one ranked top by a single list', () => {
        const fused = reciprocalRankFusion([
            ['a', 'x'],
            ['a', 'y']
        ])
        expect(fused[0]?.id).toBe('a')
        expect(fused[0]?.rrf).toBeCloseTo(2 / (RRF_K + 0), 6)
    })

    it('returns nothing for empty input', () => {
        expect(reciprocalRankFusion([])).toEqual([])
        expect(reciprocalRankFusion([[], []])).toEqual([])
    })
})

describe('fusedToArdScores', () => {
    it('maps the best match to 85 and preserves order', () => {
        const scored = fusedToArdScores([
            { id: 'a', rrf: 0.1 },
            { id: 'b', rrf: 0.05 },
            { id: 'c', rrf: 0.01 }
        ])
        expect(scored.map((s) => s.id)).toEqual(['a', 'b', 'c'])
        expect(scored[0]?.score).toBe(85)
        expect(scored[2]?.score).toBeGreaterThanOrEqual(1)
        expect(scored[1]?.score).toBeLessThan(85)
    })

    it('gives a lone result a full score rather than dividing by zero', () => {
        expect(fusedToArdScores([{ id: 'a', rrf: 0.3 }])).toEqual([{ id: 'a', score: 85 }])
    })

    it('preserves order when every result ties (span 0) instead of flattening to 85', () => {
        const scored = fusedToArdScores([
            { id: 'a', rrf: 0.2 },
            { id: 'b', rrf: 0.2 },
            { id: 'c', rrf: 0.2 }
        ])
        expect(scored.map((s) => s.id)).toEqual(['a', 'b', 'c'])
        expect(scored.map((s) => s.score)).toEqual([85, 84, 83]) // gently decreasing
    })

    it('handles an empty list', () => {
        expect(fusedToArdScores([])).toEqual([])
    })
})
