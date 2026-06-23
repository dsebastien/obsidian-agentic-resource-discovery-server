import { FileSystemAdapter, Notice, Plugin } from 'obsidian'
import { isAbsolute, join } from 'node:path'
import { produce } from 'immer'
import type { Draft } from 'immer'
import { DEFAULT_SETTINGS, parsePluginSettings } from './types/plugin-settings.intf'
import type { PluginSettings } from './types/plugin-settings.intf'
import { ArdServerSettingTab } from './settings/settings-tab'
import { RegistryController } from './server/registry-controller'
import { scanSkillFolders } from './skills/skill-scanner'
import { SkillWatcher, nodeFsWatchFn } from './skills/skill-watcher'
import { generateBearerToken, isBlankToken } from './utils/token'
import { log } from '../utils/log'

/**
 * Agentic Resource Discovery Server plugin.
 *
 * Turns the vault into a local-first ARD publisher + Agent Registry. Owns the
 * settings lifecycle and the {@link RegistryController} (catalog + search + HTTP
 * server), plus skill scanning and the MCP endpoint.
 */
export class ArdServerPlugin extends Plugin {
    /** Settings are kept immutable; mutate only via {@link updateSettings}. */
    override settings: PluginSettings = DEFAULT_SETTINGS

    /** How often to retry a failed embedding build (e.g. server started late). */
    private static readonly EMBEDDING_RETRY_INTERVAL_MS = 30_000

    private readonly registry = new RegistryController()

    /**
     * Serialises every registry-mutating operation (start, rescan, reindex,
     * settings reconcile) so the background skill scan and a concurrent settings
     * change can't race — e.g. both calling start() on the same port at once.
     */
    private opChain: Promise<void> = Promise.resolve()

    /** Set in onunload so no in-flight/queued op resurrects the server after stop. */
    private disposed = false

    private readonly watcher = new SkillWatcher(nodeFsWatchFn, {
        set: (callback, ms) => window.setTimeout(callback, ms),
        clear: (handle) => window.clearTimeout(handle as number)
    })

    override async onload(): Promise<void> {
        log('Initializing', 'debug')
        await this.loadSettings()
        await this.ensureBearerToken()

        this.addSettingTab(new ArdServerSettingTab(this.app, this))

        // Supervise the (opt-in) embedding backend: if its build failed because
        // the embedding server wasn't reachable, retry periodically so it
        // recovers once the server comes up — without disturbing a build still
        // in progress. registerInterval ties the timer to the plugin lifecycle.
        this.registerInterval(
            window.setInterval(
                () => this.retryEmbeddingsIfNeeded(),
                ArdServerPlugin.EMBEDDING_RETRY_INTERVAL_MS
            )
        )

        await this.serialize(() => this.startRegistry())
        // Scan skills after the workspace settles so we don't block load or
        // drown in vault events. The scan itself yields between chunks.
        this.app.workspace.onLayoutReady(() => {
            void this.rescanSkills()
            this.reconcileWatcher()
        })
    }

    /** Run a registry-mutating operation after any in-flight one completes. */
    private serialize(op: () => Promise<void>): Promise<void> {
        // Skip if the plugin has unloaded by the time this op is dequeued.
        const guarded = (): Promise<void> => (this.disposed ? Promise.resolve() : op())
        const next = this.opChain.then(guarded, guarded)
        this.opChain = next.then(
            () => undefined,
            () => undefined
        )
        return next
    }

    /**
     * Re-attempt embeddings when the backend's last build failed (e.g. the local
     * embedding server has since started). No-op while it's building, ready, or
     * when the backend has no embeddings — so a slow build is never interrupted.
     */
    private retryEmbeddingsIfNeeded(): void {
        if (this.registry.embeddingsNeedRetry) {
            log('Retrying failed embedding build', 'debug')
            void this.reindex()
        }
    }

    override onunload(): void {
        this.disposed = true
        this.watcher.stop()
        this.registry.stop().catch((error: unknown) => {
            log('Registry stop failed on unload', 'error', error)
        })
    }

    /** Load + validate persisted settings, always yielding a complete object. */
    async loadSettings(): Promise<void> {
        this.settings = parsePluginSettings(await this.loadData())
    }

    /** Generate and persist a bearer token on first run (when none exists yet). */
    async ensureBearerToken(): Promise<void> {
        if (!isBlankToken(this.settings.server.bearerToken)) {
            return
        }
        log('Generating bearer token (first run)', 'debug')
        this.settings = produce(this.settings, (draft) => {
            draft.server.bearerToken = generateBearerToken()
        })
        await this.saveSettings()
    }

