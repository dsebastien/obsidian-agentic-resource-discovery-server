/**
 * The YAML frontmatter of an Anthropic Agent Skill (SKILL.md).
 *
 * Only fields we actually read are typed; everything is optional because
 * frontmatter in the wild is inconsistent. Field keys match the real corpus
 * (e.g. `when_to_use`, `argument-hint`, `metadata.note-types`).
 */
export interface SkillMetadata {
    'kind'?: string
    'capability'?: string
    'effects'?: string
    'tier'?: string
    'note-types'?: string[]
    'dependencies'?: string[]
    'composes'?: string[]
    'updated'?: string
    'created'?: string
    [key: string]: unknown
}

export interface SkillFrontmatter {
    'name'?: string
    'description'?: string
    'when_to_use'?: string
    'model'?: string
    'effort'?: string
    'argument-hint'?: string
    'allowed-tools'?: string
    'user-invocable'?: boolean
    'disable-model-invocation'?: boolean
    'context'?: string
    'metadata'?: SkillMetadata
    [key: string]: unknown
}

/** A parsed SKILL.md: its frontmatter plus the first H1 title from the body. */
export interface ParsedSkill {
    frontmatter: SkillFrontmatter
    h1Title: string | null
}
