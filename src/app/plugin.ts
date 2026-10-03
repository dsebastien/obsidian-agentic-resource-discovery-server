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
import { scanAgentFolders, type AgentScanResult } from './agents/agent-scanner'
import { scanSkillFolders, type ScanResult } from './skills/skill-scanner'
import { SkillWatcher, nodeFsWatchFn } from './skills/skill-watcher'
import { generateBearerToken } from './utils/token'
import {
    clearSecret,
    ensureBearerTokenSecret,
    isSecretMissing,
    migrateLegacySecrets,
    removeLegacySecretCopies,
    resolveBearerToken,
    resolveEmbeddingApiKey,
    rotateSecret,
    selectSecretName,
    type SecretField,
    type SecretStore
} from './settings/secrets'
import { log } from '../utils/log'
import {
    PROJECT_MCP_CONFIG_PATH,
    ProjectMcpConfigSync,
    projectMcpConfigAffected
} from './settings/project-mcp-config'
import { registerWhatsNewView } from './whats-new'

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
    override settings: PluginSettings = DEFAULT_SETTINGS

    /** How often to retry a failed embedding build (e.g. server started late). */
    private static readonly EMBEDDING_RETRY_INTERVAL_MS = 30_000

    private readonly embeddingCache = new PersistentEmbeddingCache({
        read: () => this.readEmbeddingCache(),
        write: (data) => this.writeEmbeddingCache(data)
    })

    readonly registry = new RegistryController(this.embeddingCache, {
        // Read per use from SecretStorage: never captured into settings.
        bearerToken: () => this.bearerToken(),
        embeddingApiKey: () => resolveEmbeddingApiKey(this.settings, this.secretStore)
    })

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
        skillFolders: () => this.resolveFolders(this.settings.skillFolders),
        agentFolders: () => this.resolveFolders(this.settings.agentFolders),
        scan: (folders, ctx, cache) =>
            scanSkillFolders(folders, ctx, {
                cache,
                // Yield to the UI between chunks so a big scan never freezes it.
                scheduler: () => new Promise((resolve) => window.setTimeout(resolve, 0))
            }),
        scanAgents: (folders, ctx, cache) =>
            scanAgentFolders(folders, ctx, {
                cache,
                scheduler: () => new Promise((resolve) => window.setTimeout(resolve, 0))
            }),
        onScanned: (result, agents) => this.recordScanStats(result, agents),
        notify: (message) => {
            new Notice(message)
        }
    })

    private readonly projectMcpSync = new ProjectMcpConfigSync(
        {
            read: async () => {
                const adapter = this.app.vault.adapter
                return (await adapter.exists(PROJECT_MCP_CONFIG_PATH))
                    ? adapter.read(PROJECT_MCP_CONFIG_PATH)
                    : null
            },
            write: (content) => this.app.vault.adapter.write(PROJECT_MCP_CONFIG_PATH, content)
        },
        (message) => {
            new Notice(message)
        }
    )

    override async onload(): Promise<void> {
        // Must run before anything can call saveData (fresh-install detection)
        registerWhatsNewView(this)
        log('Initializing', 'debug')
        await this.loadSettings()
        await this.prepareSecrets()
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
        await this.syncProjectMcpConfig()
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

    /** This device's Obsidian SecretStorage. */
    get secretStore(): SecretStore {
        return this.app.secretStorage
    }

    /** Bearer token in effect on this device ("" when it is missing here). */
    bearerToken(): string {
        return resolveBearerToken(this.settings, this.secretStore)
    }

    /** Whether a configured secret has no value on this device. */
    secretMissing(field: SecretField): boolean {
        return isSecretMissing(this.settings, this.secretStore, field)
    }

    /**
     * Per-device secret setup, on every load: copy legacy plaintext secrets into
     * this device's SecretStorage (purging them after the grace period), then
     * generate a bearer token on a fresh install only. A secret configured but
     * absent here is reported, never regenerated (that would break clients).
     */
    async prepareSecrets(): Promise<void> {
        try {
            const migration = migrateLegacySecrets(this.settings, this.secretStore)
            if (migration.failed.length > 0) {
                log(
                    `Could not move ${migration.failed.join(', ')} to secret storage; using the stored value`,
                    'warn'
                )
            }
            const ensured = ensureBearerTokenSecret(
                migration.settings,
                this.secretStore,
                generateBearerToken
            )
            if (migration.changed || ensured.state === 'generated') {
                this.settings = ensured.settings
                await this.saveSettings()
            }
            if (ensured.state === 'missing') {
                new Notice(
                    `ARD: the bearer token secret "${this.settings.server.bearerTokenSecretName}" is not set on ` +
                        'this device, so the registry refuses authenticated requests. Open the plugin ' +
                        'settings and set the token on this device (same value as on your other devices).',
                    0
                )
            }
            if (
                this.settings.searchBackend.kind === 'hosted-api' &&
                this.secretMissing('embeddingApiKey')
            ) {
                new Notice(
                    `ARD: the embedding API key secret "${this.settings.searchBackend.apiKeySecretName}" is ` +
                        'not set on this device. Set it in the plugin settings (Search backend).'
                )
            }
        } catch (error) {
            log('Failed to prepare secrets', 'error', error)
            new Notice('Could not access secret storage, so the registry may refuse requests.')
        }
    }

    /** Replace the bearer token (SecretStorage only); old clients stop working. */
    async regenerateBearerToken(): Promise<void> {
        await this.commitSettings((current) =>
            rotateSecret(current, this.secretStore, 'bearerToken', generateBearerToken())
        )
        await this.syncProjectMcpConfig()
    }

    /** Point a secret at another SecretStorage entry (picked in the settings tab). */
    selectSecret(field: SecretField, name: string): Promise<void> {
        return this.commitSettings((current) => selectSecretName(current, field, name))
    }

    /** Clear a secret on this device and drop its plain-text copy. */
    clearSecret(field: SecretField): Promise<void> {
        return this.commitSettings((current) => clearSecret(current, this.secretStore, field))
    }

    /** Drop the legacy plain-text secret copies from data.json now. */
    removeLegacySecretCopies(): Promise<void> {
        return this.commitSettings((current) => removeLegacySecretCopies(current))
    }

    /** Serializes settings writes; see updateSettings. */
    private settingsWriteChain: Promise<void> = Promise.resolve()

    /**
     * Apply an immutable update, persist it, and reconcile the running server.
     *
     * Persist-then-commit: memory is swapped only after saveData() succeeds,
     * so the declarative tab's rejection-based rollback reads the on-disk
     * truth rather than an optimistic mutation that never landed.
     *
     * Serialized: writes queue and each mutation derives from the previous
     * COMMITTED state — overlapping calls would otherwise produce from the
     * same base across the save await and silently drop the earlier edit.
     * applySettings runs inside the chain too, so server reconciliation sees
     * every intermediate state in order.
     */
    updateSettings(updater: (draft: Draft<PluginSettings>) => void): Promise<void> {
        return this.commitSettings((current) => produce(current, updater))
    }

    /**
     * {@link updateSettings} for a whole-settings transition (used by the pure
     * secret helpers). `compute` runs inside the write chain, on the latest
     * committed settings.
     */
    private commitSettings(compute: (current: PluginSettings) => PluginSettings): Promise<void> {
        const run = async (): Promise<void> => {
            const previous = this.settings
            const next = compute(this.settings)
            await this.saveData(next)
            this.settings = next
            await this.coordinator.applySettings(previous, this.settings)
            if (projectMcpConfigAffected(previous, this.settings)) {
                await this.syncProjectMcpConfig()
            }
        }
        const p = this.settingsWriteChain.then(run, run)
        this.settingsWriteChain = p.catch(() => {})
        return p
    }

    /**
     * Write this server's entry into the vault's `.mcp.json` when the opt-in
     * sync is on. Never throws: a failed write must not break load or a
     * settings change.
     */
    async syncProjectMcpConfig(): Promise<void> {
        const settings = this.settings
        if (!settings.syncProjectMcpConfig) {
            return
        }
        try {
            const outcome = await this.projectMcpSync.sync({
                port: this.registry.port ?? settings.server.port,
                bearerToken: this.bearerToken(),
                serverName: settings.projectMcpServerName
            })
            log(`Project .mcp.json sync: ${outcome}`, outcome === 'invalid' ? 'warn' : 'debug')
        } catch (error) {
            log('Failed to update the project .mcp.json', 'error', error)
        }
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
    private async recordScanStats(
        result: ScanResult,
        agents: AgentScanResult | null
    ): Promise<void> {
        this.settings = produce(this.settings, (draft) => {
            draft.lastScanStats = {
                skillCount: result.skillCount,
                agentCount: agents?.agentCount ?? 0,
                errorCount: result.errorCount + (agents?.errorCount ?? 0),
                lastScanAt: new Date().toISOString()
            }
        })
        await this.saveSettings()
        // Refresh the settings tab so its scan stats update even when the
        // rescan was triggered in the background (watcher), not by the button.
        this.settingTab?.update()
    }

    /**
     * Resolve configured folders to absolute filesystem paths. Absolute paths
     * are used as-is; vault-relative paths (e.g. from the folder picker) are
     * resolved against the vault base path. Blank entries are dropped.
     */
    private resolveFolders(folders: string[]): string[] {
        const base = this.vaultBasePath()
        return folders
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
