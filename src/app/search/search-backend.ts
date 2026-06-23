import type { CatalogEntry } from '../types/ard.types'

/**
 * The search seam.
 *
 * Ranks catalog entries by relevance for the registry `POST /search` endpoint.
 * The built-in adapter is {@link LexicalSearchBackend} (BM25, zero download);
 * later milestones add semantic adapters (local model, qmd sidecar, hosted API)
 * behind this same interface. Entries flow in as plain {@link CatalogEntry}; the
 * backend derives whatever index representation it needs internally.
 */

export interface SearchFilter {
    type?: string[]
    tags?: string[]
    capabilities?: string[]
}

export interface SearchRequest {
    query: string
    /** Max results to return (default 10). */
    limit?: number
    filter?: SearchFilter
}

export interface SearchResult {
    entry: CatalogEntry
    /** 0–100, relevance only (per ARD: not a trust/safety rating). */
    score: number
}

export interface SearchBackend {
    /** Stable identifier for the backend kind (e.g. "lexical"). */
    readonly name: string
    /** (Re)build the index from the full entry set. Replaces any prior index. */
    index(entries: CatalogEntry[]): Promise<void>
    /** Return entries ranked by relevance, filtered, capped at `limit`. */
    search(request: SearchRequest): Promise<SearchResult[]>
    /** Whether the backend can currently serve queries. */
    isReady(): boolean
    /**
     * Optional lifecycle of a background secondary index (e.g. embeddings).
     * Lets a supervisor retry a `failed` build without disturbing a `building`
     * one. Backends with only a synchronous index leave this undefined.
     */
    readonly embeddingState?: 'idle' | 'building' | 'ready' | 'failed'
}
