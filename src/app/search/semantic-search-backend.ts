import type { CatalogEntry } from '../types/ard.types'
import type { Embedder } from './embedding/embedder'
import { LexicalSearchBackend } from './lexical-search-backend'
import { fusedToArdScores, reciprocalRankFusion } from './rrf'
import type { SearchBackend, SearchFilter, SearchRequest, SearchResult } from './search-backend'
import { VectorStore } from './vector-store'

/** Candidate pool pulled from each signal before fusion (then capped to limit). */
const FUSION_CANDIDATES = 50

/**
 * Hybrid semantic search backend: lexical BM25 fused with dense-vector cosine
 * similarity via Reciprocal Rank Fusion.
 *
 * The {@link Embedder} is injected, so the fusion logic is unit-testable with a
 * deterministic fake; the real implementation lazily downloads an ONNX model.
 * Indexing is two-phase and **never blocks on the model**: the lexical index is
 * built synchronously (so the backend serves immediately — {@link isReady} is
 * true at once), while embeddings build in the background. Until they finish, or
 * if the model fails to load, searches degrade gracefully to lexical-only
 * (plan §8.6). Once ready, results fuse both signals.
 */
export class SemanticSearchBackend implements SearchBackend {
    readonly name = 'semantic'

    private readonly lexical = new LexicalSearchBackend()
    private readonly vectors = new VectorStore()
    /** All indexed entries by id — vector hits may surface entries lexical missed. */
    private entries = new Map<string, CatalogEntry>()
    /** Bumped on every index() so a stale background embed can't clobber a newer one. */
    private generation = 0
    private embeddingTask: Promise<void> = Promise.resolve()
    private embeddingsBuilt = false

    constructor(private readonly embedder: Embedder) {}

    /** Whether the dense-vector signal is live (false → lexical-only fallback). */
    get embeddingsReady(): boolean {
        return this.embeddingsBuilt
    }

    async index(entries: CatalogEntry[]): Promise<void> {
        const generation = ++this.generation
        this.embeddingsBuilt = false
        this.vectors.replace([])
        this.entries = new Map(entries.map((entry) => [entry.identifier, entry]))
        await this.lexical.index(entries)
        this.embeddingTask = this.buildEmbeddings(entries, generation)
    }

    /** Resolves when the in-flight background embedding finishes (or fails). */
    whenEmbeddingsSettled(): Promise<void> {
        return this.embeddingTask
    }

    /** Always true: the lexical signal can serve from the moment index() returns. */
    isReady(): boolean {
        return this.lexical.isReady()
    }

    async search(request: SearchRequest): Promise<SearchResult[]> {
        const query = request.query.trim()
        if (!query) {
            return []
        }
        if (!this.embeddingsBuilt) {
            return this.lexical.search(request)
        }
        return this.fusedSearch(request, query)
    }

    private async fusedSearch(request: SearchRequest, query: string): Promise<SearchResult[]> {
        const limit = request.limit ?? 10
        const lexicalRanked = await this.lexical.search({ query, limit: FUSION_CANDIDATES })
        const lexicalIds = lexicalRanked.map((hit) => hit.entry.identifier)

        let vectorIds: string[] = []
        try {
            const [queryVec] = await this.embedder.embed([query])
            if (queryVec) {
                vectorIds = this.vectors
                    .query(queryVec, FUSION_CANDIDATES)
                    .map((hit) => hit.id)
            }
        } catch {
            // Query embedding failed mid-flight — fall back to the lexical ranking.
            return this.lexical.search(request)
        }

        const fused = reciprocalRankFusion([lexicalIds, vectorIds]).filter((rank) => {
            const entry = this.entries.get(rank.id)
            return entry !== undefined && matchesFilter(entry, request.filter)
        })

        const results: SearchResult[] = []
        for (const { id, score } of fusedToArdScores(fused)) {
            const entry = this.entries.get(id)
            if (entry) {
                results.push({ entry, score })
            }
            if (results.length >= limit) {
                break
            }
        }
        return results
    }

    private async buildEmbeddings(entries: CatalogEntry[], generation: number): Promise<void> {
        try {
            await this.embedder.load()
            const vectors = await this.embedder.embed(entries.map(entryText))
            if (generation !== this.generation) {
                return // a newer index() superseded this run
            }
            this.vectors.replace(
                entries.map((entry, i) => ({
                    id: entry.identifier,
                    vector: vectors[i] ?? new Float32Array(this.embedder.dimensions)
                }))
            )
            this.embeddingsBuilt = true
        } catch {
            // Model load/embed failed — stay lexical-only. Intentionally swallowed.
            if (generation === this.generation) {
                this.embeddingsBuilt = false
            }
        }
    }
}

/** Natural-language projection of an entry used as the embedding input. */
function entryText(entry: CatalogEntry): string {
    return [
        entry.displayName,
        terminalSegment(entry.identifier),
        entry.description ?? '',
        (entry.tags ?? []).join(' '),
        (entry.capabilities ?? []).join(' '),
        (entry.representativeQueries ?? []).join(' ')
    ]
        .filter(Boolean)
        .join('. ')
}

function terminalSegment(urn: string): string {
    const parts = urn.split(':')
    return (parts[parts.length - 1] ?? '').replace(/-/g, ' ')
}

function matchesFilter(entry: CatalogEntry, filter?: SearchFilter): boolean {
    if (!filter) {
        return true
    }
    if (filter.type?.length && !filter.type.includes(entry.type)) {
        return false
    }
    if (filter.tags?.length && !filter.tags.some((tag) => entry.tags?.includes(tag))) {
        return false
    }
    if (
        filter.capabilities?.length &&
        !filter.capabilities.some((cap) => entry.capabilities?.includes(cap))
    ) {
        return false
    }
    return true
}
