import { type LocalArtifact, LocalArtifactStore } from '../artifacts/local-artifact-store'
import { CatalogService } from '../catalog/catalog-service'
import { manualResourcesToEntries } from '../catalog/resource-mapper'
import type { EmbeddingCache } from '../search/embedding/embedding-cache'
import { LexicalSearchBackend } from '../search/lexical-search-backend'
import { createSearchBackend } from '../search/search-backend-factory'
import type { SearchBackend } from '../search/search-backend'
import { FsSkillFileService } from '../skills/skill-file-server'
import type { CatalogEntry, HostInfo } from '../types/ard.types'
import type { PluginSettings } from '../types/plugin-settings.intf'
import { ArdHttpServer } from './http-server'
import { createRouter, type RouterDeps } from './router'

/**
 * Everything one scan pass discovered, replaced as a unit so a client can never
 * observe fresh skills next to stale subagents (or a half-built index).
 */
export interface ScanSnapshot {
    skills: { entries: CatalogEntry[]; folders: Map<string, string>; artifacts: LocalArtifact[] }
    subagents: { entries: CatalogEntry[]; artifacts: LocalArtifact[] }
}

export const EMPTY_SNAPSHOT: ScanSnapshot = {
    skills: { entries: [], folders: new Map(), artifacts: [] },
    subagents: { entries: [], artifacts: [] }
}

/**
 * Owns the running registry: catalog, search index, skill file service, and the
 * HTTP server.
 *
 * This is the single seam the plugin drives — it never sees routers or sockets.
 * The router closes over a mutable {@link RouterDeps} object, so {@link rebuild}
 * can swap the catalog and reindex in place while the server keeps serving.
 */
export class RegistryController {
    /**
     * @param embeddingCache reused across restarts so switching settings (or
     * reloading the plugin) doesn't re-embed unchanged skills.
     */
    constructor(private readonly embeddingCache?: EmbeddingCache) {}

    private search: SearchBackend = new LexicalSearchBackend()
    private server: ArdHttpServer | null = null
    private deps: RouterDeps | null = null
    private catalog: CatalogService | null = null
    /** The latest scan, merged with manual resources into the catalog. */
    private snapshot: ScanSnapshot = EMPTY_SNAPSHOT
    private artifacts = new LocalArtifactStore()

    /** Build the catalog/index from settings and start the HTTP server. */
    async start(settings: PluginSettings): Promise<void> {
        await this.stop()

        this.search = createSearchBackend(settings.searchBackend, this.embeddingCache)
        const baseUrl = `http://127.0.0.1:${settings.server.port}`
        const catalog = await this.buildCatalog(settings)
        const deps: RouterDeps = {
            catalog,
            search: this.search,
            skillFiles: new FsSkillFileService(this.snapshot.skills.folders, baseUrl),
            artifacts: this.artifacts,
            bearerToken: settings.server.bearerToken,
            baseUrl,
            enableCors: settings.server.enableCors
        }
        const server = new ArdHttpServer(createRouter(deps))
        await server.start(settings.server.port, settings.server.bindAddress)
        // Pin URLs to the actual bound port (handles ephemeral port 0).
        deps.baseUrl = `http://127.0.0.1:${server.port}`
        deps.skillFiles = new FsSkillFileService(this.snapshot.skills.folders, deps.baseUrl)

        this.catalog = catalog
        this.deps = deps
        this.server = server
    }

    /** Rebuild the catalog + index in place. Falls back to a full start if down. */
    async rebuild(settings: PluginSettings): Promise<void> {
        if (!this.server || !this.deps) {
            await this.start(settings)
            return
        }
        const catalog = await this.buildCatalog(settings)
        this.deps.catalog = catalog
        this.deps.skillFiles = new FsSkillFileService(
            this.snapshot.skills.folders,
            this.deps.baseUrl
        )
        this.deps.artifacts = this.artifacts
        this.deps.bearerToken = settings.server.bearerToken
        this.deps.enableCors = settings.server.enableCors
        this.catalog = catalog
    }

    /**
     * Replace every scanned entry (skills and subagents) and the artifacts that
     * serve them, then rebuild the catalog and index once.
     */
    async setScannedEntries(settings: PluginSettings, snapshot: ScanSnapshot): Promise<void> {
        this.snapshot = snapshot
        this.artifacts = new LocalArtifactStore([
            ...snapshot.skills.artifacts,
            ...snapshot.subagents.artifacts
        ])
        await this.rebuild(settings)
    }

    /** Skill-only adapter over {@link setScannedEntries}; keeps prior subagents. */
    async setSkillEntries(
        settings: PluginSettings,
        entries: CatalogEntry[],
        folders: Map<string, string>,
        artifacts: LocalArtifact[] = []
    ): Promise<void> {
        await this.setScannedEntries(settings, {
            skills: { entries, folders, artifacts },
            subagents: this.snapshot.subagents
        })
    }

    /**
     * Re-run {@link SearchBackend.index} over the current catalog without
     * rebuilding it or restarting the server. Useful after switching backend or
     * to refresh the index. No-op when the registry is not running.
     */
    async reindex(): Promise<void> {
        if (!this.catalog) return
        await this.search.index(this.catalog.listAll())
    }

    async stop(): Promise<void> {
        await this.server?.stop()
        this.server = null
        this.deps = null
    }

    get isRunning(): boolean {
        return this.server?.isRunning ?? false
    }

    get port(): number | null {
        return this.server?.port ?? null
    }

    get catalogSize(): number {
        return this.catalog?.size ?? 0
    }

    /** Per-family entry counts for the status surfaces. */
    get catalogCounts(): { entries: number; skills: number; subagents: number; manual: number } {
        const skills = this.snapshot.skills.entries.length
        const subagents = this.snapshot.subagents.entries.length
        const entries = this.catalogSize
        return { entries, skills, subagents, manual: Math.max(0, entries - skills - subagents) }
    }

    /**
     * True when the backend's background embedding index failed and should be
     * retried (e.g. the embedding server wasn't up yet). False while it's still
     * building, already ready, idle, or the backend has no embeddings at all.
     */
    get embeddingsNeedRetry(): boolean {
        return this.search.embeddingState === 'failed'
    }

    /**
     * Lifecycle of the backend's dense-vector index, surfaced for the settings
     * status panel. `null` when the active backend has no embeddings at all
     * (the lexical default).
     */
    get embeddingState(): NonNullable<SearchBackend['embeddingState']> | null {
        return this.search.embeddingState ?? null
    }

    /** Identifier of the active search backend (e.g. `lexical`, `semantic`). */
    get searchBackendName(): string {
        return this.search.name
    }

    private async buildCatalog(settings: PluginSettings): Promise<CatalogService> {
        const catalog = new CatalogService(hostFrom(settings))
        const entries = [
            ...manualResourcesToEntries(settings.resources, settings.publisher),
            ...this.snapshot.skills.entries,
            ...this.snapshot.subagents.entries
        ]
        catalog.replaceEntries(entries)
        await this.search.index(entries)
        return catalog
    }
}

function hostFrom(settings: PluginSettings): HostInfo {
    return {
        displayName: settings.catalogDisplayName,
        identifier: settings.catalogIdentifier ?? settings.publisher
    }
}
