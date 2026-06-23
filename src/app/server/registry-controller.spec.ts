import { describe, it, expect, afterEach } from 'bun:test'
import { RegistryController } from './registry-controller'
import {
    DEFAULT_SETTINGS,
    type ManualResource,
    type PluginSettings
} from '../types/plugin-settings.intf'

const TOKEN = 'controller-token'

const mcpResource = (over: Partial<ManualResource> = {}): ManualResource => ({
    id: 'r1',
    enabled: true,
    type: 'application/mcp-server-card+json',
    slug: 'weather',
    displayName: 'Weather MCP',
    description: 'Weather forecasts and current conditions.',
    url: 'http://localhost:9000/card.json',
    capabilities: [],
    tags: [],
    representativeQueries: [],
    ...over
})

// Build settings directly (port 0 = ephemeral) bypassing the 1024 min on the user schema.
const settingsWith = (resources: ManualResource[]): PluginSettings => ({
    ...DEFAULT_SETTINGS,
    server: { ...DEFAULT_SETTINGS.server, port: 0, bearerToken: TOKEN },
    resources
})

describe('RegistryController', () => {
    let controller: RegistryController | undefined

    afterEach(async () => {
        await controller?.stop()
        controller = undefined
    })

    it('starts a server that serves the catalog built from manual resources', async () => {
        controller = new RegistryController()
        await controller.start(settingsWith([mcpResource()]))
        expect(controller.isRunning).toBe(true)
        expect(controller.catalogSize).toBe(1)

        const res = await fetch(`http://127.0.0.1:${controller.port}/.well-known/ai-catalog.json`)
        const body = (await res.json()) as { entries: Array<{ identifier: string }> }
        expect(body.entries[0]?.identifier).toBe('urn:air:obsidian:mcp:weather')
    })

    it('makes resources searchable with the registry base url as the source', async () => {
        controller = new RegistryController()
        await controller.start(settingsWith([mcpResource()]))

        const res = await fetch(`http://127.0.0.1:${controller.port}/search`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'authorization': `Bearer ${TOKEN}` },
            body: JSON.stringify({ query: { text: 'weather forecast' } })
        })
        const body = (await res.json()) as {
            results: Array<{ identifier: string; source: string }>
        }
        expect(body.results[0]?.identifier).toBe('urn:air:obsidian:mcp:weather')
        expect(body.results[0]?.source).toBe(`http://127.0.0.1:${controller.port}`)
    })

    it('stops cleanly', async () => {
        controller = new RegistryController()
        await controller.start(settingsWith([mcpResource()]))
        await controller.stop()
        expect(controller.isRunning).toBe(false)
    })

    it('rebuilds the catalog in place without restarting the server', async () => {
        controller = new RegistryController()
        await controller.start(settingsWith([mcpResource()]))
        const port = controller.port

        await controller.rebuild(
            settingsWith([
                mcpResource({ slug: 'news', displayName: 'News MCP', url: 'http://x/c.json' })
            ])
        )
        expect(controller.port).toBe(port) // same server
        expect(controller.catalogSize).toBe(1)

        const res = await fetch(`http://127.0.0.1:${controller.port}/.well-known/ai-catalog.json`)
        const body = (await res.json()) as { entries: Array<{ identifier: string }> }
        expect(body.entries[0]?.identifier).toBe('urn:air:obsidian:mcp:news')
    })

    it('reindexes the current catalog in place and keeps serving searches', async () => {
        controller = new RegistryController()
        await controller.start(settingsWith([mcpResource()]))
        const port = controller.port

        await controller.reindex()
        expect(controller.port).toBe(port) // same server, no restart
        expect(controller.catalogSize).toBe(1)

        const res = await fetch(`http://127.0.0.1:${controller.port}/search`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'authorization': `Bearer ${TOKEN}` },
            body: JSON.stringify({ query: { text: 'weather forecast' } })
        })
        const body = (await res.json()) as { results: Array<{ identifier: string }> }
        expect(body.results[0]?.identifier).toBe('urn:air:obsidian:mcp:weather')
    })

    it('reindex is a safe no-op when the registry is not running', async () => {
        controller = new RegistryController()
        await controller.reindex() // must not throw
        expect(controller.isRunning).toBe(false)
    })

    it('merges scanned skill entries with manual resources', async () => {
        controller = new RegistryController()
        await controller.start(settingsWith([mcpResource()]))

        await controller.setSkillEntries(
            settingsWith([mcpResource()]),
            [
                {
                    identifier: 'urn:air:obsidian:skills:my-skill',
                    displayName: 'My Skill',
                    type: 'application/ai-skill',
                    url: 'http://127.0.0.1/skills/my-skill/SKILL.md'
                }
            ],
            new Map()
        )

        expect(controller.catalogSize).toBe(2)
        const res = await fetch(`http://127.0.0.1:${controller.port}/.well-known/ai-catalog.json`)
        const body = (await res.json()) as { entries: Array<{ identifier: string }> }
        expect(body.entries.map((e) => e.identifier)).toContain('urn:air:obsidian:skills:my-skill')
        expect(body.entries.map((e) => e.identifier)).toContain('urn:air:obsidian:mcp:weather')
    })
})
