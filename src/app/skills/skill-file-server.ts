import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, posix } from 'node:path'
import { safeJoin } from '../utils/path-safety'

/** Extensions the registry will serve, mapped to their content type. */
const CONTENT_TYPES: Record<string, string> = {
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.ts': 'application/typescript; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.sh': 'application/x-sh; charset=utf-8',
    '.py': 'text/x-python; charset=utf-8',
    '.yaml': 'application/yaml; charset=utf-8',
    '.yml': 'application/yaml; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf'
}

const MAX_BUNDLE_DEPTH = 6

export interface ServedFile {
    contentType: string
    body: Uint8Array
}

export interface SkillManifestFile {
    path: string
    url: string
    type: string
    size: number
}

export interface SkillManifest {
    name: string
    files: SkillManifestFile[]
}

/**
 * Serves the files that make up a skill (SKILL.md + bundled assets) over HTTP.
 *
 * The only seam the router needs: given a skill name and a relative path, hand
 * back the bytes (or a `'forbidden'` / `'not-found'` sentinel). Security lives
 * here — every path goes through {@link safeJoin} and an extension allowlist, so
 * a request can never escape a configured skill folder or serve arbitrary files.
 */
export interface SkillFileService {
    manifest(name: string): Promise<SkillManifest | null>
    file(name: string, relPath: string): Promise<ServedFile | 'not-found' | 'forbidden'>
}

/** Filesystem-backed {@link SkillFileService}. */
export class FsSkillFileService implements SkillFileService {
    /**
     * @param roots  skill folder name → absolute directory path
     * @param baseUrl registry base URL used to build asset URLs in manifests
     */
    constructor(
        private readonly roots: Map<string, string>,
        private readonly baseUrl: string
    ) {}

    async file(name: string, relPath: string): Promise<ServedFile | 'not-found' | 'forbidden'> {
        const root = this.roots.get(name)
        if (!root) {
            return 'not-found'
        }
        const absolute = safeJoin(root, relPath)
        if (!absolute) {
            return 'forbidden'
        }
        const contentType = CONTENT_TYPES[extname(absolute).toLowerCase()]
        if (!contentType) {
            return 'forbidden'
        }
        try {
            const body = new Uint8Array(await readFile(absolute))
            return { contentType, body }
        } catch {
            return 'not-found'
        }
    }

    async manifest(name: string): Promise<SkillManifest | null> {
        const root = this.roots.get(name)
        if (!root) {
            return null
        }
        const relPaths = await listServableFiles(root)
        const files: SkillManifestFile[] = []
        for (const rel of relPaths) {
            const type = CONTENT_TYPES[extname(rel).toLowerCase()]
            if (!type) {
                continue
            }
            const size = await fileSize(join(root, rel))
            files.push({
                path: rel,
                url: `${this.baseUrl}/skills/${encodeURIComponent(name)}/${rel}`,
                type,
                size
            })
        }
        files.sort((a, b) => a.path.localeCompare(b.path))
        return { name, files }
    }
}

async function listServableFiles(root: string): Promise<string[]> {
    const result: string[] = []
    await walk(root, '', 0, result)
    return result
}

async function walk(root: string, prefix: string, depth: number, out: string[]): Promise<void> {
    if (depth > MAX_BUNDLE_DEPTH) {
        return
    }
    let dirents
    try {
        dirents = await readdir(join(root, prefix), { withFileTypes: true })
    } catch {
        return
    }
    for (const dirent of dirents) {
        const rel = prefix ? posix.join(prefix, dirent.name) : dirent.name
        if (dirent.isFile()) {
            out.push(rel)
        } else if (dirent.isDirectory()) {
            await walk(root, rel, depth + 1, out)
        }
    }
}

async function fileSize(path: string): Promise<number> {
    try {
        return (await stat(path)).size
    } catch {
        return 0
    }
}
