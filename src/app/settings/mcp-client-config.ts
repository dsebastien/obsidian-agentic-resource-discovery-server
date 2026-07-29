/**
 * Ready-to-paste client snippets for the running registry.
 *
 * Pointing an MCP client (Claude Code, Claude Desktop, …) at the registry means
 * assembling a URL and a bearer token by hand — the exact place users mistype a
 * secret. These builders are pure so the shape is unit-tested; the settings tab
 * only copies what they return.
 */

export interface RegistryEndpoint {
    /** Port the registry is actually listening on. */
    port: number
    bearerToken: string
    /** Key the server is listed under in the client config. */
    serverName?: string
}

const DEFAULT_SERVER_NAME = 'obsidian-ard'

/** Base URL of the registry. Loopback only (BR-1). */
export function registryBaseUrl(port: number): string {
    return `http://127.0.0.1:${port}`
}

/** MCP endpoint (Streamable HTTP) of the registry. */
export function mcpEndpointUrl(port: number): string {
    return `${registryBaseUrl(port)}/mcp`
}

/**
 * Streamable-HTTP MCP server entry, formatted as the `mcpServers` map every
 * major client accepts.
 */
export function buildMcpClientConfig(endpoint: RegistryEndpoint): string {
    const name = endpoint.serverName?.trim() || DEFAULT_SERVER_NAME
    return JSON.stringify(
        {
            mcpServers: {
                [name]: {
                    url: mcpEndpointUrl(endpoint.port),
                    headers: { Authorization: `Bearer ${endpoint.bearerToken}` }
                }
            }
        },
        null,
        2
    )
}

/** A copy-pasteable `curl` call against `POST /search`, for a quick sanity check. */
export function buildSearchCurlExample(endpoint: RegistryEndpoint): string {
    const body = JSON.stringify({ query: { text: 'commit my changes' } })
    return [
        `curl -s ${registryBaseUrl(endpoint.port)}/search \\`,
        `  -H 'Authorization: Bearer ${endpoint.bearerToken}' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d '${body}'`
    ].join('\n')
}
