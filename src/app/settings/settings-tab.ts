import { Notice, PluginSettingTab } from 'obsidian'
import type { App, Setting, SettingDefinitionItem, SettingGroupItem } from 'obsidian'
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
import { MCP_TOOL_NAMES } from '../mcp/mcp-server'
import {
    buildMcpClientConfig,
    buildSearchCurlExample,
    mcpEndpointUrl,
    registryBaseUrl
} from './mcp-client-config'
import type { EmbeddingState } from '../search/semantic-search-backend'
import {
    BUY_ME_A_COFFEE_URL,
    renderSupportSection as renderSharedSupportSection
} from '../ui/support-links'

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

/** Plain-language labels for the dense-vector index lifecycle. */
const EMBEDDING_STATE_LABELS: Record<EmbeddingState, string> = {
    idle: 'Idle (nothing to embed yet)',
    building: 'Building… (search stays lexical meanwhile)',
    ready: 'Ready (hybrid search active)',
    failed: 'Failed — falling back to lexical; retrying periodically'
}

const EMBEDDING_STATE_STYLES: Record<EmbeddingState, 'normal' | 'ok' | 'error' | 'muted'> = {
    idle: 'muted',
    building: 'normal',
    ready: 'ok',
    failed: 'error'
}

/**
 * Settings tab, declared rather than rendered (Obsidian 1.13+).
 *
 * `getSettingDefinitions()` REPLACES `display()` — Obsidian owns navigation,
 * focus and ARIA, and every declared `name`/`desc` is indexed by the settings
 * search. Scalars are `control` definitions addressed by a key resolved in
 * `getControlValue`/`setControlValue`; every write still goes through
 * `plugin.updateSettings`, the single persistence path.
 *
 * Manual resources are keyed by their stable `id` (`resource.<id>.<field>`),
 * never by index: the framework re-indexes list rows on drag immediately,
 * while our settings refresh waits on persistence, so index-based value keys
 * would write to the wrong resource. `onDelete(index)` deliberately uses the
 * LIVE index, per the framework contract.
 *
 * See AGENTS.md "Declarative settings" for the full trap list;
 * `settings-guard.spec.ts` enforces the statically-catchable rules.
 */
export class ArdServerSettingTab extends PluginSettingTab {
    plugin: ArdServerPlugin

