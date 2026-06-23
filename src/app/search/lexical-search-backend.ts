import MiniSearch from 'minisearch'
import type { CatalogEntry } from '../types/ard.types'
import type { SearchBackend, SearchRequest, SearchResult } from './search-backend'
import { matchesFilter, terminalSegment } from './search-utils'

/** Flattened document indexed by MiniSearch (array fields joined to strings). */
interface IndexDoc {
    id: string
    displayName: string
    name: string
    description: string
    tags: string
    capabilities: string
    representativeQueries: string
}

const SEARCH_FIELDS = [
    'displayName',
    'name',
    'description',
    'capabilities',
    'representativeQueries',
    'tags'
] as const

const FIELD_BOOSTS: Record<string, number> = {
    displayName: 3,
    name: 2.5,
    capabilities: 2.5,
    tags: 2,
    representativeQueries: 1.5,
    description: 1
}

/**
 * Built-in lexical (BM25) search backend powered by MiniSearch.
 *
 * Zero model download, fully in-process, instant. Good enough as the default
 * because catalog entries are short, keyword-rich documents. Raw BM25 scores are
 * normalised onto the ARD 0–100 relevance scale, reserving headroom at the top
 * so results don't all cluster at 100.
 */
export class LexicalSearchBackend implements SearchBackend {
    readonly name = 'lexical'

    private mini = LexicalSearchBackend.createIndex()
    private entries = new Map<string, CatalogEntry>()
    private ready = false

    private static createIndex(): MiniSearch<IndexDoc> {
        return new MiniSearch<IndexDoc>({
            idField: 'id',
            fields: [...SEARCH_FIELDS],
            searchOptions: { boost: FIELD_BOOSTS, fuzzy: 0.2, prefix: true }
        })
    }

    async index(entries: CatalogEntry[]): Promise<void> {
        this.mini = LexicalSearchBackend.createIndex()
        this.entries = new Map(entries.map((entry) => [entry.identifier, entry]))
        this.mini.addAll(entries.map(toIndexDoc))
        this.ready = true
    }

    isReady(): boolean {
        return this.ready
    }

    async search(request: SearchRequest): Promise<SearchResult[]> {
        const query = request.query.trim()
        if (!query) {
            return []
        }
        const limit = request.limit ?? 10
        const raw = this.mini.search(query)
        // MiniSearch can return a genuine score of 0 for some fuzzy/prefix hits;
        // floor the divisor so normalizeScore never divides by zero → NaN.
        const topScore = Math.max(raw[0]?.score ?? 0, Number.EPSILON)

        const results: SearchResult[] = []
        for (const hit of raw) {
            const entry = this.entries.get(hit.id as string)
            if (!entry || !matchesFilter(entry, request.filter)) {
                continue
            }
            results.push({ entry, score: normalizeScore(hit.score, topScore) })
            if (results.length >= limit) {
                break
            }
        }
        return results
    }
}

/** Map a raw BM25 score onto 0–100, with the best match capped at 85. */
function normalizeScore(score: number, topScore: number): number {
    return Math.min(100, Math.max(1, Math.round((score / topScore) * 85)))
}

function toIndexDoc(entry: CatalogEntry): IndexDoc {
    return {
        id: entry.identifier,
        displayName: entry.displayName,
        name: terminalSegment(entry.identifier),
        description: entry.description ?? '',
        tags: (entry.tags ?? []).join(' '),
        capabilities: (entry.capabilities ?? []).join(' '),
        representativeQueries: (entry.representativeQueries ?? []).join(' ')
    }
}

