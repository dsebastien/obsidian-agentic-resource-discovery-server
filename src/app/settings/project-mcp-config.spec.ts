import { describe, it, expect } from 'bun:test'
import { buildMcpServerEntry } from './mcp-client-config'
import {
    ProjectMcpConfigError,
    ProjectMcpConfigSync,
    mergeProjectMcpConfig,
    projectMcpConfigAffected
} from './project-mcp-config'
import { DEFAULT_SETTINGS, type PluginSettings } from '../types/plugin-settings.intf'

const ENTRY = buildMcpServerEntry({ port: 27182, bearerToken: 'secret-token' })

describe('mergeProjectMcpConfig', () => {
    it('creates the file when there is none', () => {
        const content = mergeProjectMcpConfig(null, 'ard', ENTRY)
        expect(content).toBe(
            '{\n' +
                '  "mcpServers": {\n' +
                '    "ard": {\n' +
                '      "type": "http",\n' +
                '      "url": "http://127.0.0.1:27182/mcp",\n' +
                '      "headers": {\n' +
                '        "Authorization": "Bearer secret-token"\n' +
                '      }\n' +
                '    }\n' +
                '  }\n' +
                '}\n'
        )
    })

    it('treats an empty file like a missing one', () => {
        const content = mergeProjectMcpConfig('  \n', 'ard', ENTRY)
        expect(JSON.parse(content ?? '')).toEqual({ mcpServers: { ard: ENTRY } })
    })

    it('preserves other servers and top-level keys', () => {
        const existing = JSON.stringify({
            other: { keep: true },
            mcpServers: { github: { command: 'gh-mcp', args: ['--x'] } }
        })
        const parsed = JSON.parse(mergeProjectMcpConfig(existing, 'ard', ENTRY) ?? '') as Record<
            string,
            unknown
        >
        expect(parsed).toEqual({
            other: { keep: true },
            mcpServers: { github: { command: 'gh-mcp', args: ['--x'] }, ard: ENTRY }
        })
    })

    it('replaces a stale entry (new port or token)', () => {
        const stale = mergeProjectMcpConfig(null, 'ard', ENTRY) ?? ''
        const fresh = buildMcpServerEntry({ port: 30000, bearerToken: 'new-token' })
        const parsed = JSON.parse(mergeProjectMcpConfig(stale, 'ard', fresh) ?? '') as {
            mcpServers: Record<string, unknown>
        }
        expect(parsed.mcpServers['ard']).toEqual(fresh)
    })

    it('returns null when the entry is already current', () => {
        const current = mergeProjectMcpConfig(null, 'ard', ENTRY) ?? ''
        expect(mergeProjectMcpConfig(current, 'ard', ENTRY)).toBeNull()
    })

    it('does not reformat a file whose entry is current but formatted differently', () => {
        const compact = JSON.stringify({ mcpServers: { ard: ENTRY }, z: 1 })
        expect(mergeProjectMcpConfig(compact, 'ard', ENTRY)).toBeNull()
    })

    it('uses the given server name', () => {
        const parsed = JSON.parse(mergeProjectMcpConfig(null, 'my-vault', ENTRY) ?? '') as {
            mcpServers: Record<string, unknown>
        }
        expect(Object.keys(parsed.mcpServers)).toEqual(['my-vault'])
    })

    it('refuses to overwrite invalid JSON', () => {
        expect(() => mergeProjectMcpConfig('{ "mcpServers": ', 'ard', ENTRY)).toThrow(
            ProjectMcpConfigError
        )
    })

    it('refuses a non-object root or a non-object mcpServers', () => {
        expect(() => mergeProjectMcpConfig('[]', 'ard', ENTRY)).toThrow(ProjectMcpConfigError)
        expect(() => mergeProjectMcpConfig('"x"', 'ard', ENTRY)).toThrow(ProjectMcpConfigError)
        expect(() => mergeProjectMcpConfig('{"mcpServers": []}', 'ard', ENTRY)).toThrow(
            ProjectMcpConfigError
        )
    })
})

describe('ProjectMcpConfigSync', () => {
    const makeSync = (initial: string | null) => {
        const state = { content: initial, writes: 0, notices: [] as string[] }
        const sync = new ProjectMcpConfigSync(
            {
                read: () => Promise.resolve(state.content),
                write: (content) => {
                    state.content = content
                    state.writes++
                    return Promise.resolve()
                }
            },
            (message) => state.notices.push(message)
        )
        return { sync, state }
    }
    const TARGET = { port: 27182, bearerToken: 'secret-token', serverName: 'ard' }

    it('writes once, then leaves an up-to-date file alone', async () => {
        const { sync, state } = makeSync(null)
        expect(await sync.sync(TARGET)).toBe('written')
        expect(await sync.sync(TARGET)).toBe('unchanged')
        expect(state.writes).toBe(1)
    })

    it('never writes an empty token', async () => {
        const { sync, state } = makeSync(null)
        expect(await sync.sync({ ...TARGET, bearerToken: ' ' })).toBe('skipped')
        expect(state.writes).toBe(0)
    })

    it('falls back to "ard" for a blank server name', async () => {
        const { sync, state } = makeSync(null)
        await sync.sync({ ...TARGET, serverName: '  ' })
        expect(state.content).toContain('"ard"')
    })

    it('does not touch invalid JSON and warns only once', async () => {
        const { sync, state } = makeSync('not json')
        expect(await sync.sync(TARGET)).toBe('invalid')
        expect(await sync.sync({ ...TARGET, port: 30000 })).toBe('invalid')
        expect(state.content).toBe('not json')
        expect(state.writes).toBe(0)
        expect(state.notices).toHaveLength(1)
    })
})

describe('projectMcpConfigAffected', () => {
    const on: PluginSettings = {
        ...DEFAULT_SETTINGS,
        syncProjectMcpConfig: true,
        server: { ...DEFAULT_SETTINGS.server, bearerToken: 'a' }
    }

    it('fires when the sync is turned on', () => {
        expect(projectMcpConfigAffected({ ...on, syncProjectMcpConfig: false }, on)).toBe(true)
    })

    it('fires on a port, token or server-name change while on', () => {
        expect(projectMcpConfigAffected(on, { ...on, server: { ...on.server, port: 30000 } })).toBe(
            true
        )
        expect(
            projectMcpConfigAffected(on, { ...on, server: { ...on.server, bearerToken: 'b' } })
        ).toBe(true)
        expect(projectMcpConfigAffected(on, { ...on, projectMcpServerName: 'vault' })).toBe(true)
    })

    it('ignores unrelated changes and anything while off', () => {
        expect(projectMcpConfigAffected(on, { ...on, publisher: 'x' })).toBe(false)
        expect(projectMcpConfigAffected(on, { ...on, syncProjectMcpConfig: false })).toBe(false)
    })
})
