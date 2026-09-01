import { describe, it, expect } from 'bun:test'
import { buildAgentEntry, deriveAgentQueries } from './agent-enricher'
import { parseSkill } from '../skills/skill-parser'
import { ArdMediaType } from '../types/ard.types'

const DEFINITION = `---
name: agent-osk-editor
description: Sharp-eyed editor. Reviews for structure, clarity, flow, grammar.
allowed-tools: Read, Glob, Grep, Skill
model: sonnet
color: blue
updated: 2026-04-15T15:11
---

# Activation

Load your context.
`

const input = (content: string, name = 'agent-osk-editor') => ({
    parsed: parseSkill(content),
    name,
    publisher: 'developassion',
    url: `http://127.0.0.1:27182/subagents/${name}.md`,
    updatedAt: '2026-01-01T00:00:00.000Z'
})

describe('buildAgentEntry', () => {
    it('builds a subagent entry with the ai-agent media type and a subagents URN', () => {
        const entry = buildAgentEntry(input(DEFINITION))
        expect(entry.identifier).toBe('urn:air:developassion:subagents:agent-osk-editor')
        expect(entry.type).toBe(ArdMediaType.AiAgent)
        expect(entry.url).toBe('http://127.0.0.1:27182/subagents/agent-osk-editor.md')
        expect(entry.description).toBe(
            'Sharp-eyed editor. Reviews for structure, clarity, flow, grammar.'
        )
    })

    it('humanises the stem and ignores a generic H1 like "Activation"', () => {
        expect(buildAgentEntry(input(DEFINITION)).displayName).toBe('Osk Editor')
    })

    it('derives ns/category/model/tool tags and x-osk-* extensions', () => {
        const entry = buildAgentEntry(input(DEFINITION))
        expect(entry.tags).toEqual(['category:editor', 'model:sonnet', 'ns:osk', 'uses-skills'])
        expect(entry['x-osk-model']).toBe('sonnet')
        expect(entry['x-osk-tools']).toEqual(['Read', 'Glob', 'Grep', 'Skill'])
        expect(entry['x-osk-color']).toBe('blue')
    })

    it('prefers a frontmatter `updated` (YAML date coerced) for version', () => {
        const entry = buildAgentEntry(input(DEFINITION))
        expect(entry.version).toBe('2026-04-15')
    })

    it('accepts the documented `tools` key and a YAML list', () => {
        const entry = buildAgentEntry(
            input(`---\ndescription: X does Y.\ntools:\n  - Bash(git *)\n  - Write\n---\n`, 'x')
        )
        expect(entry['x-osk-tools']).toEqual(['Bash(git *)', 'Write'])
        expect(entry.tags).toContain('uses-bash')
        expect(entry.tags).toContain('writes-files')
    })

    it('emits capabilities only when metadata.capability is present', () => {
        expect(buildAgentEntry(input(DEFINITION)).capabilities).toBeUndefined()
        const entry = buildAgentEntry(
            input(`---\ndescription: X.\nmetadata:\n  capability: content.review.edit\n---\n`, 'x')
        )
        expect(entry.capabilities).toEqual(['content.review.edit'])
        expect(entry.tags).toContain('domain:content')
    })

    it('synthesises 2-5 representative queries', () => {
        const q = deriveAgentQueries('Osk Editor', 'Sharp-eyed editor. Reviews stuff.')
        expect(q).toEqual(['sharp-eyed editor', 'act as osk editor', 'review this as osk editor'])
        expect(deriveAgentQueries('', undefined)).toBeUndefined()
        expect(deriveAgentQueries('Crm', 'CRM operator for X.')?.[0]).toBe('CRM operator for X')
    })
})
