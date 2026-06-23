import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSkillFolders } from './skill-scanner'

const CTX = { publisher: 'obsidian', baseUrl: 'http://127.0.0.1:27182' }

let root: string

async function writeSkill(name: string, frontmatter: string, body = '# Title'): Promise<void> {
    const dir = join(root, name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}\n`)
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ard-scan-'))
})

afterEach(async () => {
    await rm(root, { recursive: true, force: true })
})

describe('scanSkillFolders', () => {
    it('discovers SKILL.md files and builds catalog entries', async () => {
        await writeSkill('alpha-skill', 'name: alpha-skill\ndescription: First.')
        await writeSkill('beta-skill', 'name: beta-skill\ndescription: Second.')

        const result = await scanSkillFolders([root], CTX)
        expect(result.skillCount).toBe(2)
        expect(result.errorCount).toBe(0)
        const ids = result.entries.map((e) => e.identifier).sort()
        expect(ids).toEqual([
            'urn:air:obsidian:skills:alpha-skill',
            'urn:air:obsidian:skills:beta-skill'
        ])
    })

    it('builds a skill resource URL from the base url and folder name', async () => {
        await writeSkill('alpha-skill', 'name: alpha-skill\ndescription: First.')
        const [entry] = (await scanSkillFolders([root], CTX)).entries
        expect(entry?.url).toBe('http://127.0.0.1:27182/skills/alpha-skill/SKILL.md')
    })

    it('discovers skills nested below the root', async () => {
        await writeSkill('group/nested-skill', 'name: nested-skill\ndescription: Deep.')
        const result = await scanSkillFolders([root], CTX)
        expect(result.entries.map((e) => e.identifier)).toContain(
            'urn:air:obsidian:skills:nested-skill'
        )
    })

    it('ignores non-skill files', async () => {
        await writeSkill('alpha-skill', 'name: alpha-skill\ndescription: First.')
        await writeFile(join(root, 'README.md'), '# not a skill')
        expect((await scanSkillFolders([root], CTX)).skillCount).toBe(1)
    })

    it('deduplicates skills with the same name', async () => {
        await writeSkill('dir-one/dup', 'name: dup\ndescription: One.')
        await writeSkill('dir-two/dup', 'name: dup\ndescription: Two.')
        expect((await scanSkillFolders([root], CTX)).skillCount).toBe(1)
    })

    it('returns empty for a non-existent root without throwing', async () => {
        const result = await scanSkillFolders([join(root, 'does-not-exist')], CTX)
        expect(result.skillCount).toBe(0)
        expect(result.entries).toEqual([])
    })

    it('yields to the injected scheduler between chunks', async () => {
        await writeSkill('a', 'name: a\ndescription: A.')
        await writeSkill('b', 'name: b\ndescription: B.')
        let yields = 0
        await scanSkillFolders([root], CTX, {
            chunkSize: 1,
            scheduler: async () => {
                yields++
            }
        })
        expect(yields).toBeGreaterThanOrEqual(2)
    })
})
