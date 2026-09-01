import { buildSubagentUrn } from '../domain/urn'
import {
    asString,
    asStringArray,
    asToolList,
    deriveToolTags,
    stripParentheticals,
    toTitleCase
} from '../scan/frontmatter'
import type { ParsedSkill } from '../skills/skill-frontmatter.types'
import { ArdMediaType, type CatalogEntry } from '../types/ard.types'

export interface AgentEntryInput {
    parsed: ParsedSkill
    /** Canonical name: the sanitised file stem. */
    name: string
    publisher: string
    /** URL the registry serves the definition file at. */
    url: string
    /** ISO timestamp fallback (file mtime) when frontmatter lacks one. */
    updatedAt?: string
}

/**
 * Turn a parsed subagent definition into a catalog entry, deterministically.
 *
 * Reads the Claude Code subagent frontmatter (`name`, `description`, `tools` or
 * `allowed-tools`, `model`, `color`) plus the same `metadata.*` block skills
 * carry when present. The body (the system prompt) is never read here; it is
 * served on demand as the artifact.
 */
export function buildAgentEntry(input: AgentEntryInput): CatalogEntry {
    const { frontmatter: fm, h1Title } = input.parsed
    const description = asString(fm.description)?.trim()
    const displayName = humanName(input.name, h1Title)
    const tools = asToolList(fm['tools'] ?? fm['allowed-tools'])
    const model = asString(fm.model)
    const updated = asString(fm.metadata?.updated) ?? asString(fm['updated']) ?? input.updatedAt
    const capability = asString(fm.metadata?.capability)

    const entry: CatalogEntry = {
        identifier: buildSubagentUrn(input.publisher, input.name),
        displayName,
        type: ArdMediaType.AiAgent,
        url: input.url
    }
    if (description) {
        entry.description = description
    }

    const tags = new Set<string>()
    const parts = input.name.split('-').filter(Boolean)
    // `agent-osk-editor` → ns:osk, category:editor; `researcher` → ns:researcher.
    const nsParts = parts[0] === 'agent' ? parts.slice(1) : parts
    if (nsParts[0]) tags.add(`ns:${nsParts[0]}`)
    if (nsParts[1]) tags.add(`category:${nsParts[1]}`)
    if (model) tags.add(`model:${model}`)
    for (const key of ['kind', 'tier', 'effects'] as const) {
        const value = asString(fm.metadata?.[key])
        if (value) tags.add(`${key}:${value}`)
    }
    const capDomain = capability?.split('.')[0]
    if (capDomain) tags.add(`domain:${capDomain}`)
    for (const tag of deriveToolTags(tools)) tags.add(tag)
    entry.tags = [...tags].sort()

    if (capability) {
        entry.capabilities = [capability]
    }
    const queries = deriveAgentQueries(displayName, description)
    if (queries) {
        entry.representativeQueries = queries
    }
    if (updated) {
        entry.updatedAt = updated
        entry.version = updated.slice(0, 10)
    }
    if (model) entry['x-osk-model'] = model
    if (tools.length > 0) entry['x-osk-tools'] = tools
    const color = asString(fm['color'])
    if (color) entry['x-osk-color'] = color
    const dependencies = asStringArray(fm.metadata?.dependencies)
    if (dependencies.length > 0) entry['x-osk-dependencies'] = dependencies

    return entry
}

/** `agent-osk-editor` → `Osk Editor`; an H1 wins when the body has one. */
function humanName(name: string, h1Title: string | null): string {
    if (h1Title && !/^(activation|instructions?|role|system prompt)$/i.test(h1Title.trim())) {
        return stripParentheticals(h1Title)
    }
    const parts = name.split('-').filter(Boolean)
    return toTitleCase((parts[0] === 'agent' ? parts.slice(1) : parts).join('-'))
}

/**
 * 2–5 example queries a user might issue for this persona. Deterministic and
 * cheap: the description's first clause, plus "act as" / "review as" phrasings
 * that match how a session asks for a persona. Returns undefined when fewer
 * than two distinct queries can be formed (the spec asks for 2–5 or none).
 */
export function deriveAgentQueries(
    displayName: string,
    description: string | undefined
): string[] | undefined {
    const queries: string[] = []
    const firstClause = (description ?? '').split(/[.!?]/)[0]?.trim()
    if (firstClause && firstClause.length > 5) {
        // Sentence-case → query-case, but leave acronyms ("CRM operator") alone.
        const second = firstClause.charAt(1)
        const lowered =
            second && second === second.toLowerCase()
                ? firstClause.charAt(0).toLowerCase() + firstClause.slice(1)
                : firstClause
        queries.push(lowered)
    }
    if (displayName) {
        queries.push(`act as ${displayName.toLowerCase()}`)
        queries.push(`review this as ${displayName.toLowerCase()}`)
    }
    const unique = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 5)
    return unique.length >= 2 ? unique : undefined
}
