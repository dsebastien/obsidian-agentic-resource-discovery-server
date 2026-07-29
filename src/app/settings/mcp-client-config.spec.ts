import { describe, it, expect } from 'bun:test'
import {
    buildMcpClientConfig,
    buildSearchCurlExample,
    mcpEndpointUrl,
    registryBaseUrl
} from './mcp-client-config'

const ENDPOINT = { port: 27182, bearerToken: 'secret-token' }

describe('registry URLs', () => {
    it('always points at loopback', () => {
        expect(registryBaseUrl(27182)).toBe('http://127.0.0.1:27182')
        expect(mcpEndpointUrl(30000)).toBe('http://127.0.0.1:30000/mcp')
    })
})

describe('buildMcpClientConfig', () => {
    it('produces a valid mcpServers entry with the live URL and token', () => {
        const parsed = JSON.parse(buildMcpClientConfig(ENDPOINT)) as {
            mcpServers: Record<string, { url: string; headers: Record<string, string> }>
        }
        const server = parsed.mcpServers['obsidian-ard']
        expect(server?.url).toBe('http://127.0.0.1:27182/mcp')
        expect(server?.headers['Authorization']).toBe('Bearer secret-token')
    })

    it('honours a custom server name and ignores a blank one', () => {
        const named = JSON.parse(buildMcpClientConfig({ ...ENDPOINT, serverName: 'my-vault' })) as {
            mcpServers: Record<string, unknown>
        }
        expect(Object.keys(named.mcpServers)).toEqual(['my-vault'])

        const blank = JSON.parse(buildMcpClientConfig({ ...ENDPOINT, serverName: '  ' })) as {
            mcpServers: Record<string, unknown>
        }
        expect(Object.keys(blank.mcpServers)).toEqual(['obsidian-ard'])
    })

    it('is pretty-printed so it can be pasted as-is', () => {
        expect(buildMcpClientConfig(ENDPOINT)).toContain('\n  "mcpServers"')
    })
})

describe('buildSearchCurlExample', () => {
    it('includes the endpoint, the token, and a JSON body', () => {
        const curl = buildSearchCurlExample(ENDPOINT)
        expect(curl).toContain('http://127.0.0.1:27182/search')
        expect(curl).toContain('Authorization: Bearer secret-token')
        expect(curl).toContain('"text":"commit my changes"')
    })
})
