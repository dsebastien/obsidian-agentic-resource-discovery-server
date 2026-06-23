import { CatalogService } from '../catalog/catalog-service'
import { manualResourcesToEntries } from '../catalog/resource-mapper'
import { LexicalSearchBackend } from '../search/lexical-search-backend'
import { createSearchBackend } from '../search/search-backend-factory'
import type { SearchBackend } from '../search/search-backend'
import { FsSkillFileService } from '../skills/skill-file-server'
import type { CatalogEntry, HostInfo } from '../types/ard.types'
import type { PluginSettings } from '../types/plugin-settings.intf'
import { ArdHttpServer } from './http-server'
import { createRouter, type RouterDeps } from './router'

/**
 * Owns the running registry: catalog, search index, skill file service, and the
 * HTTP server.
 *
 * This is the single seam the plugin drives — it never sees routers or sockets.
 * The router closes over a mutable {@link RouterDeps} object, so {@link rebuild}
 * can swap the catalog and reindex in place while the server keeps serving.
 */
export class RegistryController {
    private search: SearchBackend = new LexicalSearchBackend()
    private server: ArdHttpServer | null = null
    private deps: RouterDeps | null = null
    private catalog: CatalogService | null = null
    /** Entries from the latest skill scan; merged with manual resources. */
    private skillEntries: CatalogEntry[] = []
    /** Skill folder name → absolute directory path (for serving bundle files). */
    private skillFolders = new Map<string, string>()

    /** Build the catalog/index from settings and start the HTTP server. */
    async start(settings: PluginSettings): Promise<void> {
        await this.stop()

        this.search = createSearchBackend(settings.searchBackend)
        const baseUrl = `http://127.0.0.1:${settings.server.port}`
        const catalog = await this.buildCatalog(settings)
        const deps: RouterDeps = {
            catalog,
            search: this.search,
            skillFiles: new FsSkillFileService(this.skillFolders, baseUrl),
            bearerToken: settings.server.bearerToken,
            baseUrl,
            enableCors: settings.server.enableCors
        }
        const server = new ArdHttpServer(createRouter(deps))
        await server.start(settings.server.port, settings.server.bindAddress)
        // Pin URLs to the actual bound port (handles ephemeral port 0).
        deps.baseUrl = `http://127.0.0.1:${server.port}`
        deps.skillFiles = new FsSkillFileService(this.skillFolders, deps.baseUrl)

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
        this.deps.skillFiles = new FsSkillFileService(this.skillFolders, this.deps.baseUrl)
        this.deps.bearerToken = settings.server.bearerToken
        this.deps.enableCors = settings.server.enableCors
        this.catalog = catalog
    }

    /**
     * Replace the scanned-skill entries (and the folders they were served from)
     * and rebuild the catalog in place.
     */
    async setSkillEntries(
        settings: PluginSettings,
        entries: CatalogEntry[],
        folders: Map<string, string>
    ): Promise<void> {
        this.skillEntries = entries
        this.skillFolders = folders
        await this.rebuild(settings)
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

    /**
     * True when the backend's background embedding index failed and should be
     * retried (e.g. the embedding server wasn't up yet). False while it's still
     * building, already ready, idle, or the backend has no embeddings at all.
     */
    get embeddingsNeedRetry(): boolean {
        return this.search.embeddingState === 'failed'
    }

    private async buildCatalog(settings: PluginSettings): Promise<CatalogService> {
        const catalog = new CatalogService(hostFrom(settings))
        const entries = [
            ...manualResourcesToEntries(settings.resources, settings.publisher),
            ...this.skillEntries
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
