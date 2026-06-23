import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { CatalogEntry } from '../types/ard.types'
import { parseSkill } from './skill-parser'
import { buildSkillEntry } from './skill-enricher'

const SKILL_FILE = 'SKILL.md'
const SKIP_DIRS = new Set(['node_modules', '.git'])
const MAX_DEPTH = 8
const DEFAULT_CHUNK_SIZE = 20

export interface ScanContext {
    publisher: string
    /** Registry base URL, e.g. http://127.0.0.1:27182. */
    baseUrl: string
}

export interface ScanOptions {
    chunkSize?: number
    /**
     * Awaited between chunks to keep a large scan non-blocking. Defaults to a
     * microtask yield; the plugin injects a `window.setTimeout`-based yield so
     * Obsidian's UI stays responsive while scanning hundreds of skills.
     */
    scheduler?: () => Promise<void>
}

export interface ScanResult {
    entries: CatalogEntry[]
    skillCount: number
    errorCount: number
}

/**
 * Scan configured folders for Anthropic Agent Skills and build catalog entries.
 *
 * Discovers every `SKILL.md` under the roots, parses + enriches each in chunks
 * (yielding between them), deduplicates by URN, and tolerates per-file errors
 * (one bad file never aborts the scan). Folders may live outside the vault, so
 * this uses node fs directly rather than the Obsidian vault API.
 */
export async function scanSkillFolders(
    roots: string[],
    ctx: ScanContext,
    options: ScanOptions = {}
): Promise<ScanResult> {
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
    const scheduler = options.scheduler ?? (() => Promise.resolve())

    const files = await discoverSkillFiles(roots)

    const entries: CatalogEntry[] = []
    const seen = new Set<string>()
    let skillCount = 0
    let errorCount = 0

    for (let i = 0; i < files.length; i += chunkSize) {
        const chunk = files.slice(i, i + chunkSize)
        const built = await Promise.all(chunk.map((file) => buildEntry(file, ctx)))
        for (const entry of built) {
            if (!entry) {
                errorCount++
                continue
            }
            if (seen.has(entry.identifier)) {
                continue
            }
            seen.add(entry.identifier)
            entries.push(entry)
            skillCount++
        }
        await scheduler()
    }

    return { entries, skillCount, errorCount }
}

async function buildEntry(file: string, ctx: ScanContext): Promise<CatalogEntry | null> {
    try {
        const [content, stats] = await Promise.all([readFile(file, 'utf-8'), stat(file)])
        const name = basename(dirname(file))
        return buildSkillEntry({
            parsed: parseSkill(content),
            name,
            publisher: ctx.publisher,
            url: `${ctx.baseUrl}/skills/${encodeURIComponent(name)}/${SKILL_FILE}`,
            updatedAt: stats.mtime.toISOString()
        })
    } catch {
        return null
    }
}

/** Recursively collect every SKILL.md path under the given roots (sorted). */
async function discoverSkillFiles(roots: string[]): Promise<string[]> {
    const found: string[] = []
    for (const root of roots) {
        if (root.trim()) {
            await walk(root, 0, found)
        }
    }
    return found.sort()
}

async function walk(dir: string, depth: number, found: string[]): Promise<void> {
    if (depth > MAX_DEPTH) {
        return
    }
    let dirents
    try {
        dirents = await readdir(dir, { withFileTypes: true })
    } catch {
        return // unreadable / non-existent root
    }
    for (const dirent of dirents) {
        if (dirent.isFile() && dirent.name === SKILL_FILE) {
            found.push(join(dir, dirent.name))
        } else if (dirent.isDirectory() && !SKIP_DIRS.has(dirent.name)) {
            await walk(join(dir, dirent.name), depth + 1, found)
        }
    }
}
