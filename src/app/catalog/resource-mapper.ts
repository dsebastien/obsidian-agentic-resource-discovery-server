import { buildUrn } from '../domain/urn'
import type { CatalogEntry } from '../types/ard.types'
import type { ManualResource } from '../types/plugin-settings.intf'

/** URN namespace segment per manual resource media type. */
const NAMESPACE_BY_TYPE: Record<ManualResource['type'], string> = {
    'application/mcp-server-card+json': 'mcp',
    'application/a2a-agent-card+json': 'agents',
    'application/ai-catalog+json': 'catalogs',
    'application/ai-registry+json': 'registries'
}

/**
 * Turn user-configured manual resources into catalog entries.
 *
 * Skips anything that can't become a valid entry: disabled resources, blank
 * slug/name, and resources with neither a `url` nor inline `data` (an ARD entry
 * must carry exactly one of the two).
 */
export function manualResourcesToEntries(
    resources: ManualResource[],
    publisher: string
): CatalogEntry[] {
    const entries: CatalogEntry[] = []
    for (const resource of resources) {
        const entry = toEntry(resource, publisher)
        if (entry) {
            entries.push(entry)
        }
    }
    return entries
}

function toEntry(resource: ManualResource, publisher: string): CatalogEntry | null {
    if (!resource.enabled) {
        return null
    }
    const slug = resource.slug.trim()
    const displayName = resource.displayName.trim()
    if (!slug || !displayName) {
        return null
    }

    const hasUrl = typeof resource.url === 'string' && resource.url.trim().length > 0
    const hasData = resource.inlineData !== undefined
    if (!hasUrl && !hasData) {
        return null
    }

    const namespace = NAMESPACE_BY_TYPE[resource.type]
    const entry: CatalogEntry = {
        identifier: buildUrn(publisher, [namespace, slug]),
        displayName,
        type: resource.type
    }
    if (hasUrl) {
        entry.url = resource.url
    } else if (resource.inlineData) {
        entry.data = resource.inlineData
    }
    if (resource.description) {
        entry.description = resource.description
    }
    if (resource.tags.length > 0) {
        entry.tags = resource.tags
    }
    if (resource.capabilities.length > 0) {
        entry.capabilities = resource.capabilities
    }
    if (resource.representativeQueries.length > 0) {
        entry.representativeQueries = resource.representativeQueries
    }
    return entry
}
