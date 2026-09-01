import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
    type LocalArtifact,
    MAX_ARTIFACT_BYTES,
    resolveRoot
} from '../artifacts/local-artifact-store'
import { sanitizeUrnSegment } from '../domain/urn'
import { parseSkill } from '../skills/skill-parser'
import type { ScanContext } from '../skills/skill-scanner'
import type { CatalogEntry } from '../types/ard.types'
import { buildAgentEntry } from './agent-enricher'

const DEFINITION_EXT = '.md'
const DEFAULT_CHUNK_SIZE = 20
/** Registry path prefix subagent definitions are served under. */
export const SUBAGENTS_ROUTE_PREFIX = '/subagents/'

/** One previously built definition, keyed by its file path. */
export interface AgentScanCacheEntry {
    mtimeMs: number
    entry: CatalogEntry
    artifact: LocalArtifact
}

export interface AgentScanCache {
    publisher: string
    baseUrl: string
    files: Map<string, AgentScanCacheEntry>
}

export interface AgentScanOptions {
    chunkSize?: number
    scheduler?: () => Promise<void>
    cache?: AgentScanCache
}

export interface AgentScanResult {
    entries: CatalogEntry[]
    /** The definition file behind each entry, keyed by URN. */
    artifacts: LocalArtifact[]
    agentCount: number
    errorCount: number
    /** Definitions dropped because an earlier root already claimed the name. */
    duplicateCount: number
    /** Files skipped for lacking a `description` or exceeding the size cap. */
    skippedCount: number
    cache: AgentScanCache
}

/**
 * Scan folders of subagent definitions (`<name>.md` with frontmatter, the
 * Claude Code `.claude/agents/` shape) into catalog entries plus the artifacts
 * that serve their bodies.
 *
 * Non-recursive: the harness only reads top-level files, and a nested `.md`
 * under an agent folder is documentation, not a definition. Identity is the
 * sanitised file stem; the frontmatter `name` is metadata. First root in
 * settings order wins a name collision, matching the skill scanner's URN dedup.
 */
export async function scanAgentFolders(
    roots: string[],
    ctx: ScanContext,
    options: AgentScanOptions = {}
): Promise<AgentScanResult> {
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
    const scheduler = options.scheduler ?? (() => Promise.resolve())
    const previous =
        options.cache?.publisher === ctx.publisher && options.cache.baseUrl === ctx.baseUrl
            ? options.cache.files
            : undefined

    const files = await discoverDefinitionFiles(roots)

    const entries: CatalogEntry[] = []
    const artifacts: LocalArtifact[] = []
    const seen = new Set<string>()
    const cacheFiles = new Map<string, AgentScanCacheEntry>()
    let agentCount = 0
    let errorCount = 0
    let duplicateCount = 0
    let skippedCount = 0

    for (let i = 0; i < files.length; i += chunkSize) {
        const chunk = files.slice(i, i + chunkSize)
        const built = await Promise.all(chunk.map((file) => buildOne(file, ctx, previous)))
        for (const result of built) {
            if (result === 'error') {
                errorCount++
                continue
            }
            if (result === 'skipped') {
                skippedCount++
                continue
            }
            cacheFiles.set(result.file, {
                mtimeMs: result.mtimeMs,
                entry: result.entry,
                artifact: result.artifact
            })
            if (seen.has(result.entry.identifier)) {
                duplicateCount++
                continue
            }
            seen.add(result.entry.identifier)
            entries.push(result.entry)
            artifacts.push(result.artifact)
            agentCount++
        }
        await scheduler()
    }

    return {
        entries,
        artifacts,
        agentCount,
        errorCount,
        duplicateCount,
        skippedCount,
        cache: { publisher: ctx.publisher, baseUrl: ctx.baseUrl, files: cacheFiles }
    }
}

interface DiscoveredFile {
    path: string
    root: string
}

interface BuiltDefinition extends AgentScanCacheEntry {
    file: string
}

async function buildOne(
    found: DiscoveredFile,
    ctx: ScanContext,
    previous: Map<string, AgentScanCacheEntry> | undefined
): Promise<BuiltDefinition | 'skipped' | 'error'> {
    try {
        const stats = await stat(found.path)
        if (stats.size > MAX_ARTIFACT_BYTES) {
            return 'skipped'
        }
        const cached = previous?.get(found.path)
        if (cached && cached.mtimeMs === stats.mtimeMs) {
            return { ...cached, file: found.path }
        }
        const content = await readFile(found.path, 'utf-8')
        const parsed = parseSkill(content)
        if (
            typeof parsed.frontmatter.description !== 'string' ||
            !parsed.frontmatter.description.trim()
        ) {
            return 'skipped'
        }
        const name = sanitizeUrnSegment(basename(found.path, DEFINITION_EXT)).toLowerCase()
        const route = `${SUBAGENTS_ROUTE_PREFIX}${encodeURIComponent(name)}${DEFINITION_EXT}`
        const entry = buildAgentEntry({
            parsed,
            name,
            publisher: ctx.publisher,
            url: `${ctx.baseUrl}${route}`,
            updatedAt: stats.mtime.toISOString()
        })
        const artifact: LocalArtifact = {
            urn: entry.identifier,
            path: found.path,
            root: found.root,
            contentType: 'text/markdown; charset=utf-8',
            route
        }
        return { entry, artifact, file: found.path, mtimeMs: stats.mtimeMs }
    } catch {
        return 'error'
    }
}

/** Top-level `*.md` files of each root, in settings order then by name. */
async function discoverDefinitionFiles(roots: string[]): Promise<DiscoveredFile[]> {
    const found: DiscoveredFile[] = []
    for (const raw of roots) {
        if (!raw.trim()) continue
        const root = await resolveRoot(raw)
        let dirents
        try {
            dirents = await readdir(raw, { withFileTypes: true })
        } catch {
            continue // unreadable / non-existent root
        }
        const names = dirents
            .filter((d) => d.isFile() && extname(d.name).toLowerCase() === DEFINITION_EXT)
            .map((d) => d.name)
            .sort()
        for (const name of names) {
            found.push({ path: join(root, name), root })
        }
    }
    return found
}
