import { describe, it, expect } from 'bun:test'
import { buildSkillEntry, deriveTags, deriveRepresentativeQueries } from './skill-enricher'
import type { ParsedSkill, SkillFrontmatter } from './skill-frontmatter.types'

const analytics: SkillFrontmatter = {
    'name': 'developassion-analytics',
    'description': 'Pull analytics from a DeveloPassion data source.',
    'when_to_use': 'Use when the user asks about web traffic and blog analytics.',
    'argument-hint': '--source {plausible|gumroad} [--period <p>]',
    'allowed-tools': 'Read Bash WebFetch',
    'metadata': {
        'kind': 'analyzer',
        'capability': 'developassion.analytics.report',
        'effects': 'external',
        'tier': 'primitive',
        'note-types': ['own-products'],
        'dependencies': ['user-business'],
        'updated': '2026-04-15T09:00'
    }
}

const parsed = (fm: SkillFrontmatter, h1: string | null = null): ParsedSkill => ({
    frontmatter: fm,
    h1Title: h1
})

const ctx = { name: 'developassion-analytics', publisher: 'obsidian', url: 'http://h/s/SKILL.md' }

describe('buildSkillEntry', () => {
    it('maps a skill to an ai-skill catalog entry', () => {
        const entry = buildSkillEntry({
            ...ctx,
            parsed: parsed(analytics, 'Analytics (DeveloPassion)')
        })
        expect(entry.identifier).toBe('urn:air:obsidian:skills:developassion-analytics')
        expect(entry.type).toBe('application/ai-skill')
        expect(entry.url).toBe('http://h/s/SKILL.md')
        expect(entry.displayName).toBe('Analytics') // H1, parenthetical stripped
        expect(entry.capabilities).toEqual(['developassion.analytics.report'])
        expect(entry.version).toBe('2026-04-15')
    })

    it('falls back to a title-cased folder name when there is no H1', () => {
        const entry = buildSkillEntry({ ...ctx, parsed: parsed(analytics, null) })
        expect(entry.displayName).toBe('Developassion Analytics')
    })

    it('omits representativeQueries when fewer than two can be derived', () => {
        const entry = buildSkillEntry({
            name: 'tiny',
            publisher: 'obsidian',
            url: 'http://h/s/SKILL.md',
            parsed: parsed({ name: 'tiny', description: 'Hi.' })
        })
        expect(entry.representativeQueries).toBeUndefined()
    })

    it('carries useful skill metadata as x- extension fields', () => {
        const entry = buildSkillEntry({ ...ctx, parsed: parsed(analytics) })
        expect(entry['x-osk-kind']).toBe('analyzer')
        expect(entry['x-osk-tier']).toBe('primitive')
        expect(entry['x-osk-dependencies']).toEqual(['user-business'])
    })

    it('tolerates a YAML-parsed Date timestamp (js-yaml turns unquoted dates into Date)', () => {
        const fm = {
            name: 'dated',
            description: 'A dated skill.',
            metadata: { updated: new Date('2026-06-03T09:00:00Z') }
        } as unknown as SkillFrontmatter
        const entry = buildSkillEntry({
            name: 'dated',
            publisher: 'obsidian',
            url: 'http://h/s/SKILL.md',
            parsed: parsed(fm)
        })
        expect(entry.version).toBe('2026-06-03')
    })

    it('does not throw on non-string frontmatter values', () => {
        const fm = {
            'name': 'weird',
            'description': 123,
            'argument-hint': 5,
            'when_to_use': true
        } as unknown as SkillFrontmatter
        expect(() =>
            buildSkillEntry({
                name: 'weird',
                publisher: 'obsidian',
                url: 'http://h/s/SKILL.md',
                parsed: parsed(fm)
            })
        ).not.toThrow()
    })
})

describe('deriveTags', () => {
    it('derives namespaced, kind, tier, effects, domain, and tool tags', () => {
        const tags = deriveTags(analytics)
        expect(tags).toContain('ns:developassion')
        expect(tags).toContain('kind:analyzer')
        expect(tags).toContain('tier:primitive')
        expect(tags).toContain('effects:external')
        expect(tags).toContain('domain:developassion')
        expect(tags).toContain('note-type:own-products')
        expect(tags).toContain('uses-web')
        expect(tags).toContain('uses-bash')
        expect(tags).toContain('user-invocable')
    })

    it('marks internal skills', () => {
        expect(deriveTags({ 'name': 'x', 'disable-model-invocation': true })).toContain('internal')
        expect(deriveTags({ 'name': 'y', 'user-invocable': false })).toContain('internal')
    })

    it('tags subagent skills', () => {
        expect(deriveTags({ name: 'x', context: 'fork' })).toContain('runs-as-subagent')
    })
})

describe('deriveRepresentativeQueries', () => {
    it('derives 2-5 natural-language queries from frontmatter', () => {
        const queries = deriveRepresentativeQueries(analytics, 'Analytics')
        expect(queries).toBeDefined()
        expect(queries!.length).toBeGreaterThanOrEqual(2)
        expect(queries!.length).toBeLessThanOrEqual(5)
    })

    it('uses argument-hint modes', () => {
        const queries = deriveRepresentativeQueries(analytics, 'Analytics') ?? []
        expect(queries.some((q) => q.toLowerCase().includes('plausible'))).toBe(true)
    })

    it('returns undefined when too little signal exists', () => {
        expect(deriveRepresentativeQueries({ name: 'x', description: 'Hi.' }, null)).toBeUndefined()
    })
})
