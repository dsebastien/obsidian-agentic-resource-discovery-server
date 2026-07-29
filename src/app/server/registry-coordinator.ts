import { log } from '../../utils/log'
import type { ScanCache, ScanContext, ScanResult } from '../skills/skill-scanner'
import type { PluginSettings } from '../types/plugin-settings.intf'

/**
 * Orchestrates the registry lifecycle: what runs when, in what order, and what a
 * settings change implies.
 *
 * This is the plugin's brain, deliberately kept free of Obsidian: `plugin.ts` is
 * a thin adapter that supplies settings, filesystem scanning, and user-facing
 * notices through the ports below. That keeps the parts where a regression
 * hurts most — the operation mutex, the post-unload guard, the restart-vs-
 * rebuild decision, the watcher reconcile — under unit test.
 */

/** The slice of {@link RegistryController} the coordinator drives. */
export interface RegistryPort {
    start(settings: PluginSettings): Promise<void>
    stop(): Promise<void>
    rebuild(settings: PluginSettings): Promise<void>
    setSkillEntries(
        settings: PluginSettings,
        entries: ScanResult['entries'],
        folders: Map<string, string>
    ): Promise<void>
    reindex(): Promise<void>
    readonly isRunning: boolean
    readonly port: number | null
    readonly embeddingsNeedRetry: boolean
}

/** The slice of {@link SkillWatcher} the coordinator drives. */
export interface WatcherPort {
    /** Returns the folders that could not be watched. */
    start(folders: string[], onChange: () => void): string[]
    stop(): void
}

export interface CoordinatorDeps {
    registry: RegistryPort
    watcher: WatcherPort
    /** Current settings. The host owns them (and their persistence). */
    settings: () => PluginSettings
    /** Configured skill folders, already resolved to absolute paths. */
    skillFolders: () => string[]
    /** Scan the folders. Injected so filesystem and timers stay out of here. */
    scan: (folders: string[], ctx: ScanContext, cache: ScanCache | undefined) => Promise<ScanResult>
    /** Called after a successful scan (persist stats, refresh the settings tab). */
    onScanned: (result: ScanResult) => Promise<void>
    /** Surface a message to the user (a `Notice` in the plugin). */
    notify: (message: string) => void
}

export class RegistryCoordinator {
    /**
     * Serialises every registry-mutating operation (start, rescan, reindex,
     * settings reconcile) so a background skill scan and a concurrent settings
     * change can't race — e.g. both calling start() on the same port at once.
     */
    private opChain: Promise<void> = Promise.resolve()

    /** Set by {@link dispose} so no in-flight/queued op resurrects the server. */
    private disposed = false

    /** Previous scan, reused so an unchanged `SKILL.md` is never re-parsed. */
    private scanCache: ScanCache | undefined = undefined

    constructor(private readonly deps: CoordinatorDeps) {}

    /** Start the registry server (queued behind any in-flight operation). */
    start(): Promise<void> {
        return this.serialize(() => this.startRegistry())
    }

    /**
     * Scan the configured skill folders and feed the results into the catalog.
     * Incremental: unchanged files are reused from the previous scan.
     */
    rescanSkills(): Promise<void> {
        return this.serialize(() => this.doRescanSkills())
    }

    /** Rebuild the search index over the current catalog (no rescan, no restart). */
    reindex(): Promise<void> {
        return this.serialize(async () => {
            try {
                await this.deps.registry.reindex()
                log('Search index rebuilt', 'debug')
            } catch (error) {
                log('Reindex failed', 'error', error)
            }
        })
    }

    /** Reconcile the running server (and the watcher) with a settings change. */
    applySettings(previous: PluginSettings, next: PluginSettings): Promise<void> {
        return this.serialize(async () => {
            try {
                if (!this.deps.registry.isRunning || requiresRestart(previous, next)) {
                    await this.startRegistry()
                } else {
                    await this.deps.registry.rebuild(next)
                }
                this.reconcileWatcher()
            } catch (error) {
                log('Failed to reconcile registry server', 'error', error)
            }
        })
    }

