import { Plugin } from 'obsidian'
import { produce } from 'immer'
import type { Draft } from 'immer'
import { DEFAULT_SETTINGS, parsePluginSettings } from './types/plugin-settings.intf'
import type { PluginSettings } from './types/plugin-settings.intf'
import { ArdServerSettingTab } from './settings/settings-tab'
import { generateBearerToken, isBlankToken } from './utils/token'
import { log } from '../utils/log'

/**
 * Agentic Resource Discovery Server plugin.
 *
 * Turns the vault into a local-first ARD publisher + Agent Registry. This is the
 * top-level orchestrator; subsystems (skill scanner, catalog, search backend,
 * HTTP server, MCP endpoint) are wired in from later milestones. For now it owns
 * settings lifecycle and the settings UI.
 *
 * See documentation/plans/implementation-plan.md.
 */
export class ArdServerPlugin extends Plugin {
    /** Settings are kept immutable; mutate only via {@link updateSettings}. */
    override settings: PluginSettings = produce(DEFAULT_SETTINGS, () => DEFAULT_SETTINGS)

    override async onload(): Promise<void> {
        log('Initializing', 'debug')
        await this.loadSettings()
        await this.ensureBearerToken()

        this.addSettingTab(new ArdServerSettingTab(this.app, this))

        // Milestones M1+: start the localhost HTTP server, scan skill folders on
        // workspace.onLayoutReady (non-blocking), build the catalog, index it,
        // and mount the REST + MCP endpoints.
    }

    override onunload(): void {
        // Milestones M1+: stop the HTTP server, kill any sidecar, close watchers.
    }

    /** Load + validate persisted settings, always yielding a complete object. */
    async loadSettings(): Promise<void> {
        log('Loading settings', 'debug')
        this.settings = parsePluginSettings(await this.loadData())
        log('Settings loaded', 'debug', this.settings)
    }

    /** Generate and persist a bearer token on first run (when none exists yet). */
    async ensureBearerToken(): Promise<void> {
        if (!isBlankToken(this.settings.server.bearerToken)) {
            return
        }
        log('Generating bearer token (first run)', 'debug')
        await this.updateSettings((draft) => {
            draft.server.bearerToken = generateBearerToken()
        })
    }

    /** Apply an immutable update to the settings and persist them. */
    async updateSettings(updater: (draft: Draft<PluginSettings>) => void): Promise<void> {
        this.settings = produce(this.settings, updater)
        await this.saveSettings()
    }

    async saveSettings(): Promise<void> {
        log('Saving settings', 'debug')
        await this.saveData(this.settings)
    }
}
