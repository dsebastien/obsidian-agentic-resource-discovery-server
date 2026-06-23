import { describe, it, expect } from 'bun:test'
import { manualResourcesToEntries } from './resource-mapper'
import type { ManualResource } from '../types/plugin-settings.intf'

const resource = (over: Partial<ManualResource> = {}): ManualResource => ({
    id: 'r1',
    enabled: true,
    type: 'application/mcp-server-card+json',
    slug: 'my-server',
    displayName: 'My Server',
    capabilities: [],
    tags: [],
    representativeQueries: [],
    ...over
})

describe('manualResourcesToEntries', () => {
    it('maps an MCP resource to a catalog entry under the mcp namespace', () => {
        const [entry] = manualResourcesToEntries(
            [resource({ url: 'http://x/card.json' })],
            'obsidian'
        )
        expect(entry?.identifier).toBe('urn:air:obsidian:mcp:my-server')
        expect(entry?.type).toBe('application/mcp-server-card+json')
        expect(entry?.url).toBe('http://x/card.json')
        expect(entry?.displayName).toBe('My Server')
    })

    it('namespaces each resource type distinctly', () => {
        const types: Array<[ManualResource['type'], string]> = [
            ['application/a2a-agent-card+json', 'agents'],
            ['application/ai-catalog+json', 'catalogs'],
            ['application/ai-registry+json', 'registries']
        ]
        for (const [type, ns] of types) {
            const [entry] = manualResourcesToEntries(
                [resource({ type, url: 'http://x' })],
                'obsidian'
            )
            expect(entry?.identifier).toBe(`urn:air:obsidian:${ns}:my-server`)
        }
    })

    it('omits disabled resources', () => {
        expect(
            manualResourcesToEntries([resource({ enabled: false, url: 'http://x' })], 'obsidian')
        ).toEqual([])
    })

    it('omits resources with a blank slug or display name', () => {
        expect(
            manualResourcesToEntries([resource({ slug: '  ', url: 'http://x' })], 'obsidian')
        ).toEqual([])
        expect(
            manualResourcesToEntries([resource({ displayName: '', url: 'http://x' })], 'obsidian')
        ).toEqual([])
    })

    it('omits resources that have neither a url nor inline data', () => {
        expect(manualResourcesToEntries([resource()], 'obsidian')).toEqual([])
    })

    it('uses inline data when no url is given', () => {
        const [entry] = manualResourcesToEntries(
            [resource({ inlineData: { name: 'inline' } })],
            'obsidian'
        )
        expect(entry?.data).toEqual({ name: 'inline' })
        expect(entry?.url).toBeUndefined()
    })

    it('carries optional metadata and respects a custom publisher', () => {
        const [entry] = manualResourcesToEntries(
            [
                resource({
                    url: 'http://x',
                    description: 'does things',
                    tags: ['a'],
                    capabilities: ['cap.one'],
                    representativeQueries: ['do a thing', 'do another']
                })
            ],
            'dsebastien.net'
        )
        expect(entry?.identifier).toBe('urn:air:dsebastien.net:mcp:my-server')
        expect(entry?.description).toBe('does things')
        expect(entry?.tags).toEqual(['a'])
        expect(entry?.capabilities).toEqual(['cap.one'])
        expect(entry?.representativeQueries).toEqual(['do a thing', 'do another'])
    })
})