    /** Apply an immutable update, persist it, and reconcile the running server. */
    async updateSettings(updater: (draft: Draft<PluginSettings>) => void): Promise<void> {
        const previous = this.settings
        this.settings = produce(this.settings, updater)
        await this.saveSettings()
        await this.serialize(() => this.syncRegistry(previous, this.settings))
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings)
    }

    /**
     * Scan the configured skill folders and feed the results into the catalog.
     * Non-blocking: yields to the UI between chunks via window.setTimeout.
     */
    async rescanSkills(): Promise<void> {
        return this.serialize(() => this.doRescanSkills())
    }

    private async doRescanSkills(): Promise<void> {
        const folders = this.resolveSkillFolders()
        if (folders.length === 0) {
            return
        }
        const port = this.registry.port ?? this.settings.server.port
        try {
            const result = await scanSkillFolders(
                folders,
                { publisher: this.settings.publisher, baseUrl: `http://127.0.0.1:${port}` },
                { scheduler: () => new Promise((resolve) => window.setTimeout(resolve, 0)) }
            )
            if (this.disposed) {
                return // unloaded mid-scan; don't resurrect the registry
            }
            await this.registry.setSkillEntries(this.settings, result.entries, result.folders)
            this.settings = produce(this.settings, (draft) => {
                draft.lastScanStats = {
                    skillCount: result.skillCount,
                    errorCount: result.errorCount,
                    lastScanAt: new Date().toISOString()
                }
            })
            await this.saveSettings()
            const dupes = result.duplicateCount > 0 ? `, ${result.duplicateCount} duplicates` : ''
            log(
                `Scanned ${result.skillCount} skills (${result.errorCount} errors${dupes})`,
                'debug'
            )
        } catch (error) {
            log('Skill scan failed', 'error', error)
        }
    }

    /**
     * Rebuild the search index over the current catalog without rescanning the
     * vault or restarting the server. Useful after switching backend or to
     * refresh a stale index.
     */
    async reindex(): Promise<void> {
        return this.serialize(async () => {
            try {
                await this.registry.reindex()
                log('Search index rebuilt', 'debug')
            } catch (error) {
                log('Reindex failed', 'error', error)
            }
        })
    }

    private async startRegistry(): Promise<void> {
        try {
            await this.registry.start(this.settings)
            log('Registry server started', 'debug')
        } catch (error) {
            log('Failed to start registry server', 'error', error)
            new Notice(
                `ARD: could not start the registry server on port ${this.settings.server.port}. ` +
                    `It may already be in use — change the port in settings.`
            )
        }
    }

    /** Reconcile the running server with a settings change. */
    private async syncRegistry(previous: PluginSettings, next: PluginSettings): Promise<void> {
        try {
            // The search backend is built once at start, capturing its config
            // (e.g. the embedding server URL/model), so any backend-config change
            // must recreate it — i.e. restart the registry, not just rebuild.
            const prevBackend = previous.searchBackend
            const nextBackend = next.searchBackend
            const backendChanged =
                prevBackend.kind !== nextBackend.kind ||
                prevBackend.embeddingServerUrl !== nextBackend.embeddingServerUrl ||
                prevBackend.embeddingModel !== nextBackend.embeddingModel ||
                prevBackend.apiProvider !== nextBackend.apiProvider ||
                prevBackend.apiBaseUrl !== nextBackend.apiBaseUrl ||
                prevBackend.apiKey !== nextBackend.apiKey ||
                prevBackend.apiModel !== nextBackend.apiModel
            const serverChanged =
                previous.server.port !== next.server.port ||
                previous.server.bindAddress !== next.server.bindAddress ||
                backendChanged
            if (!this.registry.isRunning || serverChanged) {
                await this.startRegistry()
            } else {
                await this.registry.rebuild(next)
            }
            this.reconcileWatcher()
        } catch (error) {
            log('Failed to reconcile registry server', 'error', error)
        }
    }

    /** Start or stop the opt-in skill-folder watcher to match current settings. */
    private reconcileWatcher(): void {
        const folders = this.resolveSkillFolders()
        if (this.settings.watchSkillFolders && folders.length > 0) {
            const failed = this.watcher.start(folders, () => void this.rescanSkills())
            if (failed.length > 0) {
                new Notice(
                    `ARD: could not watch ${failed.length} skill folder(s) for changes. ` +
                        `Use "Rescan skills now" to pick up edits manually.`
                )
            }
        } else {
            this.watcher.stop()
        }
    }

    /**
     * Resolve configured skill folders to absolute filesystem paths. Absolute
     * paths are used as-is; vault-relative paths (e.g. from the folder picker)
     * are resolved against the vault base path. Blank entries are dropped.
     */
    private resolveSkillFolders(): string[] {
        const base = this.vaultBasePath()
        return this.settings.skillFolders
            .map((folder) => folder.trim())
            .filter((folder) => folder.length > 0)
            .map((folder) => (isAbsolute(folder) || !base ? folder : join(base, folder)))
    }

    private vaultBasePath(): string {
        const adapter = this.app.vault.adapter
        return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : ''
    }
}
