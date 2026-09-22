import { describe, it, expect } from 'bun:test'
import {
    capabilityQuery,
    extractTriggerPhrases,
    finalizeQueries,
    firstClause,
    toQueryCase
} from './representative-queries'

describe('firstClause', () => {
    it('takes the text up to the first sentence end', () => {
        expect(firstClause('Scans the vault. Read-only — never modifies files.')).toBe(
            'Scans the vault'
        )
    })

    it('ignores empty or too-short input', () => {
        expect(firstClause(undefined)).toBeUndefined()
        expect(firstClause('Hi.')).toBeUndefined()
    })
})

describe('toQueryCase', () => {
    it('lowers a sentence-case opening but leaves acronyms alone', () => {
        expect(toQueryCase('Sharp-eyed editor')).toBe('sharp-eyed editor')
        expect(toQueryCase('CRM operator for X')).toBe('CRM operator for X')
    })
})

describe('extractTriggerPhrases', () => {
    it('returns double-quoted phrases verbatim, in order', () => {
        expect(
            extractTriggerPhrases(
                'Use when the user says "check links", "find broken links", or "verify links".'
            )
        ).toEqual(['check links', 'find broken links', 'verify links'])
    })

    it('accepts single-quoted phrases without tripping on apostrophes', () => {
        expect(
            extractTriggerPhrases(
                "Adds a task to today's plan. Use when the user says 'add task', 'plan this'."
            )
        ).toEqual(['add task', 'plan this'])
    })

    it('splits an unquoted "Triggers:" list on commas, stopping at the sentence end', () => {
        expect(
            extractTriggerPhrases(
                'Triggers: add task, plan this for today, capture this task. Forward-looking only.'
            )
        ).toEqual(['add task', 'plan this for today', 'capture this task'])
    })

    it('falls back to the object of an unquoted "Use when the user asks about …"', () => {
        expect(
            extractTriggerPhrases('Use when the user asks about web traffic and blog analytics.')
        ).toEqual(['web traffic and blog analytics'])
    })

    it('returns nothing for empty input', () => {
        expect(extractTriggerPhrases(undefined)).toEqual([])
        expect(extractTriggerPhrases('')).toEqual([])
    })
})

describe('capabilityQuery', () => {
    it('renders <domain>.<subject>.<verb> as "verb subject"', () => {
        expect(capabilityQuery('vault.links.check')).toBe('check links')
        expect(capabilityQuery('task.tasknote.create')).toBe('create tasknote')
    })

    it('returns undefined when there is no subject and verb pair', () => {
        expect(capabilityQuery(undefined)).toBeUndefined()
        expect(capabilityQuery('vault')).toBeUndefined()
    })

    it('refuses a subject that repeats the verb (business.context.context)', () => {
        expect(capabilityQuery('business.context.context')).toBeUndefined()
    })
})

describe('finalizeQueries', () => {
    it('trims, dedupes case-insensitively keeping the first spelling, and caps at five', () => {
        expect(finalizeQueries(['Check links', ' check links', 'a', 'b', 'c', 'd', 'e'])).toEqual([
            'Check links',
            'a',
            'b',
            'c',
            'd'
        ])
    })

    it('returns undefined below two distinct queries', () => {
        expect(finalizeQueries(['one', 'ONE', ''])).toBeUndefined()
    })
})
