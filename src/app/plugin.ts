import { FileSystemAdapter, Notice, Plugin, normalizePath } from 'obsidian'
import { isAbsolute, join } from 'node:path'
import { produce } from 'immer'
import type { Draft } from 'immer'
import { DEFAULT_SETTINGS, parsePluginSettings } from './types/plugin-settings.intf'
import type { PluginSettings } from './types/plugin-settings.intf'
import { ArdServerSettingTab } from './settings/settings-tab'
import { RegistryController } from './server/registry-controller'
import { RegistryCoordinator } from './server/registry-coordinator'
import { PersistentEmbeddingCache } from './search/embedding/persistent-embedding-cache'
import { scanSkillFolders, type ScanResult } from './skills/skill-scanner'
import { SkillWatcher, nodeFsWatchFn } from './skills/skill-watcher'
import { generateBearerToken, isBlankToken } from './utils/token'
import { log } from '../utils/log'
import { registerWhatsNewDialog } from './whats-new'

/** Side file (next to the plugin) holding cached embedding vectors. */
const EMBEDDING_CACHE_FILE = 'embedding-cache.json'

/**
 * Agentic Resource Discovery Server plugin.
 *
 * Turns the vault into a local-first ARD publisher + Agent Registry. This class
 * is deliberately thin: it owns the settings lifecycle and translates between
 * Obsidian (vault paths, notices, timers, the settings tab) and the
 * {@link RegistryCoordinator}, which holds all lifecycle/orchestration logic and
 * is unit-tested without Obsidian.
 */
export class ArdServerPlugin extends Plugin {
    /** Settings are kept immutable; mutate only via {@link updateSettings}. */
    // No `override`: `Plugin.settings` only exists in API 1.13+ typings and the
    // plugin supports older public releases.
    settings: PluginSettings = DEFAULT_SETTINGS

    /** How often to retry a failed embedding build (e.g. server started late). */
    private static readonly EMBEDDING_RETRY_INTERVAL_MS = 30_000

    private readonly embeddingCache = new PersistentEmbeddingCache({
        read: () => this.readEmbeddingCache(),
        write: (data) => this.writeEmbeddingCache(data)
    })

    readonly registry = new RegistryController(this.embeddingCache)

    /** Kept so a background rescan can refresh the open settings tab's scan stats. */
    private settingTab: ArdServerSettingTab | null = null

    private readonly watcher = new SkillWatcher(nodeFsWatchFn, {
        set: (callback, ms) => window.setTimeout(callback, ms),
        clear: (handle) => window.clearTimeout(handle as number)
    })

    private readonly coordinator = new RegistryCoordinator({
        registry: this.registry,
        watcher: this.watcher,
        settings: () => this.settings,
        skillFolders: () => this.resolveSkillFolders(),
        scan: (folders, ctx, cache) =>
            scanSkillFolders(folders, ctx, {
                cache,
                // Yield to the UI between chunks so a big scan never freezes it.
                scheduler: () => new Promise((resolve) => window.setTimeout(resolve, 0))
            }),
        onScanned: (result) => this.recordScanStats(result),
        notify: (message) => {
            new Notice(message)
        }
    })

    override async onload(): Promise<void> {
        // Must run before anything can call saveData (fresh-install detection)
        registerWhatsNewDialog(this)
        log('Initializing', 'debug')
        await this.loadSettings()
        await this.ensureBearerToken()
        // Warm embeddings from the previous session so a semantic backend is
        // ready immediately instead of re-embedding the whole catalog.
        await this.embeddingCache.load()

        this.settingTab = new ArdServerSettingTab(this.app, this)
        this.addSettingTab(this.settingTab)

        // Supervise the (opt-in) embedding backend: if its build failed because
        // the embedding server wasn't reachable, retry periodically so it
        // recovers once the server comes up — without disturbing a build still
        // in progress. registerInterval ties the timer to the plugin lifecycle.
        this.registerInterval(
            window.setInterval(
                () => this.coordinator.retryEmbeddingsIfNeeded(),
                ArdServerPlugin.EMBEDDING_RETRY_INTERVAL_MS
            )
        )

        await this.coordinator.start()
        // Scan skills after the workspace settles so we don't block load or
        // drown in vault events. The scan itself yields between chunks.
        this.app.workspace.onLayoutReady(() => {
            void this.rescanSkills()
            this.coordinator.reconcileWatcher()
        })
    }

    override onunload(): void {
        this.coordinator.dispose()
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
        await this.coordinator.applySettings(previous, this.settings)
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings)
    }

    /** Scan the configured skill folders and feed the results into the catalog. */
    async rescanSkills(): Promise<void> {
        return this.coordinator.rescanSkills()
    }

    /**
     * Rebuild the search index over the current catalog without rescanning the
     * vault or restarting the server.
     */
    async reindex(): Promise<void> {
        return this.coordinator.reindex()
    }

    /** Persist the scan stats and refresh an open settings tab. */
    private async recordScanStats(result: ScanResult): Promise<void> {
        this.settings = produce(this.settings, (draft) => {
            draft.lastScanStats = {
                skillCount: result.skillCount,
                errorCount: result.errorCount,
                lastScanAt: new Date().toISOString()
            }
        })
        await this.saveSettings()
        // Refresh the settings tab so its scan stats update even when the
        // rescan was triggered in the background (watcher), not by the button.
        this.settingTab?.display()
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

    /** Vault-relative path of the embedding cache side file, if the plugin dir is known. */
    private embeddingCachePath(): string | null {
        const dir = this.manifest.dir
        return dir ? normalizePath(`${dir}/${EMBEDDING_CACHE_FILE}`) : null
    }

    private async readEmbeddingCache(): Promise<string | null> {
        const path = this.embeddingCachePath()
        if (!path || !(await this.app.vault.adapter.exists(path))) {
            return null
        }
        return this.app.vault.adapter.read(path)
    }

    private async writeEmbeddingCache(data: string): Promise<void> {
        const path = this.embeddingCachePath()
        if (path) {
            await this.app.vault.adapter.write(path, data)
        }
    }
}
