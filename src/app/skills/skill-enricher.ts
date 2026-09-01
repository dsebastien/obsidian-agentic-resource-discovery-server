import { buildSkillUrn } from '../domain/urn'
import {
    asFlag,
    asString,
    asStringArray,
    asToolList,
    capitalize,
    deriveToolTags,
    stripParentheticals,
    toTitleCase
} from '../scan/frontmatter'
import { ArdMediaType, type CatalogEntry } from '../types/ard.types'
import type { ParsedSkill, SkillFrontmatter } from './skill-frontmatter.types'

export interface SkillEntryInput {
    parsed: ParsedSkill
    /** Skill folder name (fallback when frontmatter omits `name`). */
    name: string
    publisher: string
    /** URL the registry will serve the SKILL.md at. */
    url: string
    /** ISO timestamp fallback (e.g. file mtime) when frontmatter lacks one. */
    updatedAt?: string
}

/**
 * Turn a parsed SKILL.md into a rich ARD catalog entry — deterministically, with
 * no LLM calls. Frontmatter drives `description`/`capabilities`/`version`;
 * {@link deriveTags} and {@link deriveRepresentativeQueries} synthesize the
 * search-boosting metadata; useful skill internals are preserved as `x-osk-*`
 * extension fields for the MCP Code Mode layer and for filtering.
 *
 * Frontmatter is untrusted: YAML happily produces `Date`s (unquoted timestamps),
 * numbers, and booleans where we expect strings, so every field is coerced via
 * {@link asString} before use. One weird skill must never break a scan.
 */
export function buildSkillEntry(input: SkillEntryInput): CatalogEntry {
    const { frontmatter: fm, h1Title } = input.parsed
    const name = (asString(fm.name) ?? input.name).trim()
    const displayName = h1Title ? stripParentheticals(h1Title) : toTitleCase(name)
    const updated = asString(fm.metadata?.updated) ?? input.updatedAt
    const description = asString(fm.description)
    const capability = asString(fm.metadata?.capability)

    const entry: CatalogEntry = {
        identifier: buildSkillUrn(input.publisher, name),
        displayName,
        type: ArdMediaType.AiSkill,
        url: input.url
    }

    if (description) {
        entry.description = description.trim()
    }
    const tags = deriveTags(fm)
    if (tags.length > 0) {
        entry.tags = tags
    }
    if (capability) {
        entry.capabilities = [capability]
    }
    const queries = deriveRepresentativeQueries(fm, h1Title)
    if (queries) {
        entry.representativeQueries = queries
    }
    if (updated) {
        entry.updatedAt = updated
        entry.version = updated.slice(0, 10)
    }

    // x-osk-* extension fields (non-standard, tolerated by ARD).
    setExt(entry, 'x-osk-kind', asString(fm.metadata?.kind))
    setExt(entry, 'x-osk-tier', asString(fm.metadata?.tier))
    setExt(entry, 'x-osk-effects', asString(fm.metadata?.effects))
    setExt(entry, 'x-osk-effort', asString(fm.effort))
    setExt(entry, 'x-osk-model', asString(fm.model))
    setExt(entry, 'x-osk-argument-hint', asString(fm['argument-hint']))
    const dependencies = asStringArray(fm.metadata?.dependencies)
    if (dependencies.length > 0) {
        entry['x-osk-dependencies'] = dependencies
    }
    entry['x-osk-user-invocable'] = !isInternal(fm)

    return entry
}

/** Derive search/filter tags from frontmatter. */
export function deriveTags(fm: SkillFrontmatter): string[] {
    const tags = new Set<string>()
    const parts = (asString(fm.name) ?? '').split('-').filter(Boolean)

    if (parts[0]) tags.add(`ns:${parts[0]}`)
    if (parts[1]) tags.add(`category:${parts[1]}`)

    addTag(tags, 'kind', asString(fm.metadata?.kind))
    addTag(tags, 'tier', asString(fm.metadata?.tier))
    addTag(tags, 'effects', asString(fm.metadata?.effects))

    const capDomain = asString(fm.metadata?.capability)?.split('.')[0]
    if (capDomain) tags.add(`domain:${capDomain}`)

    for (const noteType of asStringArray(fm.metadata?.['note-types'])) {
        tags.add(`note-type:${noteType}`)
    }

    tags.add(isInternal(fm) ? 'internal' : 'user-invocable')
    if (asString(fm.context) === 'fork') tags.add('runs-as-subagent')

    for (const tag of deriveToolTags(asToolList(fm['allowed-tools']))) tags.add(tag)

    return [...tags].sort()
}

/**
 * Synthesize 2–5 natural-language example queries from frontmatter. Returns
 * `undefined` when fewer than two can be derived (ARD requires `minItems: 2`).
 */
export function deriveRepresentativeQueries(
    fm: SkillFrontmatter,
    h1Title: string | null
): string[] | undefined {
    const humanName = h1Title ? stripParentheticals(h1Title) : toTitleCase(asString(fm.name) ?? '')
    const queries: string[] = []

    // 1. First clause of the description.
    const firstClause = (asString(fm.description) ?? '').split(/[.!?]/)[0]?.trim()
    if (firstClause && firstClause.length > 5) {
        queries.push(firstClause)
    }

    // 2. argument-hint modes: --source {a|b}
    const braceMatch = (asString(fm['argument-hint']) ?? '').match(/\{([^}]+)\}/)
    if (braceMatch) {
        for (const mode of braceMatch[1]!.split('|').slice(0, 2)) {
            queries.push(`${humanName} for ${mode.trim()}`)
        }
    }

    // 3. when_to_use trigger phrase.
    const when = asString(fm.when_to_use) ?? ''
    if (when) {
        const quoted = when.match(/"([^"]+)"/)
        const phrase =
            quoted?.[1] ??
            when
                .replace(/^Use when (the user )?(asks?|wants?)( about| to)?/i, '')
                .split(/[,;]/)[0]
                ?.trim()
        if (phrase && phrase.length > 3) {
            queries.push(`Help with ${phrase}`)
        }
    }

    // 4. Capability verb → human query.
    const verb = asString(fm.metadata?.capability)?.split('.').pop()
    if (verb) {
        queries.push(`${capitalize(verb)} ${humanName}`)
    }

    const unique = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 5)
    return unique.length >= 2 ? unique : undefined
}

// ----- Helpers -----

function isInternal(fm: SkillFrontmatter): boolean {
    return asFlag(fm['user-invocable']) === false || asFlag(fm['disable-model-invocation']) === true
}

function addTag(tags: Set<string>, prefix: string, value: string | undefined): void {
    if (value) tags.add(`${prefix}:${value}`)
}

function setExt(entry: CatalogEntry, key: `x-${string}`, value: string | undefined): void {
    if (value) entry[key] = value
}
