import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { type LocalArtifact, resolveRoot } from '../artifacts/local-artifact-store'
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

/** One previously built skill, keyed by its `SKILL.md` path. */
export interface ScanCacheEntry {
    mtimeMs: number
    entry: CatalogEntry
    folderName: string
    dir: string
    /** The SKILL.md behind the entry, bound to its URN for body serving. */
    artifact: LocalArtifact
}

/**
 * Result of a previous scan, handed back in to skip unchanged files.
 *
 * The context is part of the cache because entry URLs and URNs are derived from
 * it: a different publisher or base URL invalidates every cached entry.
 */
export interface ScanCache {
    publisher: string
    baseUrl: string
    files: Map<string, ScanCacheEntry>
}

export interface ScanOptions {
    chunkSize?: number
    /**
     * Awaited between chunks to keep a large scan non-blocking. Defaults to a
     * microtask yield; the plugin injects a `window.setTimeout`-based yield so
     * Obsidian's UI stays responsive while scanning hundreds of skills.
     */
    scheduler?: () => Promise<void>
    /**
     * Cache from the previous scan ({@link ScanResult.cache}). Files whose
     * mtime is unchanged are reused instead of being re-read and re-parsed.
     */
    cache?: ScanCache
}

export interface ScanResult {
    entries: CatalogEntry[]
    /** Skill folder name → absolute directory path (for serving bundle files). */
    folders: Map<string, string>
    /** One artifact per entry: the SKILL.md, resolved by URN. */
    artifacts: LocalArtifact[]
    skillCount: number
    errorCount: number
    /** Skills dropped because another skill already claimed the same URN. */
    duplicateCount: number
    /** Files actually read + parsed this scan (new or modified). */
    parsedCount: number
    /** Files served from the cache because their mtime was unchanged. */
    reusedCount: number
    /** Pass into the next scan to make it incremental. */
    cache: ScanCache
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
    // A cache built for a different publisher/base URL would yield stale URNs
    // and URLs, so it is dropped wholesale rather than partially trusted.
    const previous =
        options.cache?.publisher === ctx.publisher && options.cache.baseUrl === ctx.baseUrl
            ? options.cache.files
            : undefined

    const files = await discoverSkillFiles(roots)

    const entries: CatalogEntry[] = []
    const folders = new Map<string, string>()
    const artifacts: LocalArtifact[] = []
    const seen = new Set<string>()
    // Rebuilt from scratch every scan, so deleted files simply drop out.
    const cacheFiles = new Map<string, ScanCacheEntry>()
    let skillCount = 0
    let errorCount = 0
    let duplicateCount = 0
    let parsedCount = 0
    let reusedCount = 0

    for (let i = 0; i < files.length; i += chunkSize) {
        const chunk = files.slice(i, i + chunkSize)
        const built = await Promise.all(chunk.map((file) => buildEntry(file, ctx, previous)))
        for (const result of built) {
            if (!result) {
                errorCount++
                continue
            }
            if (result.reused) {
                reusedCount++
            } else {
                parsedCount++
            }
            cacheFiles.set(result.file, {
                mtimeMs: result.mtimeMs,
                entry: result.entry,
                folderName: result.folderName,
                dir: result.dir,
                artifact: result.artifact
            })
            if (seen.has(result.entry.identifier)) {
                duplicateCount++
                continue
            }
            seen.add(result.entry.identifier)
            entries.push(result.entry)
            folders.set(result.folderName, result.dir)
            artifacts.push(result.artifact)
            skillCount++
        }
        await scheduler()
    }

    return {
        entries,
        folders,
        artifacts,
        skillCount,
        errorCount,
        duplicateCount,
        parsedCount,
        reusedCount,
        cache: { publisher: ctx.publisher, baseUrl: ctx.baseUrl, files: cacheFiles }
    }
}

interface BuiltEntry extends ScanCacheEntry {
    /** Absolute path of the `SKILL.md` this was built from. */
    file: string
    /** True when the cached entry was reused (no read, no parse). */
    reused: boolean
}

async function buildEntry(
    file: string,
    ctx: ScanContext,
    previous: Map<string, ScanCacheEntry> | undefined
): Promise<BuiltEntry | null> {
    try {
        const stats = await stat(file)
        const cached = previous?.get(file)
        if (cached && cached.mtimeMs === stats.mtimeMs) {
            return { ...cached, file, reused: true }
        }
        const content = await readFile(file, 'utf-8')
        const dir = dirname(file)
        const folderName = basename(dir)
        const route = `/skills/${encodeURIComponent(folderName)}/${SKILL_FILE}`
        const entry = buildSkillEntry({
            parsed: parseSkill(content),
            name: folderName,
            publisher: ctx.publisher,
            url: `${ctx.baseUrl}${route}`,
            updatedAt: stats.mtime.toISOString()
        })
        const artifact: LocalArtifact = {
            urn: entry.identifier,
            path: file,
            root: await resolveRoot(dir),
            contentType: 'text/markdown; charset=utf-8',
            route
        }
        return { entry, folderName, dir, artifact, file, mtimeMs: stats.mtimeMs, reused: false }
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
