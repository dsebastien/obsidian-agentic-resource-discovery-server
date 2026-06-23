import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FsSkillFileService } from './skill-file-server'

let dir: string
let service: FsSkillFileService

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ard-files-'))
    await writeFile(join(dir, 'SKILL.md'), '# Hello\nbody')
    await mkdir(join(dir, 'scripts'), { recursive: true })
    await writeFile(join(dir, 'scripts', 'run.sh'), 'echo hi')
    await writeFile(join(dir, 'secret.exe'), 'BINARY')
    service = new FsSkillFileService(new Map([['my-skill', dir]]), 'http://127.0.0.1:27182')
})

afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
})

describe('FsSkillFileService.file', () => {
    it('serves SKILL.md with a markdown content type', async () => {
        const result = await service.file('my-skill', 'SKILL.md')
        expect(result).not.toBe('not-found')
        if (result === 'not-found' || result === 'forbidden') throw new Error('unexpected')
        expect(result.contentType).toContain('text/markdown')
        expect(new TextDecoder().decode(result.body)).toContain('# Hello')
    })

    it('serves nested bundle files with the right content type', async () => {
        const result = await service.file('my-skill', 'scripts/run.sh')
        if (result === 'not-found' || result === 'forbidden') throw new Error('unexpected')
        expect(result.contentType).toContain('x-sh')
    })

    it('forbids path traversal', async () => {
        expect(await service.file('my-skill', '../../etc/passwd')).toBe('forbidden')
    })

    it('forbids non-allowlisted extensions', async () => {
        expect(await service.file('my-skill', 'secret.exe')).toBe('forbidden')
    })

    it('returns not-found for unknown skills and missing files', async () => {
        expect(await service.file('nope', 'SKILL.md')).toBe('not-found')
        expect(await service.file('my-skill', 'missing.md')).toBe('not-found')
    })

    it('forbids reading through a symlink that escapes the skill folder', async () => {
        // A secret outside the skill root, and an allowlisted-extension symlink
        // inside the folder pointing at it. safeJoin passes (no ../), but the
        // realpath check must reject it.
        const outside = await mkdtemp(join(tmpdir(), 'ard-secret-'))
        const secret = join(outside, 'secret.md')
        await writeFile(secret, 'TOP SECRET')
        await symlink(secret, join(dir, 'escape.md'))
        try {
            expect(await service.file('my-skill', 'escape.md')).toBe('forbidden')
        } finally {
            await rm(outside, { recursive: true, force: true })
        }
    })

    it('still serves a symlink that stays inside the skill folder', async () => {
        await symlink(join(dir, 'SKILL.md'), join(dir, 'alias.md'))
        const result = await service.file('my-skill', 'alias.md')
        if (result === 'not-found' || result === 'forbidden') throw new Error('unexpected')
        expect(new TextDecoder().decode(result.body)).toContain('# Hello')
    })
})

describe('FsSkillFileService.manifest', () => {
    it('lists servable bundle files with absolute URLs', async () => {
        const manifest = await service.manifest('my-skill')
        expect(manifest).not.toBeNull()
        const paths = manifest!.files.map((f) => f.path).sort()
        expect(paths).toEqual(['SKILL.md', 'scripts/run.sh']) // .exe excluded
        const skillMd = manifest!.files.find((f) => f.path === 'SKILL.md')!
        expect(skillMd.url).toBe('http://127.0.0.1:27182/skills/my-skill/SKILL.md')
    })

    it('returns null for an unknown skill', async () => {
        expect(await service.manifest('nope')).toBeNull()
    })
})
