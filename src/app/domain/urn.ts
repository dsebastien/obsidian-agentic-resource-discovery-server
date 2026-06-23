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

/** Build an ARD URN from a publisher and one or more name segments. */
export const buildUrn = (publisher: string, segments: string[]): string =>
    [ARD_URN_PREFIX, publisher, ...segments].join(':')

/** Build the URN for a scanned AI Skill. */
export const buildSkillUrn = (publisher: string, skillName: string): string =>
    buildUrn(publisher, [SKILLS_NAMESPACE, skillName])

/** Whether a string is a structurally valid ARD URN. */
export const isValidArdUrn = (value: string): boolean => ARD_URN_PATTERN.test(value)
