import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalArtifactStore, type LocalArtifact } from './local-artifact-store'

let root: string

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ard-store-')))
})
afterEach(async () => {
    await rm(root, { recursive: true, force: true })
})

const artifact = (over: Partial<LocalArtifact> = {}): LocalArtifact => ({
    urn: 'urn:air:obsidian:subagents:editor',
    path: join(root, 'editor.md'),
    root,
    contentType: 'text/markdown; charset=utf-8',
    route: '/subagents/editor.md',
    ...over
})

describe('LocalArtifactStore', () => {
    it('serves by URN and by route', async () => {
        await writeFile(join(root, 'editor.md'), 'prompt')
        const store = new LocalArtifactStore([artifact()])
        const byUrn = await store.serve('urn:air:obsidian:subagents:editor')
        const byRoute = await store.serveRoute('/subagents/editor.md')
        for (const served of [byUrn, byRoute]) {
            expect(served).not.toBe('not-found')
            expect(new TextDecoder().decode((served as { body: Uint8Array }).body)).toBe('prompt')
        }
    })

    it('answers not-found for unknown URNs, unknown routes and vanished files', async () => {
        const store = new LocalArtifactStore([artifact()])
        expect(await store.serve('urn:air:obsidian:subagents:nope')).toBe('not-found')
        expect(await store.serveRoute('/subagents/nope.md')).toBe('not-found')
        expect(await store.serve('urn:air:obsidian:subagents:editor')).toBe('not-found')
    })

    it('never serves a path outside its root, even if registered that way', async () => {
        const outside = await mkdtemp(join(tmpdir(), 'ard-outside-'))
        await writeFile(join(outside, 'x.md'), 'x')
        const store = new LocalArtifactStore([artifact({ path: join(outside, 'x.md') })])
        expect(await store.serve('urn:air:obsidian:subagents:editor')).toBe('forbidden')
        await rm(outside, { recursive: true, force: true })
    })

    it('is a plain lookup: routes are exact, no traversal interpretation', async () => {
        await writeFile(join(root, 'editor.md'), 'prompt')
        const store = new LocalArtifactStore([artifact()])
        expect(await store.serveRoute('/subagents/../subagents/editor.md')).toBe('not-found')
        expect(await store.serveRoute('/subagents/%2e%2e/editor.md')).toBe('not-found')
        expect(await store.serveRoute('/subagents/editor.md/')).toBe('not-found')
    })
})
