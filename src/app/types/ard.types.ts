/**
 * Canonical Agentic Resource Discovery (ARD) types.
 *
 * Mirrors the ai-catalog.json schema and the registry REST API shapes. See
 * documentation/plans/implementation-plan.md §5.1 and the vault notes
 * "AI Catalog (ai-catalog.json)" and "Agent Registry (ARD)".
 */

/** IANA media types an ARD catalog entry can advertise. */
export enum ArdMediaType {
    AiSkill = 'application/ai-skill',
    McpServerCard = 'application/mcp-server-card+json',
    A2aAgentCard = 'application/a2a-agent-card+json',
    AiCatalog = 'application/ai-catalog+json',
    AiRegistry = 'application/ai-registry+json'
}

/** Current ai-catalog.json format version. */
export const ARD_SPEC_VERSION = '1.0'

/** Media type of an ai-catalog.json document. */
export const AI_CATALOG_CONTENT_TYPE = 'application/ai-catalog+json'

/** Identity/host of the catalog operator. */
export interface HostInfo {
    displayName: string
    /** DID ("did:web:…") or plain domain ("dsebastien.net"). */
    identifier?: string
    documentationUrl?: string
    logoUrl?: string
}

/**
 * One catalog entry. Exactly one of `url | data` must be present (the spec
 * enforces this as a `oneOf`).
 */
export interface CatalogEntry {
    /** urn:air:<publisher>(:<segment>)+ */
    identifier: string
    displayName: string
    /** IANA media type (see {@link ArdMediaType}). */
    type: string
    /** Where to fetch the full artifact (mutually exclusive with `data`). */
    url?: string
    /** The full artifact document inline (mutually exclusive with `url`). */
    data?: Record<string, unknown>
    description?: string
    tags?: string[]
    /** Explicit capability/skill names for fast filtering. */
    capabilities?: string[]
    /** 2–5 natural-language example queries. */
    representativeQueries?: string[]
    version?: string
    /** ISO 8601 date-time. */
    updatedAt?: string
    /** Non-standard extension fields are tolerated (x-* prefix). */
    [key: `x-${string}`]: unknown
}

/** The ai-catalog.json document. */
export interface AiCatalog {
    specVersion: typeof ARD_SPEC_VERSION
    host?: HostInfo
    entries: CatalogEntry[]
}

// ===== Registry REST API =====

export type FilterObject = Record<string, string | string[]>

export interface ArdSearchRequest {
    query: { text: string; filter?: FilterObject }
    federation?: 'auto' | 'referrals' | 'none'
    pageSize?: number
    pageToken?: string
}

/** A search result: a catalog entry plus relevance scoring. */
export interface SearchResultItem extends CatalogEntry {
    /** 0–100, relevance only — explicitly NOT a trust/safety rating. */
    score: number
    /** Registry base URL the result came from. */
    source: string
}

export interface ArdSearchResponse {
    results: SearchResultItem[]
    pageToken?: string
}

export interface ArdListResponse {
    items: CatalogEntry[]
    total?: number
    pageToken?: string
}

export interface ArdErrorResponse {
    errorCode: string
    message: string
}
