import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import type ArdServerPlugin from '../../main'
import {
    MANUAL_RESOURCE_TYPES,
    SEARCH_BACKEND_KINDS,
    type ManualResource,
    type SearchBackendConfig
} from '../types/plugin-settings.intf'
import { BUY_ME_A_COFFEE_BADGE_DATA_URL } from '../assets/buy-me-a-coffee'
import { generateBearerToken } from '../utils/token'

/** Human-readable labels for the search backend kinds. */
const BACKEND_LABELS: Record<SearchBackendConfig['kind'], string> = {
    'lexical': 'BM25 lexical (built-in, no download)',
    'local-model': 'Local embedding model (downloads ~23 MB)',
    'qmd-sidecar': 'qmd sidecar (requires qmd installed)',
    'hosted-api': 'Hosted embedding API (bring your own key)'
}

/** Human-readable labels for the manual resource media types. */
const RESOURCE_TYPE_LABELS: Record<(typeof MANUAL_RESOURCE_TYPES)[number], string> = {
    'application/mcp-server-card+json': 'MCP server',
    'application/a2a-agent-card+json': 'A2A agent',
    'application/ai-catalog+json': 'Nested catalog',
    'application/ai-registry+json': 'Registry'
}

export class ArdServerSettingTab extends PluginSettingTab {
    plugin: ArdServerPlugin

    constructor(app: App, plugin: ArdServerPlugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    override display(): void {
        const { containerEl } = this
        containerEl.empty()

        this.renderServerSection(containerEl)
        this.renderSkillFoldersSection(containerEl)
        this.renderResourcesSection(containerEl)
        this.renderSearchBackendSection(containerEl)
        this.renderSupportSection(containerEl)
    }

    // ----- Section 1: Server -----

    private renderServerSection(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Server').setHeading()

        new Setting(containerEl)
            .setName('Port')
            .setDesc('The registry listens on 127.0.0.1 at this port (loopback only).')
            .addText((text) =>
                text
                    .setPlaceholder('27182')
                    .setValue(String(this.plugin.settings.server.port))
                    .onChange(async (value) => {
                        const port = Number.parseInt(value, 10)
                        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
                            return
                        }
                        await this.plugin.updateSettings((draft) => {
                            draft.server.port = port
                        })
                    })
            )

        new Setting(containerEl)
            .setName('Bearer token')
            .setDesc('Required on every request except the public catalog. Keep it secret.')
            .addText((text) => {
                text.setValue(this.plugin.settings.server.bearerToken)
                text.setDisabled(true)
                text.inputEl.addClass('ard-token-field')
            })
            .addExtraButton((button) =>
                button
                    .setIcon('copy')
                    .setTooltip('Copy token')
                    .onClick(() => {
                        void navigator.clipboard
                            .writeText(this.plugin.settings.server.bearerToken)
                            .then(() => new Notice('Bearer token copied'))
                    })
            )
            .addExtraButton((button) =>
                button
                    .setIcon('refresh-cw')
                    .setTooltip('Regenerate token (invalidates the old one)')
                    .onClick(async () => {
                        await this.plugin.updateSettings((draft) => {
                            draft.server.bearerToken = generateBearerToken()
                        })
                        this.display()
                    })
            )

        new Setting(containerEl)
            .setName('Publisher')
            .setDesc('URN publisher segment (urn:air:<publisher>:…). Use a real domain to publish.')
            .addText((text) =>
                text
                    .setPlaceholder('obsidian')
                    .setValue(this.plugin.settings.publisher)
                    .onChange(async (value) => {
                        await this.plugin.updateSettings((draft) => {
                            draft.publisher = value.trim() || 'obsidian'
                        })
                    })
            )

        new Setting(containerEl).setName('Catalog name').addText((text) =>
            text.setValue(this.plugin.settings.catalogDisplayName).onChange(async (value) => {
                await this.plugin.updateSettings((draft) => {
                    draft.catalogDisplayName = value
                })
            })
        )
    }

    // ----- Section 2: Skill folders -----

