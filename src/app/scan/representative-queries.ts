/**
 * Shared derivation of `representativeQueries` for every resource family.
 *
 * Representative queries are the lexical search's main signal for "what would
 * a user type to find this?", so they are phrased the way a user types: the
 * trigger phrases a skill author quoted, the capability as `verb subject`, the
 * description's opening clause in query case. Nothing is prefixed ("Help with
 * …") or glued together ("Check Check Links") — such strings only look
 * meaningful to an embedding.
 */

/** Maximum queries per entry (ARD: 2–5 or absent, BR-10). */
export const MAX_QUERIES = 5

/** The text up to the first sentence end, or undefined when too short to search for. */
export function firstClause(text: string | undefined): string | undefined {
    const clause = (text ?? '').split(/[.!?]/)[0]?.trim()
    return clause && clause.length > 5 ? clause : undefined
}

/** Sentence case → query case; an opening acronym ("CRM operator") is left alone. */
export function toQueryCase(text: string): string {
    const second = text.charAt(1)
    return second && second === second.toLowerCase()
        ? text.charAt(0).toLowerCase() + text.slice(1)
        : text
}

const DOUBLE_QUOTED = /["“]([^"”]+)["”]/g
// A single-quoted phrase must be delimited on both sides so "today's plan" is not one.
const SINGLE_QUOTED = /(?<![\w'])'([^']+)'(?![\w'])/g
const TRIGGERS_LIST = /\btriggers?:\s*([^.!?;\n]+)/i
const USE_WHEN =
    /\buse when (?:the user )?(?:asks?|wants?|says?|mentions?|needs?)(?: about| to| for)?\s+([^,;.!?\n]+)/i

/**
 * The trigger phrases an author wrote into `when_to_use` / `description`, verbatim.
 * Quoted phrases win (`"check links", "dead links"`); then an unquoted
 * `Triggers: a, b, c` list; then the object of `Use when the user asks about X`.
 */
export function extractTriggerPhrases(text: string | undefined): string[] {
    if (!text) return []
    const quoted = [
        ...[...text.matchAll(DOUBLE_QUOTED)].map((m) => ({ at: m.index, phrase: m[1]! })),
        ...[...text.matchAll(SINGLE_QUOTED)].map((m) => ({ at: m.index, phrase: m[1]! }))
    ]
        .sort((a, b) => a.at - b.at)
        .map((m) => m.phrase.trim())
        .filter((p) => p.length > 1)
    if (quoted.length > 0) return quoted

    const list = text.match(TRIGGERS_LIST)?.[1]
    if (list) {
        const phrases = list
            .split(',')
            .map((p) => p.replace(/^\s*(?:and|or)\s+/i, '').trim())
            .filter((p) => p.length > 1)
        if (phrases.length > 0) return phrases
    }

    const object = text.match(USE_WHEN)?.[1]?.trim()
    return object && object.length > 3 ? [object] : []
}

/**
 * `<domain>.<subject>.<verb>` → `verb subject` (`vault.links.check` → `check links`).
 * Undefined without a subject/verb pair or when they are the same word.
 */
export function capabilityQuery(capability: string | undefined): string | undefined {
    const parts = (capability ?? '').split('.').filter(Boolean)
    if (parts.length < 2) return undefined
    const verb = parts[parts.length - 1]!.toLowerCase()
    const subject = parts[parts.length - 2]!.toLowerCase()
    // `business.context.context` would render as "context context": not a query.
    return verb === subject ? undefined : `${verb} ${subject}`
}

/** True when no query already carries this phrase (case-insensitive substring). */
export function isNovelPhrase(phrase: string, queries: readonly string[]): boolean {
    const needle = phrase.toLowerCase()
    return !queries.some((q) => q.toLowerCase().includes(needle))
}

/**
 * Trim, drop blanks, dedupe case-insensitively (first spelling wins), cap at
 * {@link MAX_QUERIES}. Undefined below two distinct queries (BR-10).
 */
export function finalizeQueries(queries: readonly string[]): string[] | undefined {
    const seen = new Set<string>()
    const unique: string[] = []
    for (const raw of queries) {
        const query = raw.trim()
        const key = query.toLowerCase()
        if (!query || seen.has(key)) continue
        seen.add(key)
        unique.push(query)
        if (unique.length === MAX_QUERIES) break
    }
    return unique.length >= 2 ? unique : undefined
}
