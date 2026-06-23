import { describe, it, expect } from 'bun:test'
import { buildUrn, buildSkillUrn, isValidArdUrn } from './urn'

describe('buildUrn', () => {
    it('anchors an identifier to the publisher with namespaced segments', () => {
        expect(buildUrn('obsidian', ['skills', 'osk-summarize'])).toBe(
            'urn:air:obsidian:skills:osk-summarize'
        )
    })

    it('supports a real FQDN publisher', () => {
        expect(buildUrn('dsebastien.net', ['mcp', 'my-server'])).toBe(
            'urn:air:dsebastien.net:mcp:my-server'
        )
    })

    it('produces a URN that validates', () => {
        expect(isValidArdUrn(buildUrn('obsidian', ['skills', 'a-skill']))).toBe(true)
    })
})

describe('buildSkillUrn', () => {
    it('places skills under the skills namespace', () => {
        expect(buildSkillUrn('obsidian', 'developassion-analytics')).toBe(
            'urn:air:obsidian:skills:developassion-analytics'
        )
    })
})

describe('isValidArdUrn', () => {
    it('accepts a well-formed urn:air identifier', () => {
        expect(isValidArdUrn('urn:air:obsidian:skills:foo')).toBe(true)
    })

    it('rejects identifiers without the urn:air prefix', () => {
        expect(isValidArdUrn('urn:ai:obsidian:skills:foo')).toBe(false)
        expect(isValidArdUrn('air:obsidian:skills:foo')).toBe(false)
    })

    it('rejects a bare publisher with no namespaced segment', () => {
        expect(isValidArdUrn('urn:air:obsidian')).toBe(false)
    })

    it('rejects whitespace and empty strings', () => {
        expect(isValidArdUrn('')).toBe(false)
        expect(isValidArdUrn('urn:air:obsidian:skills:has space')).toBe(false)
    })
})