    constructor(app: App, plugin: ArdServerPlugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    override getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            this.statusGroup(),
            this.serverGroup(),
            this.skillFoldersIntroGroup(),
            this.skillFoldersList(),
            this.skillFoldersOptionsGroup(),
            this.resourcesIntroGroup(),
            this.resourcesList(),
            this.searchBackendGroup(),
            this.supportGroup()
        ]
    }

    // ----- Control value plumbing -----

    /** Text controls hand us `unknown`; anything that isn't a string is refused. */
    private static asString(value: unknown): string {
        if (typeof value !== 'string') {
            throw new Error('Expected a text value.')
        }
        return value
    }

    override getControlValue(key: string): unknown {
        const s = this.plugin.settings
        switch (key) {
            case 'server.port':
                return s.server.port
            case 'publisher':
                return s.publisher
            case 'catalogDisplayName':
                return s.catalogDisplayName
            case 'watchSkillFolders':
                return s.watchSkillFolders
            case 'searchBackend.kind':
                return s.searchBackend.kind
            case 'searchBackend.embeddingServerUrl':
                return s.searchBackend.embeddingServerUrl
            case 'searchBackend.embeddingModel':
                return s.searchBackend.embeddingModel
            case 'searchBackend.apiProvider':
                return s.searchBackend.apiProvider
            case 'searchBackend.apiBaseUrl':
                return s.searchBackend.apiBaseUrl ?? ''
            case 'searchBackend.apiModel':
                return s.searchBackend.apiModel ?? ''
        }
        const resource = this.parseResourceKey(key)
        if (resource) {
            const found = s.resources.find((r) => r.id === resource.id)
            if (!found) {
                return undefined
            }
            switch (resource.field) {
                case 'type':
                    return found.type
                case 'displayName':
                    return found.displayName
                case 'slug':
                    return found.slug
                case 'url':
                    return found.url ?? ''
            }
        }
        return undefined
    }

    /**
     * Rejecting (not resolving) on failure is load-bearing: a fulfilled
     * promise tells the framework the write landed, and the pane would keep
     * showing a value that was never stored.
     */
    override async setControlValue(key: string, value: unknown): Promise<void> {
        const write = async (mutator: Parameters<ArdServerPlugin['updateSettings']>[0]) => {
            await this.plugin.updateSettings(mutator)
        }
        switch (key) {
            case 'server.port': {
                const port = typeof value === 'number' ? value : Number.NaN
                if (!Number.isInteger(port) || port < 1024 || port > 65535) {
                    throw new Error('Port must be an integer between 1024 and 65535.')
                }
                await write((draft) => {
                    draft.server.port = port
                })
                return
            }
            case 'publisher':
                // Empty collapses to the historical default rather than an
                // empty URN segment — same behavior as the imperative tab.
                await write((draft) => {
                    draft.publisher = ArdServerSettingTab.asString(value).trim() || 'obsidian'
                })
                return
            case 'catalogDisplayName':
                await write((draft) => {
                    draft.catalogDisplayName = ArdServerSettingTab.asString(value)
                })
                return
            case 'watchSkillFolders':
                await write((draft) => {
                    draft.watchSkillFolders = value === true
                })
                return
            case 'searchBackend.kind': {
                const kind = SEARCH_BACKEND_KINDS.find((k) => k === value)
                if (!kind) {
                    throw new Error(`Unknown search backend "${String(value)}".`)
                }
                await write((draft) => {
                    draft.searchBackend.kind = kind
                })
                // Backend choice changes which rows are visible.
                this.update()
                return
            }
            case 'searchBackend.embeddingServerUrl':
                await write((draft) => {
                    draft.searchBackend.embeddingServerUrl =
                        ArdServerSettingTab.asString(value).trim() || 'http://localhost:11434/v1'
                })
                return
            case 'searchBackend.embeddingModel':
                await write((draft) => {
                    draft.searchBackend.embeddingModel =
                        ArdServerSettingTab.asString(value).trim() || 'nomic-embed-text'
                })
                return
            case 'searchBackend.apiProvider': {
                const provider = HOSTED_EMBEDDING_PROVIDERS.find((p) => p === value)
                if (!provider) {
                    throw new Error(`Unknown embedding provider "${String(value)}".`)
                }
                await write((draft) => {
                    draft.searchBackend.apiProvider = provider
                })
                // Provider choice toggles the custom base-URL row + warning.
                this.update()
                return
            }
            case 'searchBackend.apiBaseUrl':
                await write((draft) => {
                    draft.searchBackend.apiBaseUrl =
                        ArdServerSettingTab.asString(value).trim() || undefined
                })
                this.update() // the missing-URL warning depends on this value
                return
            case 'searchBackend.apiModel':
                await write((draft) => {
                    draft.searchBackend.apiModel =
                        ArdServerSettingTab.asString(value).trim() || undefined
                })
                return
        }
        const resource = this.parseResourceKey(key)
        if (resource) {
            await this.setResourceValue(resource.id, resource.field, value)
            return
        }
        new Notice('Agentic resource discovery: failed to save settings.')
        throw new Error(`Setting "${key}" does not address a known field.`)
    }

    private parseResourceKey(key: string): { id: string; field: string } | null {
        const match = /^resource\.([^.]+)\.(type|displayName|slug|url)$/.exec(key)
        return match ? { id: match[1]!, field: match[2]! } : null
    }

    private async setResourceValue(id: string, field: string, value: unknown): Promise<void> {
        let found = false
        await this.plugin.updateSettings((draft) => {
            const target = draft.resources.find((r) => r.id === id)
            if (!target) {
                return
            }
            found = true
            switch (field) {
                case 'type': {
                    const type = MANUAL_RESOURCE_TYPES.find((t) => t === value)
                    if (type) {
                        target.type = type
                    }
                    break
                }
                case 'displayName':
                    target.displayName = ArdServerSettingTab.asString(value)
                    break
                case 'slug':
                    target.slug = ArdServerSettingTab.asString(value)
                    break
                case 'url':
                    target.url = ArdServerSettingTab.asString(value).trim() || undefined
                    break
            }
        })
        if (!found) {
            throw new Error(`Resource "${id}" no longer exists.`)
        }
        if (field === 'displayName') {
            this.update() // the list entry title mirrors the display name
        }
    }

    // ----- Section 0: Status -----

    private statusGroup(): SettingDefinitionItem {
        return {
            type: 'group',
            heading: 'Status',
            items: [
                {
                    name: 'Status',
                    // Live registry state, not a setting — keep it out of search.
                    searchable: false,
                    render: (setting): void => {
                        setting.settingEl.addClass('ard-settings-embed')
                        setting.infoEl.remove()
                        this.renderStatusGrid(setting.settingEl)
                    }
                },
                {
                    name: 'Client setup',
                    desc: 'Copy a ready-to-paste MCP server config, or a curl call to try the API.',
                    render: (setting): void => {
                        this.addClientSetupButtons(setting)
                    }
                }
            ]
        }
    }

    private renderStatusGrid(containerEl: HTMLElement): void {
        const registry = this.plugin.registry
        const port = registry.port ?? this.plugin.settings.server.port
        const grid = containerEl.createDiv({ cls: 'ard-status' })

        if (registry.isRunning) {
            this.addStatusRow(grid, 'Server', `Running — ${registryBaseUrl(port)}`, {
                state: 'ok',
                mono: true
            })
        } else {
            this.addStatusRow(grid, 'Server', 'Stopped', { state: 'error' })
        }

        this.addStatusRow(grid, 'Catalog', `${registry.catalogSize} entries`)

        const stats = this.plugin.settings.lastScanStats
        this.addStatusRow(
            grid,
            'Last scan',
            stats.lastScanAt
                ? `${stats.skillCount} skills, ${stats.errorCount} errors (${stats.lastScanAt})`
                : 'Not scanned yet',
            { state: stats.lastScanAt ? 'normal' : 'muted' }
        )

        this.addStatusRow(grid, 'Search backend', registry.searchBackendName)

        const embeddingState = registry.embeddingState
        if (embeddingState) {
            this.addStatusRow(grid, 'Embeddings', EMBEDDING_STATE_LABELS[embeddingState], {
                state: EMBEDDING_STATE_STYLES[embeddingState]
            })
        }

        this.addStatusRow(grid, 'MCP endpoint', mcpEndpointUrl(port), { mono: true })
        this.addStatusRow(grid, 'MCP tools', MCP_TOOL_NAMES.join(', '))
    }

    private addClientSetupButtons(setting: Setting): void {
        const port = this.plugin.registry.port ?? this.plugin.settings.server.port
        setting
            .addButton((button) =>
                button
                    .setButtonText('Copy MCP config')
                    .setCta()
                    .onClick(() => {
                        void this.copyToClipboard(
                            buildMcpClientConfig({
                                port,
                                bearerToken: this.plugin.settings.server.bearerToken
                            }),
                            'MCP client config copied'
                        )
                    })
            )
            .addButton((button) =>
                button.setButtonText('Copy curl example').onClick(() => {
                    void this.copyToClipboard(
                        buildSearchCurlExample({
                            port,
                            bearerToken: this.plugin.settings.server.bearerToken
                        }),
                        'curl example copied'
                    )
                })
            )
    }

    private addStatusRow(
        grid: HTMLElement,
        label: string,
        value: string,
        options: { state?: 'normal' | 'ok' | 'error' | 'muted'; mono?: boolean } = {}
    ): void {
        grid.createDiv({ cls: 'ard-status-label', text: label })
        const classes = ['ard-status-value']
        if (options.mono) {
            classes.push('ard-status-value-mono')
        }
        if (options.state === 'ok') classes.push('ard-status-ok')
        if (options.state === 'error') classes.push('ard-status-error')
        if (options.state === 'muted') classes.push('ard-status-muted')
        grid.createDiv({ cls: classes.join(' '), text: value })
    }

    /** Copy text, confirming with a Notice (both success and failure are silent otherwise). */
    private async copyToClipboard(text: string, confirmation: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(text)
            new Notice(confirmation)
        } catch {
            new Notice('Could not access the clipboard')
        }
    }

    // ----- Section 1: Server -----

    private serverGroup(): SettingDefinitionItem {
        return {
            type: 'group',
            heading: 'Server',
            items: [
                {
                    name: 'Port',
                    desc: 'The registry listens on 127.0.0.1 at this port (loopback only).',
                    control: {
                        type: 'number',
                        key: 'server.port',
                        placeholder: '27182',
                        min: 1024,
                        max: 65535,
                        step: 1,
                        // No defaultValue on purpose: a cleared field must be
                        // refused here, not silently reset by the framework.
                        validate: (value): string | void => {
                            if (!Number.isInteger(value) || value < 1024 || value > 65535) {
                                return 'Enter a port between 1024 and 65535.'
                            }
                        }
                    }
                },
                {
                    name: 'Bearer token',
                    desc: 'Required on every request except the public catalog. Keep it secret.',
                    searchable: true,
                    render: (setting): void => {
                        this.renderBearerTokenControls(setting)
                    }
                },
                {
                    name: 'Publisher',
                    desc: 'URN publisher segment (urn:air:<publisher>:…). Use a real domain to publish.',
                    control: { type: 'text', key: 'publisher', placeholder: 'obsidian' }
                },
                {
                    name: 'Catalog name',
                    desc: 'Human-readable name for this catalog, shown in the served ai-catalog.json.',
                    control: { type: 'text', key: 'catalogDisplayName' }
                }
            ]
        }
    }

    private renderBearerTokenControls(setting: Setting): void {
        setting
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
                        this.update()
                    })
            )
    }

    // ----- Section 2: Skill folders -----

    private skillFoldersIntroGroup(): SettingDefinitionItem {
        const stats = this.plugin.settings.lastScanStats
        const lastScan = stats.lastScanAt
            ? `Last scan: ${stats.skillCount} skills, ${stats.errorCount} errors (${stats.lastScanAt}).`
            : 'Not scanned yet.'
        return {
            type: 'group',
            heading: 'Skill folders',
            items: [
                {
                    name: 'About skill folders',
                    desc: `Folders scanned for SKILL.md files at startup (may live outside the vault). ${lastScan}`,
                    // Explanatory copy, not a setting — keep it out of search.
                    searchable: false
                }
            ]
        }
    }

    private skillFoldersList(): SettingDefinitionItem {
        const folderItems: SettingGroupItem[] = this.plugin.settings.skillFolders.map(
            (folder, index): SettingGroupItem => ({
                name: folder || `Folder ${index + 1}`,
                searchable: false,
                render: (setting): void => {
                    setting.infoEl.remove()
                    setting.addText((text) => {
                        text.setPlaceholder('Pick a vault folder or type an absolute path')
                            .setValue(this.plugin.settings.skillFolders[index] ?? '')
                            .onChange(async (value) => {
                                await this.plugin.updateSettings((draft) => {
                                    draft.skillFolders[index] = value
                                })
                            })
                        // Reuse the shared folder autocomplete (vault folders).
                        new FolderSuggest(text.inputEl, this.app)
                    })
                }
            })
        )
        return {
            type: 'list',
            heading: 'Folders',
            emptyState: 'No folders yet. Add one to start serving skills.',
            items: folderItems,
            // LIVE index by framework contract: rows re-index on delete
            // immediately, so resolving from a render-time snapshot would
            // delete the wrong folder.
            onDelete: (index): void => {
                void this.plugin
                    .updateSettings((draft) => {
                        draft.skillFolders.splice(index, 1)
                    })
                    .then(() => {
                        this.update()
                    })
            },
            addItem: {
                name: 'Add folder',
                action: (): void => {
                    void this.plugin
                        .updateSettings((draft) => {
                            draft.skillFolders.push('')
                        })
                        .then(() => {
                            this.update()
                        })
                }
            }
        }
    }

    private skillFoldersOptionsGroup(): SettingDefinitionItem {
        return {
            type: 'group',
            items: [
                {
                    name: 'Watch folders for changes',
                    desc:
                        'Automatically rescan when a SKILL.md changes. Off by default; best-effort — may ' +
                        'not fire on network/cloud-synced (e.g. Google Drive) folders. Use Rescan if unsure.',
                    control: { type: 'toggle', key: 'watchSkillFolders' }
                },
                {
                    name: 'Rescan skills now',
                    desc: 'Re-scan the configured folders and rebuild the catalog.',
                    render: (setting): void => {
                        setting.addButton((button) =>
                            button.setButtonText('Rescan skills now').onClick(async () => {
                                button.setButtonText('Scanning…').setDisabled(true)
                                await this.plugin.rescanSkills()
                                // rescanSkills() refreshes this tab itself; just notify.
                                new Notice(
                                    `Scanned ${this.plugin.settings.lastScanStats.skillCount} skills`
                                )
                            })
                        )
                    }
                }
            ]
        }
    }

    // ----- Section 3: Additional resources -----

    private resourcesIntroGroup(): SettingDefinitionItem {
        return {
            type: 'group',
            heading: 'Additional resources',
            items: [
                {
                    name: 'About additional resources',
                    desc: 'MCP servers, A2A agents, nested catalogs, and registries to include in the catalog.',
                    searchable: false
                }
            ]
        }
    }

    private resourcesList(): SettingDefinitionItem {
        const resourceItems: SettingGroupItem[] = this.plugin.settings.resources.map((resource) =>
            this.resourcePage(resource)
        )
        return {
            type: 'list',
            heading: 'Resources',
            emptyState: 'No resources yet. Add one to include it in the catalog.',
            items: resourceItems,
            onDelete: (index): void => {
                // LIVE index by framework contract (see skillFoldersGroup).
                void this.plugin
                    .updateSettings((draft) => {
                        draft.resources.splice(index, 1)
                    })
                    .then(() => {
                        this.update()
                    })
            },
            addItem: {
                name: 'Add resource',
                action: (): void => {
                    void this.plugin
                        .updateSettings((draft) => {
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
                        .then(() => {
                            this.update()
                        })
                }
            }
        }
    }

    /**
     * One navigable sub-page per resource. Value keys use the resource's
     * stable `id`, never its index (see class docs).
     */
    private resourcePage(resource: ManualResource): SettingGroupItem {
        const id = resource.id
        return {
            type: 'page',
            name: resource.displayName || '(unnamed resource)',
            displayValue: (): string => {
                const current = this.plugin.settings.resources.find((r) => r.id === id)
                return current ? RESOURCE_TYPE_LABELS[current.type] : ''
            },
            items: [
                {
                    name: 'Type',
                    control: {
                        type: 'dropdown',
                        key: `resource.${id}.type`,
                        options: RESOURCE_TYPE_LABELS
                    }
                },
                {
                    name: 'Display name',
                    control: { type: 'text', key: `resource.${id}.displayName` }
                },
                {
                    name: 'Slug',
                    desc: 'URN terminal segment.',
                    control: { type: 'text', key: `resource.${id}.slug` }
                },
                {
                    name: 'URL',
                    control: { type: 'text', key: `resource.${id}.url` }
                }
            ]
        }
    }

    // ----- Section 4: Search backend -----

    private searchBackendGroup(): SettingDefinitionItem {
        const isLocal = (): boolean => this.plugin.settings.searchBackend.kind === 'local-model'
        const isHosted = (): boolean => this.plugin.settings.searchBackend.kind === 'hosted-api'
        const isCustom = (): boolean =>
            isHosted() && this.plugin.settings.searchBackend.apiProvider === 'custom'
        return {
            type: 'group',
            heading: 'Search backend',
            items: [
                {
                    name: 'Backend',
                    desc: 'Powers POST /search ranking. The built-in lexical backend needs no download.',
                    control: {
                        type: 'dropdown',
                        key: 'searchBackend.kind',
                        options: BACKEND_LABELS
                    }
                },
                {
                    name: 'Local embedding server',
                    desc:
                        'Hybrid search: lexical BM25 fused with dense embeddings from a local ' +
                        'OpenAI-compatible embedding server you already run (Ollama, LM Studio, ' +
                        'llama.cpp, …). Nothing is downloaded by the plugin. If the server is ' +
                        'unreachable, searches fall back to the built-in lexical backend ' +
                        'automatically. Changing these restarts the registry.',
                    searchable: false,
                    visible: isLocal
                },
                {
                    name: 'Embedding server URL',
                    desc: 'OpenAI-compatible base or /embeddings URL.',
                    visible: isLocal,
                    control: {
                        type: 'text',
                        key: 'searchBackend.embeddingServerUrl',
                        placeholder: 'http://localhost:11434/v1'
                    }
                },
                {
                    name: 'Embedding model',
                    desc: 'Model name the server should use.',
                    visible: isLocal,
                    control: {
                        type: 'text',
                        key: 'searchBackend.embeddingModel',
                        placeholder: 'nomic-embed-text'
                    }
                },
                {
                    name: 'Hosted embedding API',
                    desc:
                        'Hybrid search using a remote OpenAI-compatible embedding API (bring your ' +
                        'own key). The query and your skill metadata (names, descriptions, tags) ' +
                        'are sent to the provider to embed. Unreachable or unauthorized requests ' +
                        'fall back to lexical automatically. Changing these restarts the registry.',
                    searchable: false,
                    visible: isHosted
                },
                {
                    name: 'Provider',
                    desc: 'OpenAI-compatible embedding provider, or custom for any other gateway.',
                    visible: isHosted,
                    control: {
                        type: 'dropdown',
                        key: 'searchBackend.apiProvider',
                        options: Object.fromEntries(HOSTED_EMBEDDING_PROVIDERS.map((p) => [p, p]))
                    }
                },
                {
                    name: 'API base URL',
                    desc: 'OpenAI-compatible base or /embeddings URL.',
                    visible: isCustom,
                    control: {
                        type: 'text',
                        key: 'searchBackend.apiBaseUrl',
                        placeholder: 'https://api.example.com/v1'
                    }
                },
                {
                    name: 'Base URL required',
                    searchable: false,
                    visible: (): boolean =>
                        isCustom() && !this.plugin.settings.searchBackend.apiBaseUrl?.trim(),
                    render: (setting): void => {
                        setting.settingEl.addClass('ard-settings-embed')
                        setting.infoEl.remove()
                        setting.settingEl
                            .createEl('p', {
                                cls: 'ard-setting-warning',
                                text: 'A base URL is required for the custom provider — search stays lexical until it is set.'
                            })
                            .setAttr('role', 'alert')
                    }
                },
                {
                    name: 'Model',
                    desc: 'Embedding model name (leave blank to use the provider default).',
                    visible: isHosted,
                    control: {
                        type: 'text',
                        key: 'searchBackend.apiModel',
                        placeholder: 'text-embedding-3-small'
                    }
                },
                {
                    name: 'API key',
                    desc: 'Sent as a Bearer token. Stored in plugin data — treat it as a secret.',
                    visible: isHosted,
                    // No password control type exists; render a masked input.
                    render: (setting): void => {
                        setting.addText((text) => {
                            text.inputEl.type = 'password'
                            text.setPlaceholder('sk-…')
                                .setValue(this.plugin.settings.searchBackend.apiKey ?? '')
                                .onChange(async (value) => {
                                    await this.plugin.updateSettings((draft) => {
                                        draft.searchBackend.apiKey = value.trim() || undefined
                                    })
                                })
                        })
                    }
                },
                {
                    name: 'Reindex',
                    desc: 'Rebuild the search index over the current catalog without rescanning folders.',
                    render: (setting): void => {
                        setting.addButton((button) =>
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
                }
            ]
        }
    }

    // ----- Section 5: Support -----

    private supportGroup(): SettingDefinitionItem {
        return {
            type: 'group',
            // No heading: renderSharedSupportSection draws its own.
            items: [
                {
                    name: 'Support',
                    searchable: false,
                    render: (setting): void => {
                        setting.settingEl.addClass('ard-settings-embed')
                        setting.infoEl.remove()
                        renderSharedSupportSection(setting.settingEl, (el) => {
                            const linkEl = el.createEl('a', { href: BUY_ME_A_COFFEE_URL })
                            const imgEl = linkEl.createEl('img')
                            imgEl.src = BUY_ME_A_COFFEE_BADGE_DATA_URL
                            imgEl.alt = 'Buy me a coffee'
                            imgEl.width = 175
                        })
                    }
                }
            ]
        }
    }
}
