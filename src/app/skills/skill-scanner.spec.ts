import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises'
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

    it('reuses cached entries when nothing changed (no re-parse)', async () => {
        await writeSkill('alpha-skill', 'name: alpha-skill\ndescription: First.')
        await writeSkill('beta-skill', 'name: beta-skill\ndescription: Second.')

        const first = await scanSkillFolders([root], CTX)
        expect(first.parsedCount).toBe(2)
        expect(first.reusedCount).toBe(0)

        const second = await scanSkillFolders([root], CTX, { cache: first.cache })
        expect(second.parsedCount).toBe(0)
        expect(second.reusedCount).toBe(2)
        expect(second.skillCount).toBe(2)
        expect(second.entries).toEqual(first.entries)
    })

    it('re-parses only the skill whose file changed', async () => {
        await writeSkill('alpha-skill', 'name: alpha-skill\ndescription: First.')
        await writeSkill('beta-skill', 'name: beta-skill\ndescription: Second.')
        const first = await scanSkillFolders([root], CTX)

        await writeSkill('beta-skill', 'name: beta-skill\ndescription: Rewritten.')
        // Bump the mtime explicitly: a same-second rewrite can otherwise keep it.
        const changed = join(root, 'beta-skill', 'SKILL.md')
        await utimes(changed, new Date(), new Date(Date.now() + 5_000))

        const second = await scanSkillFolders([root], CTX, { cache: first.cache })
        expect(second.parsedCount).toBe(1)
        expect(second.reusedCount).toBe(1)
        const beta = second.entries.find((e) => e.identifier.endsWith('beta-skill'))
        expect(beta?.description).toBe('Rewritten.')
    })

    it('picks up a newly added skill without re-parsing the others', async () => {
        await writeSkill('alpha-skill', 'name: alpha-skill\ndescription: First.')
        const first = await scanSkillFolders([root], CTX)

        await writeSkill('gamma-skill', 'name: gamma-skill\ndescription: Third.')
        const second = await scanSkillFolders([root], CTX, { cache: first.cache })
        expect(second.parsedCount).toBe(1)
        expect(second.reusedCount).toBe(1)
        expect(second.skillCount).toBe(2)
    })

    it('drops entries for deleted skills', async () => {
        await writeSkill('alpha-skill', 'name: alpha-skill\ndescription: First.')
        await writeSkill('beta-skill', 'name: beta-skill\ndescription: Second.')
        const first = await scanSkillFolders([root], CTX)

        await rm(join(root, 'beta-skill'), { recursive: true, force: true })
        const second = await scanSkillFolders([root], CTX, { cache: first.cache })
        expect(second.skillCount).toBe(1)
        expect(second.entries.map((e) => e.identifier)).toEqual([
            'urn:air:obsidian:skills:alpha-skill'
        ])
        expect(second.cache.files.size).toBe(1)
    })

    it('ignores a cache built for a different publisher or base url', async () => {
        await writeSkill('alpha-skill', 'name: alpha-skill\ndescription: First.')
        const first = await scanSkillFolders([root], CTX)

        const moved = { publisher: 'example.com', baseUrl: 'http://127.0.0.1:30000' }
        const second = await scanSkillFolders([root], moved, { cache: first.cache })
        expect(second.parsedCount).toBe(1)
        expect(second.reusedCount).toBe(0)
        expect(second.entries[0]?.identifier).toBe('urn:air:example.com:skills:alpha-skill')
        expect(second.entries[0]?.url).toBe('http://127.0.0.1:30000/skills/alpha-skill/SKILL.md')
    })

    it('keeps duplicate handling correct across an incremental scan', async () => {
        await writeSkill('dir-one/dup', 'name: dup\ndescription: One.')
        await writeSkill('dir-two/dup', 'name: dup\ndescription: Two.')
        const first = await scanSkillFolders([root], CTX)
        expect(first.duplicateCount).toBe(1)

        const second = await scanSkillFolders([root], CTX, { cache: first.cache })
        expect(second.duplicateCount).toBe(1)
        expect(second.skillCount).toBe(1)
        expect(second.parsedCount).toBe(0)
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
