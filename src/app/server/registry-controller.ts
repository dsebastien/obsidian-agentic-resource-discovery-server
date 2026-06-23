import { CatalogService } from '../catalog/catalog-service'
import { manualResourcesToEntries } from '../catalog/resource-mapper'
import { LexicalSearchBackend } from '../search/lexical-search-backend'
import type { SearchBackend } from '../search/search-backend'
import type { CatalogEntry, HostInfo } from '../types/ard.types'
import type { PluginSettings } from '../types/plugin-settings.intf'
import { ArdHttpServer } from './http-server'
import { createRouter, type RouterDeps } from './router'

/**
 * Owns the running registry: catalog, search index, and HTTP server.
 *
 * This is the single seam the plugin drives — it never sees routers or sockets.
 * The router closes over a mutable {@link RouterDeps} object, so {@link rebuild}
 * can swap the catalog and reindex in place while the server keeps serving.
 */
export class RegistryController {
    private readonly search: SearchBackend = new LexicalSearchBackend()
    private server: ArdHttpServer | null = null
    private deps: RouterDeps | null = null
    private catalog: CatalogService | null = null
    /** Entries from the latest skill scan; merged with manual resources. */
    private skillEntries: CatalogEntry[] = []

    /** Build the catalog/index from settings and start the HTTP server. */
    async start(settings: PluginSettings): Promise<void> {
        await this.stop()

        const catalog = await this.buildCatalog(settings)
        const deps: RouterDeps = {
            catalog,
            search: this.search,
            bearerToken: settings.server.bearerToken,
            baseUrl: `http://127.0.0.1:${settings.server.port}`,
            enableCors: settings.server.enableCors
        }
        const server = new ArdHttpServer(createRouter(deps))
        await server.start(settings.server.port, settings.server.bindAddress)
        // Pin the source URL to the actual bound port (handles ephemeral port 0).
        deps.baseUrl = `http://127.0.0.1:${server.port}`

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
        this.deps.bearerToken = settings.server.bearerToken
        this.deps.enableCors = settings.server.enableCors
        this.catalog = catalog
    }

    /** Replace the scanned-skill entries and rebuild the catalog in place. */
    async setSkillEntries(settings: PluginSettings, entries: CatalogEntry[]): Promise<void> {
        this.skillEntries = entries
        await this.rebuild(settings)
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
