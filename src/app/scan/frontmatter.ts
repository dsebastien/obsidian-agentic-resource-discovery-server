/**
 * Normalisers for untrusted YAML frontmatter.
 *
 * `js-yaml` happily turns an unquoted timestamp into a `Date`, `true` into a
 * boolean, and `007` into a number, so every field a scanner reads is coerced
 * through these before string operations run. Shared by every resource family
 * (skills, subagent definitions) so the coercion rules cannot drift apart.
 */

/** Coerce an untrusted YAML value into a string (handles Date/number/boolean). */
export function asString(value: unknown): string | undefined {
    if (typeof value === 'string') return value
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return undefined
}

/** Coerce an untrusted YAML value into a string array. */
export function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.map(asString).filter((v): v is string => v !== undefined)
}

/**
 * Coerce a boolean-ish frontmatter flag. A quoted YAML value yields the string
 * `"true"` rather than a boolean; both spellings are the same signal.
 */
export function asFlag(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') return value
    const text = asString(value)?.trim().toLowerCase()
    if (text === 'true') return true
    if (text === 'false') return false
    return undefined
}

/**
 * Tool list coercion: Claude Code accepts a space-separated string
 * (`Read Grep Bash(git *)`), a comma-separated string, or a YAML array. Returns
 * the individual tool tokens, de-duplicated, in order of first appearance.
 */
export function asToolList(value: unknown): string[] {
    const raw = Array.isArray(value)
        ? asStringArray(value)
        : asString(value)
          ? [asString(value)!]
          : []
    const tokens: string[] = []
    for (const chunk of raw) {
        for (const token of splitTools(chunk)) {
            if (token && !tokens.includes(token)) tokens.push(token)
        }
    }
    return tokens
}

/**
 * Split a tool string on commas and whitespace while keeping parenthesised
 * patterns (`Bash(git add *)`) as one token.
 */
function splitTools(text: string): string[] {
    const out: string[] = []
    let depth = 0
    let current = ''
    for (const ch of text) {
        if (ch === '(') depth++
        if (ch === ')') depth = Math.max(0, depth - 1)
        if ((ch === ',' || /\s/.test(ch)) && depth === 0) {
            if (current) out.push(current)
            current = ''
            continue
        }
        current += ch
    }
    if (current) out.push(current)
    return out
}

/**
 * Search/filter tags derived from what a resource is allowed to call. The
 * same rules for every family, so `uses-bash` means the same thing on a skill
 * and on a subagent definition.
 */
export function deriveToolTags(tools: string[]): string[] {
    const tags = new Set<string>()
    for (const tool of tools) {
        if (/^(WebFetch|WebSearch)\b/.test(tool)) tags.add('uses-web')
        if (/^Bash\b/.test(tool)) tags.add('uses-bash')
        if (/^(Write|Edit|NotebookEdit)\b/.test(tool)) tags.add('writes-files')
        if (/^Skill\b/.test(tool)) tags.add('uses-skills')
        if (/^(Agent|Task)\b/.test(tool)) tags.add('spawns-agents')
    }
    return [...tags]
}

/** Strip a trailing ` (…)` qualifier from a title: `Foo (v2)` → `Foo`. */
export function stripParentheticals(text: string): string {
    return text.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
}

/** `some-kebab-name` → `Some Kebab Name`. */
export function toTitleCase(kebab: string): string {
    return kebab.split('-').filter(Boolean).map(capitalize).join(' ')
}

export function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1)
}
