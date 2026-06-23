import { load } from 'js-yaml'
import type { ParsedSkill, SkillFrontmatter } from './skill-frontmatter.types'

/** Matches a leading `--- … ---` YAML frontmatter block. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Parse a SKILL.md document into its frontmatter and first H1 title.
 *
 * Pure (operates on the file content string, not the filesystem) so it's trivial
 * to unit test. Never throws: malformed YAML yields empty frontmatter rather than
 * aborting a whole scan over one bad file.
 */
export function parseSkill(content: string): ParsedSkill {
    let frontmatter: SkillFrontmatter = {}
    let body = content

    const match = content.match(FRONTMATTER)
    if (match) {
        body = content.slice(match[0].length)
        try {
            // Normalise CRLF / lone-CR line endings so a stray \r can't leak into
            // a parsed YAML value.
            const data = load(match[1]!.replace(/\r\n?/g, '\n'))
            if (data && typeof data === 'object') {
                frontmatter = data as SkillFrontmatter
            }
        } catch {
            frontmatter = {}
        }
    }

    const h1 = body.match(/^#\s+(.+?)\s*$/m)
    return { frontmatter, h1Title: h1 ? h1[1]!.trim() : null }
}
