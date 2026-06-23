import type { CatalogEntry } from '../types/ard.types'
import type { SearchFilter } from './search-backend'

/**
 * Shared helpers used by more than one {@link SearchBackend} implementation,
 * kept here so filter semantics and the URN→words projection stay identical
 * across the lexical and semantic backends.
 */

/** The last URN segment, hyphens turned to spaces (e.g. "git commit helper"). */
export function terminalSegment(urn: string): string {
    const parts = urn.split(':')
    return (parts[parts.length - 1] ?? '').replace(/-/g, ' ')
}

/** Whether an entry satisfies a search filter (type/tags/capabilities, any-match). */
export function matchesFilter(entry: CatalogEntry, filter?: SearchFilter): boolean {
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
