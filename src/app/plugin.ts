import { Notice, Plugin } from 'obsidian'
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
 * server). Skill scanning and the MCP endpoint arrive in later milestones.
 *
 * See documentation/plans/implementation-plan.md.
 */
export class ArdServerPlugin extends Plugin {
    /** Settings are kept immutable; mutate only via {@link updateSettings}. */
    override settings: PluginSettings = produce(DEFAULT_SETTINGS, () => DEFAULT_SETTINGS)

    private readonly registry = new RegistryController()

    private readonly watcher = new SkillWatcher(nodeFsWatchFn, {
        set: (callback, ms) => window.setTimeout(callback, ms),
        clear: (handle) => window.clearTimeout(handle as number)
    })

    override async onload(): Promise<void> {
        log('Initializing', 'debug')
        await this.loadSettings()
        await this.ensureBearerToken()

        this.addSettingTab(new ArdServerSettingTab(this.app, this))

        if (this.settings.enabled) {
            await this.startRegistry()
            // Scan skills after the workspace settles so we don't block load or
            // drown in vault events. The scan itself yields between chunks.
            this.app.workspace.onLayoutReady(() => {
                void this.rescanSkills()
                this.reconcileWatcher()
            })
        }
    }

    override onunload(): void {
        this.watcher.stop()
        void this.registry.stop()
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
        await this.syncRegistry(previous, this.settings)
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings)
    }

    /**
     * Scan the configured skill folders and feed the results into the catalog.
     * Non-blocking: yields to the UI between chunks via window.setTimeout.
     */
    async rescanSkills(): Promise<void> {
        if (!this.settings.enabled || this.settings.skillFolders.length === 0) {
            return
        }
        const port = this.registry.port ?? this.settings.server.port
        try {
            const result = await scanSkillFolders(
                this.settings.skillFolders,
                { publisher: this.settings.publisher, baseUrl: `http://127.0.0.1:${port}` },
                { scheduler: () => new Promise((resolve) => window.setTimeout(resolve, 0)) }
            )
            await this.registry.setSkillEntries(this.settings, result.entries, result.folders)
            this.settings = produce(this.settings, (draft) => {
                draft.lastScanStats = {
                    skillCount: result.skillCount,
                    errorCount: result.errorCount,
                    lastScanAt: new Date().toISOString()
                }
            })
            await this.saveSettings()
            log(`Scanned ${result.skillCount} skills (${result.errorCount} errors)`, 'debug')
        } catch (error) {
            log('Skill scan failed', 'error', error)
        }
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
            if (!next.enabled) {
                await this.registry.stop()
                return
            }
            const serverChanged =
                previous.server.port !== next.server.port ||
                previous.server.bindAddress !== next.server.bindAddress ||
                previous.searchBackend.kind !== next.searchBackend.kind
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
        const shouldWatch =
            this.settings.enabled &&
            this.settings.watchSkillFolders &&
            this.settings.skillFolders.length > 0
        if (shouldWatch) {
            this.watcher.start(this.settings.skillFolders, () => void this.rescanSkills())
        } else {
            this.watcher.stop()
        }
    }
}