    private renderSkillFoldersSection(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Skill folders').setHeading()

        const stats = this.plugin.settings.lastScanStats
        const lastScan = stats.lastScanAt
            ? `Last scan: ${stats.skillCount} skills, ${stats.errorCount} errors (${stats.lastScanAt}).`
            : 'Not scanned yet.'
        new Setting(containerEl).setDesc(
            `Folders scanned for SKILL.md files at startup (may live outside the vault). ${lastScan}`
        )

        this.plugin.settings.skillFolders.forEach((folder, index) => {
            new Setting(containerEl)
                .addText((text) =>
                    text
                        .setPlaceholder('/path/to/skills')
                        .setValue(folder)
                        .onChange(async (value) => {
                            await this.plugin.updateSettings((draft) => {
                                draft.skillFolders[index] = value
                            })
                        })
                )
                .addExtraButton((button) =>
                    button
                        .setIcon('trash')
                        .setTooltip('Remove folder')
                        .onClick(async () => {
                            await this.plugin.updateSettings((draft) => {
                                draft.skillFolders.splice(index, 1)
                            })
                            this.display()
                        })
                )
        })

        new Setting(containerEl)
            .addButton((button) =>
                button
                    .setButtonText('Add folder')
                    .setCta()
                    .onClick(async () => {
                        await this.plugin.updateSettings((draft) => {
                            draft.skillFolders.push('')
                        })
                        this.display()
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText('Rescan skills now')
                    .setTooltip('Re-scan the configured folders and rebuild the catalog')
                    .onClick(async () => {
                        button.setButtonText('Scanning…').setDisabled(true)
                        await this.plugin.rescanSkills()
                        new Notice(
                            `Scanned ${this.plugin.settings.lastScanStats.skillCount} skills`
                        )
                        this.display()
                    })
            )
    }

    // ----- Section 3: Additional resources -----

    private renderResourcesSection(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Additional resources').setHeading()
        new Setting(containerEl).setDesc(
            'MCP servers, A2A agents, nested catalogs, and registries to include in the catalog.'
        )

        this.plugin.settings.resources.forEach((resource, index) => {
            this.renderResourceRow(containerEl, resource, index)
        })

        new Setting(containerEl).addButton((button) =>
            button.setButtonText('Add resource').onClick(async () => {
                await this.plugin.updateSettings((draft) => {
                    draft.resources.push({
                        id: crypto.randomUUID(),
                        enabled: true,
                        type: 'application/mcp-server-card+json',
                        slug: '',
                        displayName: '',
                        capabilities: [],
                        tags: [],
                        representativeQueries: []
                    })
                })
                this.display()
            })
        )
    }

    private renderResourceRow(
        containerEl: HTMLElement,
        resource: ManualResource,
        index: number
    ): void {
        new Setting(containerEl)
            .setName(resource.displayName || '(unnamed resource)')
            .addDropdown((dropdown) => {
                for (const type of MANUAL_RESOURCE_TYPES) {
                    dropdown.addOption(type, RESOURCE_TYPE_LABELS[type])
                }
                dropdown.setValue(resource.type).onChange(async (value) => {
                    await this.plugin.updateSettings((draft) => {
                        draft.resources[index]!.type = value as ManualResource['type']
                    })
                })
            })
            .addExtraButton((button) =>
                button
                    .setIcon('trash')
                    .setTooltip('Remove resource')
                    .onClick(async () => {
                        await this.plugin.updateSettings((draft) => {
                            draft.resources.splice(index, 1)
                        })
                        this.display()
                    })
            )

        new Setting(containerEl).setName('Display name').addText((text) =>
            text.setValue(resource.displayName).onChange(async (value) => {
                await this.plugin.updateSettings((draft) => {
                    draft.resources[index]!.displayName = value
                })
            })
        )

        new Setting(containerEl)
            .setName('Slug')
            .setDesc('URN terminal segment.')
            .addText((text) =>
                text.setValue(resource.slug).onChange(async (value) => {
                    await this.plugin.updateSettings((draft) => {
                        draft.resources[index]!.slug = value
                    })
                })
            )

        new Setting(containerEl).setName('URL').addText((text) =>
            text.setValue(resource.url ?? '').onChange(async (value) => {
                await this.plugin.updateSettings((draft) => {
                    draft.resources[index]!.url = value || undefined
                })
            })
        )
    }

    // ----- Section 4: Search backend -----

    private renderSearchBackendSection(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Search backend').setHeading()

        new Setting(containerEl)
            .setName('Backend')
            .setDesc('Powers POST /search ranking. The built-in lexical backend needs no download.')
            .addDropdown((dropdown) => {
                for (const kind of SEARCH_BACKEND_KINDS) {
                    dropdown.addOption(kind, BACKEND_LABELS[kind])
                }
                dropdown
                    .setValue(this.plugin.settings.searchBackend.kind)
                    .onChange(async (value) => {
                        await this.plugin.updateSettings((draft) => {
                            draft.searchBackend.kind = value as SearchBackendConfig['kind']
                        })
                        this.display()
                    })
            })

        const kind = this.plugin.settings.searchBackend.kind
        if (kind !== 'lexical') {
            new Setting(containerEl).setDesc(
                `The "${BACKEND_LABELS[kind]}" backend is configured but not yet implemented (planned for a later milestone). Searches fall back to the built-in lexical backend.`
            )
        }
    }

    // ----- Section 5: Support -----

    private renderSupportSection(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Support').setHeading()

        const supportDesc = new DocumentFragment()
        supportDesc.createDiv({
            text: 'Buy me a coffee to support the development of this plugin ❤️'
        })
        new Setting(containerEl).setDesc(supportDesc)

        const linkEl = containerEl.createEl('a', {
            href: 'https://www.buymeacoffee.com/dsebastien'
        })
        const imgEl = linkEl.createEl('img')
        imgEl.src = BUY_ME_A_COFFEE_BADGE_DATA_URL
        imgEl.alt = 'Buy me a coffee'
        imgEl.width = 175
    }
}
