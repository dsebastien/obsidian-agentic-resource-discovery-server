import {
    ARD_SPEC_VERSION,
    type AiCatalog,
    type CatalogEntry,
    type HostInfo
} from '../types/ard.types'

/**
 * In-memory catalog of agentic resources.
 *
 * Holds the current set of {@link CatalogEntry} objects (rebuilt whenever skills
 * are rescanned or settings change) and renders the ai-catalog.json document the
 * registry serves. Small interface, single source of truth for "what's in the
 * catalog" — callers and the HTTP handlers cross this one seam.
 */
export class CatalogService {
    private entries = new Map<string, CatalogEntry>()

    constructor(private readonly host: HostInfo) {}

    /** Replace the entire entry set (e.g. after a rescan). */
    replaceEntries(entries: CatalogEntry[]): void {
        this.entries = new Map(entries.map((entry) => [entry.identifier, entry]))
    }

    /** Look up a single entry by its URN identifier. */
    getEntry(identifier: string): CatalogEntry | undefined {
        return this.entries.get(identifier)
    }

    /** All entries, in insertion order. */
    listAll(): CatalogEntry[] {
        return [...this.entries.values()]
    }

    /** Number of entries currently in the catalog. */
    get size(): number {
        return this.entries.size
    }

    /** Render the ai-catalog.json document (a fresh, caller-owned snapshot). */
    toCatalog(): AiCatalog {
        return {
            specVersion: ARD_SPEC_VERSION,
            host: this.host,
            entries: this.listAll()
        }
    }
}