    /**
     * Start or stop the opt-in skill-folder watcher to match current settings,
     * warning the user about folders the platform refused to watch.
     */
    reconcileWatcher(): void {
        if (this.disposed) {
            return
        }
        const folders = this.deps.skillFolders()
        if (this.deps.settings().watchSkillFolders && folders.length > 0) {
            const failed = this.deps.watcher.start(folders, () => void this.rescanSkills())
            if (failed.length > 0) {
                this.deps.notify(
                    `ARD: could not watch ${failed.length} skill folder(s) for changes. ` +
                        `Use "Rescan skills now" to pick up edits manually.`
                )
            }
        } else {
            this.deps.watcher.stop()
        }
    }

    /**
     * Re-attempt embeddings when the backend's last build failed (e.g. the local
     * embedding server has since started). No-op while it's building, ready, or
     * when the backend has no embeddings — so a slow build is never interrupted.
     */
    retryEmbeddingsIfNeeded(): void {
        if (this.deps.registry.embeddingsNeedRetry) {
            log('Retrying failed embedding build', 'debug')
            void this.reindex()
        }
    }

    /** Stop everything. Queued and in-flight operations become no-ops. */
    dispose(): void {
        this.disposed = true
        this.deps.watcher.stop()
        this.deps.registry.stop().catch((error: unknown) => {
            log('Registry stop failed on unload', 'error', error)
        })
    }

    /** Run a registry-mutating operation after any in-flight one completes. */
    private serialize(op: () => Promise<void>): Promise<void> {
        // Skip if the plugin unloaded by the time this op is dequeued.
        const guarded = (): Promise<void> => (this.disposed ? Promise.resolve() : op())
        const next = this.opChain.then(guarded, guarded)
        this.opChain = next.then(
            () => undefined,
            () => undefined
        )
        return next
    }

    private async startRegistry(): Promise<void> {
        const settings = this.deps.settings()
        try {
            await this.deps.registry.start(settings)
            log('Registry server started', 'debug')
        } catch (error) {
            log('Failed to start registry server', 'error', error)
            this.deps.notify(
                `ARD: could not start the registry server on port ${settings.server.port}. ` +
                    `It may already be in use — change the port in settings.`
            )
        }
    }

    private async doRescanSkills(): Promise<void> {
        const folders = this.deps.skillFolders()
        if (folders.length === 0) {
            return
        }
        const settings = this.deps.settings()
        const port = this.deps.registry.port ?? settings.server.port
        try {
            const result = await this.deps.scan(
                folders,
                { publisher: settings.publisher, baseUrl: `http://127.0.0.1:${port}` },
                this.scanCache
            )
            if (this.disposed) {
                return // unloaded mid-scan; don't resurrect the registry
            }
            this.scanCache = result.cache
            await this.deps.registry.setSkillEntries(settings, result.entries, result.folders)
            await this.deps.onScanned(result)
            const dupes = result.duplicateCount > 0 ? `, ${result.duplicateCount} duplicates` : ''
            log(
                `Scanned ${result.skillCount} skills (${result.errorCount} errors${dupes}); ` +
                    `${result.parsedCount} parsed, ${result.reusedCount} unchanged`,
                'debug'
            )
        } catch (error) {
            log('Skill scan failed', 'error', error)
        }
    }
}

/**
 * Whether a settings change requires restarting the server rather than
 * rebuilding the catalog in place.
 *
 * The bind address and port are baked into the listening socket, and the search
 * backend is built once at start — capturing its config (embedding server URL,
 * model, API credentials) — so any of those changing must recreate it.
 */
export function requiresRestart(previous: PluginSettings, next: PluginSettings): boolean {
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
    return (
        previous.server.port !== next.server.port ||
        previous.server.bindAddress !== next.server.bindAddress ||
        backendChanged
    )
}
