import { describe, it, expect } from 'bun:test'
import { parsePluginSettings, DEFAULT_SETTINGS } from './plugin-settings.intf'

describe('parsePluginSettings', () => {
    it('returns the defaults for missing/undefined data (first run)', () => {
        const settings = parsePluginSettings(undefined)
        expect(settings).toEqual(DEFAULT_SETTINGS)
    })

    it('returns the defaults for non-object garbage', () => {
        expect(parsePluginSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
        expect(parsePluginSettings(42)).toEqual(DEFAULT_SETTINGS)
        expect(parsePluginSettings(null)).toEqual(DEFAULT_SETTINGS)
    })

    it('defaults the publisher to "obsidian"', () => {
        expect(parsePluginSettings({}).publisher).toBe('obsidian')
    })

    it('defaults the server to localhost:27182 with the lexical backend', () => {
        const settings = parsePluginSettings({})
        expect(settings.server.bindAddress).toBe('127.0.0.1')
        expect(settings.server.port).toBe(27182)
        expect(settings.server.bearerToken).toBe('')
        expect(settings.searchBackend.kind).toBe('lexical')
        expect(settings.skillFolders).toEqual([])
    })

    it('merges a partial object over the defaults', () => {
        const settings = parsePluginSettings({ publisher: 'dsebastien.net' })
        expect(settings.publisher).toBe('dsebastien.net')
        // Untouched fields keep their defaults
        expect(settings.server.port).toBe(27182)
    })

    it('preserves a previously generated bearer token', () => {
        const token = 'a'.repeat(64)
        expect(parsePluginSettings({ server: { bearerToken: token } }).server.bearerToken).toBe(
            token
        )
    })

    it('never lets the bind address be anything but loopback (security invariant)', () => {
        const settings = parsePluginSettings({ server: { bindAddress: '0.0.0.0' } })
        expect(settings.server.bindAddress).toBe('127.0.0.1')
    })

    it('falls back to defaults for individual malformed fields without discarding valid ones', () => {
        const settings = parsePluginSettings({
            publisher: 'dsebastien.net',
            skillFolders: 'not-an-array',
            server: { port: 'abc' }
        })
        expect(settings.publisher).toBe('dsebastien.net') // valid kept
        expect(settings.skillFolders).toEqual([]) // malformed → default
        expect(settings.server.port).toBe(27182) // malformed → default
    })

    it('strips unknown keys', () => {
        const settings = parsePluginSettings({ haxx: true }) as Record<string, unknown>
        expect(settings['haxx']).toBeUndefined()
    })

    it('keeps well-formed manual resources', () => {
        const settings = parsePluginSettings({
            resources: [
                {
                    id: 'r1',
                    type: 'application/mcp-server-card+json',
                    slug: 'my-server',
                    displayName: 'My Server',
                    url: 'http://localhost:8080/card.json'
                }
            ]
        })
        expect(settings.resources).toHaveLength(1)
        expect(settings.resources[0]?.slug).toBe('my-server')
        expect(settings.resources[0]?.enabled).toBe(true) // default applied
    })
})
