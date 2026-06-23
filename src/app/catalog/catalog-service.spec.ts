import { describe, it, expect } from 'bun:test'
import { CatalogService } from './catalog-service'
import { ARD_SPEC_VERSION, ArdMediaType, type CatalogEntry } from '../types/ard.types'

const HOST = { displayName: 'Test Registry', identifier: 'obsidian' }

const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
    identifier: 'urn:air:obsidian:skills:alpha',
    displayName: 'Alpha',
    type: ArdMediaType.AiSkill,
    url: 'http://127.0.0.1:27182/skills/alpha/SKILL.md',
    ...over
})

describe('CatalogService', () => {
    it('produces an empty but valid catalog on creation', () => {
        const catalog = new CatalogService(HOST).toCatalog()
        expect(catalog.specVersion).toBe(ARD_SPEC_VERSION)
        expect(catalog.host).toEqual(HOST)
        expect(catalog.entries).toEqual([])
    })

    it('exposes replaced entries through the catalog', () => {
        const service = new CatalogService(HOST)
        service.replaceEntries([entry(), entry({ identifier: 'urn:air:obsidian:skills:beta' })])
        const catalog = service.toCatalog()
        expect(catalog.entries).toHaveLength(2)
        expect(service.size).toBe(2)
    })

    it('replacing entries discards the previous set', () => {
        const service = new CatalogService(HOST)
        service.replaceEntries([entry()])
        service.replaceEntries([entry({ identifier: 'urn:air:obsidian:skills:beta' })])
        expect(service.size).toBe(1)
        expect(service.getEntry('urn:air:obsidian:skills:alpha')).toBeUndefined()
    })

    it('retrieves an entry by its URN identifier', () => {
        const service = new CatalogService(HOST)
        service.replaceEntries([entry()])
        expect(service.getEntry('urn:air:obsidian:skills:alpha')?.displayName).toBe('Alpha')
        expect(service.getEntry('urn:air:obsidian:skills:missing')).toBeUndefined()
    })

    it('lists all entries', () => {
        const service = new CatalogService(HOST)
        service.replaceEntries([entry(), entry({ identifier: 'urn:air:obsidian:skills:beta' })])
        expect(service.listAll().map((e) => e.identifier)).toEqual([
            'urn:air:obsidian:skills:alpha',
            'urn:air:obsidian:skills:beta'
        ])
    })

    it('does not let callers mutate internal state through the catalog snapshot', () => {
        const service = new CatalogService(HOST)
        service.replaceEntries([entry()])
        service.toCatalog().entries.push(entry({ identifier: 'urn:air:obsidian:skills:injected' }))
        expect(service.size).toBe(1)
    })
})
