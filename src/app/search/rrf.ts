/** A ranked list of ids, best first. */
export type RankedIds = readonly string[]

/** Fused result: identifier + its raw RRF score (pre-normalisation). */
export interface FusedRank {
    id: string
    rrf: number
}

/** Standard RRF dampening constant — keeps any single list from dominating. */
export const RRF_K = 60

/**
 * Reciprocal Rank Fusion of several ranked id lists.
 *
 * Each list contributes `1 / (k + rank)` (rank 0-based) to an id's score, so an
 * id ranked highly by either signal floats up without the two scales needing to
 * be comparable. Ids absent from a list simply contribute nothing from it.
 * Returns every id seen in any list, sorted by descending fused score.
 *
 * See the plan §8.3: `rrf(doc) = 1/(60 + rank_bm25) + 1/(60 + rank_vec)`.
 */
export function reciprocalRankFusion(lists: RankedIds[], k = RRF_K): FusedRank[] {
    const scores = new Map<string, number>()
    for (const list of lists) {
        list.forEach((id, rank) => {
            scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank))
        })
    }
    return [...scores.entries()]
        .map(([id, rrf]) => ({ id, rrf }))
        .sort((a, b) => b.rrf - a.rrf)
}

/**
 * Map fused RRF scores onto the ARD 0–100 relevance scale via min-max
 * normalisation, capping the best match at 85 (matching the lexical backend's
 * headroom so results don't all cluster at 100). Order is preserved.
 */
export function fusedToArdScores(fused: FusedRank[]): Array<{ id: string; score: number }> {
    if (fused.length === 0) {
        return []
    }
    const top = fused[0]?.rrf ?? 0
    const min = fused[fused.length - 1]?.rrf ?? 0
    const span = top - min
    if (span === 0) {
        // Every result tied (e.g. disjoint single-element lists). Keep them all
        // high but gently decreasing so the input order isn't flattened away.
        return fused.map(({ id }, i) => ({ id, score: Math.max(1, 85 - i) }))
    }
    return fused.map(({ id, rrf }) => {
        const normalised = (rrf - min) / span
        return { id, score: Math.min(100, Math.max(1, Math.round(normalised * 85))) }
    })
}
