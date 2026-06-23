/**
 * ARD URN identifiers.
 *
 * Every catalog entry is named with a domain-anchored URN of the form
 * `urn:air:<publisher>:<segment>(:<segment>)+`. The publisher segment is the
 * trust anchor (ideally an FQDN); for local-first use it defaults to `obsidian`.
 *
 * See documentation/plans/implementation-plan.md §2.1 and the vault note
 * "ARD URN Identifier".
 */

/** Fixed namespace identifier for the ARD ecosystem. */
export const ARD_URN_PREFIX = 'urn:air'

/** Namespace segment under which scanned AI Skills are placed. */
export const SKILLS_NAMESPACE = 'skills'

/**
 * Matches `urn:air:<publisher>:<segment>(:<segment>)+`. Publisher allows dots
 * (FQDNs) and hyphens; later segments allow dots, underscores, and hyphens. At
 * least one namespaced segment after the publisher is required.
 */
const ARD_URN_PATTERN = /^urn:air:[a-zA-Z0-9.-]+(?::[a-zA-Z0-9._-]+)+$/

/**
 * Sanitise a publisher segment to the `[a-zA-Z0-9.-]` charset the URN grammar
 * allows (dots for FQDNs, hyphens). Anything else becomes a hyphen; empties fall
 * back so the result is always a valid, non-empty segment.
 */
export const sanitizePublisher = (raw: string): string => collapse(raw, /[^a-zA-Z0-9.-]+/g)

/**
 * Sanitise a name segment to `[a-zA-Z0-9._-]`. Frontmatter `name` is untrusted —
 * spaces, colons, or a YAML date (`2024-01-01T…:…`) would otherwise produce an
 * invalid URN or a wrong dedup key.
 */
export const sanitizeUrnSegment = (raw: string): string => collapse(raw, /[^a-zA-Z0-9._-]+/g)

function collapse(raw: string, illegal: RegExp): string {
    const cleaned = raw
        .replace(illegal, '-')
        .replace(/-+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
    return cleaned.length > 0 ? cleaned : 'unknown'
}

/** Build an ARD URN from a publisher and one or more name segments. */
export const buildUrn = (publisher: string, segments: string[]): string =>
    [ARD_URN_PREFIX, sanitizePublisher(publisher), ...segments.map(sanitizeUrnSegment)].join(':')

/** Build the URN for a scanned AI Skill. */
export const buildSkillUrn = (publisher: string, skillName: string): string =>
    buildUrn(publisher, [SKILLS_NAMESPACE, skillName])

/** Whether a string is a structurally valid ARD URN. */
export const isValidArdUrn = (value: string): boolean => ARD_URN_PATTERN.test(value)
