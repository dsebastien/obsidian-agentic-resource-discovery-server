import { readFile, realpath, stat } from 'node:fs/promises'
import { sep } from 'node:path'

/**
 * A locally served artifact: the file behind a catalog entry's `url`.
 *
 * Bound to the entry's URN at scan time, so a body is always resolved by
 * identity — never by parsing a URL. That closes the confused-deputy hole where
 * a manually configured resource whose URL merely *looks* like a local route
 * (`/subagents/editor.md`) could have been answered with a local file.
 */
export interface LocalArtifact {
    urn: string
    /** Absolute path as discovered by the scanner. */
    path: string
    /** Absolute, realpath-resolved root the file was scanned under. */
    root: string
    contentType: string
    /** Registry path the artifact is served at, e.g. `/subagents/editor.md`. */
    route: string
}

export interface ServedArtifact {
    contentType: string
    body: Uint8Array
}

/** Largest artifact the store will serve (a definition, not a book). */
export const MAX_ARTIFACT_BYTES = 1024 * 1024

/**
 * URN → artifact lookup plus a route index, rebuilt atomically with the
 * catalog. Serving re-checks containment through `realpath` at request time so
 * a symlink swapped in after the scan cannot redirect a route outside its root.
 */
export class LocalArtifactStore {
    private readonly byUrn = new Map<string, LocalArtifact>()
    private readonly routes = new Map<string, LocalArtifact>()

    constructor(artifacts: Iterable<LocalArtifact> = []) {
        for (const artifact of artifacts) {
            this.byUrn.set(artifact.urn, artifact)
            this.routes.set(artifact.route, artifact)
        }
    }

    get size(): number {
        return this.byUrn.size
    }

    get(urn: string): LocalArtifact | undefined {
        return this.byUrn.get(urn)
    }

    byRoute(route: string): LocalArtifact | undefined {
        return this.routes.get(route)
    }

    /** Serve an artifact by URN. `'not-found'` covers unknown URNs and vanished files. */
    async serve(urn: string): Promise<ServedArtifact | 'not-found' | 'forbidden'> {
        const artifact = this.byUrn.get(urn)
        if (!artifact) {
            return 'not-found'
        }
        return serveArtifact(artifact)
    }

    /** Serve an artifact by its registry route (the HTTP adapter's entry point). */
    async serveRoute(route: string): Promise<ServedArtifact | 'not-found' | 'forbidden'> {
        const artifact = this.routes.get(route)
        if (!artifact) {
            return 'not-found'
        }
        return serveArtifact(artifact)
    }
}

async function serveArtifact(
    artifact: LocalArtifact
): Promise<ServedArtifact | 'not-found' | 'forbidden'> {
    let real: string
    try {
        real = await realpath(artifact.path)
    } catch {
        return 'not-found'
    }
    if (real !== artifact.root && !real.startsWith(artifact.root + sep)) {
        return 'forbidden'
    }
    try {
        const info = await stat(real)
        if (!info.isFile() || info.size > MAX_ARTIFACT_BYTES) {
            return 'forbidden'
        }
        return { contentType: artifact.contentType, body: new Uint8Array(await readFile(real)) }
    } catch {
        return 'not-found'
    }
}

/** Resolve a scan root once so per-request containment checks compare realpaths. */
export async function resolveRoot(root: string): Promise<string> {
    try {
        return await realpath(root)
    } catch {
        return root
    }
}
