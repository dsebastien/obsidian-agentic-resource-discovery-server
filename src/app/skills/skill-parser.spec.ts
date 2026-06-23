import { describe, it, expect } from 'bun:test'
import { parseSkill } from './skill-parser'

const SKILL = `---
name: developassion-analytics
description: 'Pull analytics from a DeveloPassion data source.'
when_to_use: 'Use when the user asks about web traffic.'
argument-hint: "--source {plausible|gumroad} [--period <p>]"
allowed-tools: Read Bash WebFetch
metadata:
  kind: analyzer
  capability: developassion.analytics.report
  tier: primitive
  dependencies:
    - user-business
---
# Analytics (DeveloPassion)

Body text here.
`

describe('parseSkill', () => {
    it('parses frontmatter fields', () => {
        const { frontmatter } = parseSkill(SKILL)
        expect(frontmatter.name).toBe('developassion-analytics')
        expect(frontmatter.description).toBe('Pull analytics from a DeveloPassion data source.')
        expect(frontmatter.when_to_use).toContain('web traffic')
        expect(frontmatter['argument-hint']).toContain('--source')
        expect(frontmatter.metadata?.capability).toBe('developassion.analytics.report')
        expect(frontmatter.metadata?.dependencies).toEqual(['user-business'])
    })

    it('extracts the first H1 title from the body', () => {
        expect(parseSkill(SKILL).h1Title).toBe('Analytics (DeveloPassion)')
    })

    it('returns a null title when the body has no H1', () => {
        const noTitle = `---\nname: x\n---\njust text, no heading`
        expect(parseSkill(noTitle).h1Title).toBeNull()
    })

    it('returns empty frontmatter when there is none', () => {
        const result = parseSkill('# Just A Title\n\ntext')
        expect(result.frontmatter).toEqual({})
        expect(result.h1Title).toBe('Just A Title')
    })

    it('does not throw on malformed YAML frontmatter', () => {
        const bad = `---\nname: : : bad\n  - nope\n---\n# Title`
        expect(() => parseSkill(bad)).not.toThrow()
    })
})
