import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import type ArdServerPlugin from '../../main'
import {
    HOSTED_EMBEDDING_PROVIDERS,
    MANUAL_RESOURCE_TYPES,
    SEARCH_BACKEND_KINDS,
    type ManualResource,
    type SearchBackendConfig
} from '../types/plugin-settings.intf'
import { BUY_ME_A_COFFEE_BADGE_DATA_URL } from '../assets/buy-me-a-coffee'
import { FolderSuggest } from './components/folder-suggest'
import { generateBearerToken } from '../utils/token'

/** Human-readable labels for the search backend kinds. */
const BACKEND_LABELS: Record<SearchBackendConfig['kind'], string> = {
    'lexical': 'BM25 lexical (built-in, no download)',
    'local-model': 'Local embedding server (Ollama, LM Studio, …)',
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
                        const valid = Number.isInteger(port) && port >= 1024 && port <= 65535
                        // Flag out-of-range input instead of silently ignoring it.
                        text.inputEl.toggleClass('ard-invalid', !valid && value.trim() !== '')
                        if (!valid) {
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
                text.inputEl.type = 'password'
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

        new Setting(containerEl)
            .setName('Catalog name')
            .setDesc('Human-readable name for this catalog, shown in the served ai-catalog.json.')
            .addText((text) =>
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
                .addText((text) => {
                    text.setPlaceholder('Pick a vault folder or type an absolute path')
                        .setValue(folder)
                        .onChange(async (value) => {
                            await this.plugin.updateSettings((draft) => {
                                draft.skillFolders[index] = value
                            })
                        })
                    // Reuse the shared folder autocomplete (vault folders).
                    new FolderSuggest(text.inputEl, this.app)
                })
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
            .setName('Watch folders for changes')
            .setDesc(
                'Automatically rescan when a SKILL.md changes. Off by default; best-effort — may ' +
                    'not fire on network/cloud-synced (e.g. Google Drive) folders. Use Rescan if unsure.'
            )
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.watchSkillFolders).onChange(async (value) => {
                    await this.plugin.updateSettings((draft) => {
                        draft.watchSkillFolders = value
                    })
                })
            )

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
                        // rescanSkills() refreshes this tab itself; just notify.
                        new Notice(
                            `Scanned ${this.plugin.settings.lastScanStats.skillCount} skills`
                        )
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
        if (kind === 'local-model') {
            new Setting(containerEl).setDesc(
                'Hybrid search: lexical BM25 fused with dense embeddings from a local OpenAI-compatible embedding server you already run (Ollama, LM Studio, llama.cpp, …). Nothing is downloaded by the plugin. If the server is unreachable, searches fall back to the built-in lexical backend automatically. Changing these restarts the registry.'
            )
            new Setting(containerEl)
                .setName('Embedding server URL')
                .setDesc('OpenAI-compatible base or /embeddings URL.')
                .addText((text) =>
                    text
                        .setPlaceholder('http://localhost:11434/v1')
                        .setValue(this.plugin.settings.searchBackend.embeddingServerUrl)
                        .onChange(async (value) => {
                            await this.plugin.updateSettings((draft) => {
                                draft.searchBackend.embeddingServerUrl =
                                    value.trim() || 'http://localhost:11434/v1'
                            })
                        })
                )
            new Setting(containerEl)
                .setName('Embedding model')
                .setDesc('Model name the server should use.')
                .addText((text) =>
                    text
                        .setPlaceholder('nomic-embed-text')
                        .setValue(this.plugin.settings.searchBackend.embeddingModel)
                        .onChange(async (value) => {
                            await this.plugin.updateSettings((draft) => {
                                draft.searchBackend.embeddingModel = value.trim() || 'nomic-embed-text'
                            })
                        })
                )
        } else if (kind === 'hosted-api') {
            this.renderHostedApiOptions(containerEl)
        }

        new Setting(containerEl)
            .setName('Reindex')
            .setDesc('Rebuild the search index over the current catalog without rescanning folders.')
            .addButton((button) =>
                button
                    .setButtonText('Reindex')
                    .setTooltip('Re-run the search backend over the current catalog')
                    .onClick(async () => {
                        button.setButtonText('Reindexing…').setDisabled(true)
                        await this.plugin.reindex()
                        button.setButtonText('Reindex').setDisabled(false)
                        new Notice('Search index rebuilt')
                    })
            )
    }

    /** Provider / base URL / model / key inputs for the hosted-api backend. */
    private renderHostedApiOptions(containerEl: HTMLElement): void {
        new Setting(containerEl).setDesc(
            'Hybrid search using a remote OpenAI-compatible embedding API (bring your own key). The query and your skill metadata (names, descriptions, tags) are sent to the provider to embed. Unreachable or unauthorized requests fall back to lexical automatically. Changing these restarts the registry.'
        )

        const backend = this.plugin.settings.searchBackend
        new Setting(containerEl)
            .setName('Provider')
            .setDesc('OpenAI-compatible embedding provider, or Custom for any other gateway.')
            .addDropdown((dropdown) => {
                for (const provider of HOSTED_EMBEDDING_PROVIDERS) {
                    dropdown.addOption(provider, provider)
                }
                dropdown.setValue(backend.apiProvider).onChange(async (value) => {
                    await this.plugin.updateSettings((draft) => {
                        draft.searchBackend.apiProvider =
                            value as SearchBackendConfig['apiProvider']
                    })
                    this.display()
                })
            })

        if (backend.apiProvider === 'custom') {
            new Setting(containerEl)
                .setName('API base URL')
                .setDesc('OpenAI-compatible base or /embeddings URL.')
                .addText((text) =>
                    text
                        .setPlaceholder('https://api.example.com/v1')
                        .setValue(backend.apiBaseUrl ?? '')
                        .onChange(async (value) => {
                            await this.plugin.updateSettings((draft) => {
                                draft.searchBackend.apiBaseUrl = value.trim() || undefined
                            })
                            this.display()
                        })
                )
            if (!backend.apiBaseUrl?.trim()) {
                containerEl
                    .createEl('p', {
                        cls: 'ard-setting-warning',
                        text: 'A base URL is required for the custom provider — search stays lexical until it is set.'
                    })
                    .setAttr('role', 'alert')
            }
        }

        new Setting(containerEl)
            .setName('Model')
            .setDesc('Embedding model name (leave blank to use the provider default).')
            .addText((text) =>
                text
                    .setPlaceholder('text-embedding-3-small')
                    .setValue(backend.apiModel ?? '')
                    .onChange(async (value) => {
                        await this.plugin.updateSettings((draft) => {
                            draft.searchBackend.apiModel = value.trim() || undefined
                        })
                    })
            )

        new Setting(containerEl)
            .setName('API key')
            .setDesc('Sent as a Bearer token. Stored in plugin data — treat it as a secret.')
            .addText((text) => {
                text.inputEl.type = 'password'
                text.setPlaceholder('sk-…')
                    .setValue(backend.apiKey ?? '')
                    .onChange(async (value) => {
                        await this.plugin.updateSettings((draft) => {
                            draft.searchBackend.apiKey = value.trim() || undefined
                        })
                    })
            })
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
