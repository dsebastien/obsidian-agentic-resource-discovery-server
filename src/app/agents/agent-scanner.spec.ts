import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanAgentFolders } from './agent-scanner'
import { LocalArtifactStore } from '../artifacts/local-artifact-store'

const CTX = { publisher: 'obsidian', baseUrl: 'http://127.0.0.1:27182' }

let root: string
let other: string

const define = (dir: string, stem: string, body = '', description = `${stem} does things.`) =>
    writeFile(
        join(dir, `${stem}.md`),
        `---\nname: ${stem}\ndescription: ${description}\nmodel: sonnet\n---\n\n${body}`
    )

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ard-agents-'))
    other = await mkdtemp(join(tmpdir(), 'ard-agents-other-'))
})
afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
})

describe('scanAgentFolders', () => {
    it('turns each top-level definition into an entry plus a URN-bound artifact', async () => {
        await define(root, 'agent-osk-editor', 'You are the editor.')
        await define(root, 'researcher')
        const result = await scanAgentFolders([root], CTX)
        expect(result.agentCount).toBe(2)
        expect(result.entries.map((e) => e.identifier)).toEqual([
            'urn:air:obsidian:subagents:agent-osk-editor',
            'urn:air:obsidian:subagents:researcher'
        ])
        expect(result.artifacts[0]!.route).toBe('/subagents/agent-osk-editor.md')
        const store = new LocalArtifactStore(result.artifacts)
        const served = await store.serve('urn:air:obsidian:subagents:agent-osk-editor')
        expect(served).not.toBe('not-found')
        expect(new TextDecoder().decode((served as { body: Uint8Array }).body)).toContain(
            'You are the editor.'
        )
    })

    it('is non-recursive and ignores non-markdown files', async () => {
        await define(root, 'top')
        await mkdir(join(root, 'nested'))
        await define(join(root, 'nested'), 'deep')
        await writeFile(join(root, 'notes.txt'), 'x')
        const result = await scanAgentFolders([root], CTX)
        expect(result.entries.map((e) => e.displayName)).toEqual(['Top'])
    })

    it('skips definitions without a description and oversized files', async () => {
        await writeFile(join(root, 'nodesc.md'), '---\nname: nodesc\n---\nbody')
        await writeFile(
            join(root, 'huge.md'),
            `---\ndescription: big\n---\n${'x'.repeat(1024 * 1024 + 1)}`
        )
        await define(root, 'ok')
        const result = await scanAgentFolders([root], CTX)
        expect(result.skippedCount).toBe(2)
        expect(result.agentCount).toBe(1)
    })

    it('uses the sanitised file stem as identity, not the frontmatter name', async () => {
        await writeFile(
            join(root, 'Foo Bar.md'),
            '---\nname: something-else\ndescription: d.\n---\n'
        )
        const result = await scanAgentFolders([root], CTX)
        expect(result.entries[0]!.identifier).toBe('urn:air:obsidian:subagents:foo-bar')
        expect(result.artifacts[0]!.route).toBe('/subagents/foo-bar.md')
    })

    it('lets the first root win a name collision', async () => {
        await define(root, 'dup', 'first')
        await define(other, 'dup', 'second')
        const result = await scanAgentFolders([root, other], CTX)
        expect(result.agentCount).toBe(1)
        expect(result.duplicateCount).toBe(1)
        expect(result.artifacts[0]!.path).toBe(join(await realRoot(root), 'dup.md'))
    })

    it('reuses unchanged files from the cache', async () => {
        await define(root, 'cached')
        const first = await scanAgentFolders([root], CTX)
        const second = await scanAgentFolders([root], CTX, { cache: first.cache })
        expect(second.entries).toEqual(first.entries)
    })

    it('refuses to serve a definition whose file was swapped for a symlink outside the root', async () => {
        await define(root, 'victim')
        const result = await scanAgentFolders([root], CTX)
        const store = new LocalArtifactStore(result.artifacts)
        await rm(join(root, 'victim.md'))
        await writeFile(join(other, 'secret.md'), 'secret')
        await symlink(join(other, 'secret.md'), join(root, 'victim.md'))
        expect(await store.serve('urn:air:obsidian:subagents:victim')).toBe('forbidden')
    })

    it('tolerates an unreadable root', async () => {
        const result = await scanAgentFolders([join(root, 'missing')], CTX)
        expect(result.agentCount).toBe(0)
        expect(result.errorCount).toBe(0)
    })
})

async function realRoot(dir: string): Promise<string> {
    const { realpath } = await import('node:fs/promises')
    return realpath(dir)
}
