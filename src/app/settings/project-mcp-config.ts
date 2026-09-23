import type { PluginSettings } from '../types/plugin-settings.intf'
import { buildMcpServerEntry, type McpServerEntry } from './mcp-client-config'

/**
 * Keeps this registry's entry in the vault's project `.mcp.json` (the file
 * Claude Code and other MCP clients read from the project root).
 *
 * {@link mergeProjectMcpConfig} is the pure core: it decides what the file
 * should contain and whether anything needs writing. {@link ProjectMcpConfigSync}
 * wraps it with the file I/O and the once-per-session warning.
 */

/** Vault-relative path of the project MCP config. */
export const PROJECT_MCP_CONFIG_PATH = '.mcp.json'

/** Default key the registry is listed under in `.mcp.json`. */
export const DEFAULT_PROJECT_MCP_SERVER_NAME = 'ard'

/** The existing `.mcp.json` cannot be merged safely, so it must not be overwritten. */
export class ProjectMcpConfigError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ProjectMcpConfigError'
    }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

/** Structural equality for JSON values (key order ignored). */
const jsonEqual = (a: unknown, b: unknown): boolean => {
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]))
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        const keys = Object.keys(a)
        return (
            keys.length === Object.keys(b).length &&
            keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
        )
    }
    return a === b
}

/**
 * Merge `entry` into `mcpServers.<serverName>` of an existing `.mcp.json`.
 *
 * @param existing the current file content, or `null` when there is no file
 * @returns the new content (2-space indent, trailing newline), or `null` when
 *   the file already holds exactly this entry (nothing to write)
 * @throws {ProjectMcpConfigError} when the existing content is not a JSON
 *   object, or its `mcpServers` is not an object — overwriting would destroy
 *   the user's config
 */
export function mergeProjectMcpConfig(
    existing: string | null,
    serverName: string,
    entry: McpServerEntry
): string | null {
    let root: Record<string, unknown> = {}
    if (existing !== null && existing.trim().length > 0) {
        let parsed: unknown
        try {
            parsed = JSON.parse(existing)
        } catch {
            throw new ProjectMcpConfigError('.mcp.json is not valid JSON')
        }
        if (!isPlainObject(parsed)) {
            throw new ProjectMcpConfigError('.mcp.json is not a JSON object')
        }
        root = parsed
    }

    const servers = root['mcpServers'] ?? {}
    if (!isPlainObject(servers)) {
        throw new ProjectMcpConfigError('"mcpServers" in .mcp.json is not an object')
    }
    if (existing !== null && jsonEqual(servers[serverName], entry)) {
        return null
    }

    const next = { ...root, mcpServers: { ...servers, [serverName]: entry } }
    const content = `${JSON.stringify(next, null, 2)}\n`
    return content === existing ? null : content
}

/** File access the sync needs (the vault adapter in the plugin). */
export interface ProjectMcpConfigFile {
    read: () => Promise<string | null>
    write: (content: string) => Promise<void>
}

export interface ProjectMcpSyncTarget {
    port: number
    bearerToken: string
    serverName: string
}

export type ProjectMcpSyncOutcome = 'written' | 'unchanged' | 'skipped' | 'invalid'

/**
 * Writes the registry entry into `.mcp.json` when it changed. Warns once per
 * session (not on every settings change) when the file cannot be merged.
 */
export class ProjectMcpConfigSync {
    private warned = false

    constructor(
        private readonly file: ProjectMcpConfigFile,
        private readonly notify: (message: string) => void
    ) {}

    async sync(target: ProjectMcpSyncTarget): Promise<ProjectMcpSyncOutcome> {
        if (target.bearerToken.trim().length === 0) {
            return 'skipped'
        }
        const serverName = target.serverName.trim() || DEFAULT_PROJECT_MCP_SERVER_NAME
        const entry = buildMcpServerEntry({ port: target.port, bearerToken: target.bearerToken })
        let content: string | null
        try {
            content = mergeProjectMcpConfig(await this.file.read(), serverName, entry)
        } catch (error) {
            if (!(error instanceof ProjectMcpConfigError)) {
                throw error
            }
            if (!this.warned) {
                this.warned = true
                this.notify(
                    `ARD: could not update ${PROJECT_MCP_CONFIG_PATH} (${error.message}). ` +
                        `Fix the file, or turn off "Keep .mcp.json in sync".`
                )
            }
            return 'invalid'
        }
        this.warned = false
        if (content === null) {
            return 'unchanged'
        }
        await this.file.write(content)
        return 'written'
    }
}

/** Whether a settings change can alter what `.mcp.json` should contain. */
export function projectMcpConfigAffected(previous: PluginSettings, next: PluginSettings): boolean {
    return (
        next.syncProjectMcpConfig &&
        (!previous.syncProjectMcpConfig ||
            previous.server.port !== next.server.port ||
            previous.server.bearerToken !== next.server.bearerToken ||
            previous.projectMcpServerName !== next.projectMcpServerName)
    )
}
