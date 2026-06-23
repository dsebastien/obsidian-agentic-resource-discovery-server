import { watch } from 'node:fs'

/**
 * Opt-in filesystem watcher for skill folders.
 *
 * Off by default. When enabled, it watches the configured folders and fires a
 * single debounced callback after `SKILL.md` files change, so the catalog
 * rebuilds without the user clicking "Rescan". Best-effort: recursive watching
 * is unreliable on some platforms and on network/cloud-synced (FUSE) mounts —
 * the manual rescan button remains the dependable path.
 *
 * The fs-watch primitive and timers are injected so the debounce/filter logic is
 * deterministic in tests (no real filesystem, no real clock dependency).
 */

export interface WatchHandle {
    close(): void
}

export type WatchFn = (dir: string, onEvent: (filename: string | null) => void) => WatchHandle

export interface WatcherTimers {
    set: (callback: () => void, ms: number) => unknown
    clear: (handle: unknown) => void
}

export class SkillWatcher {
    private handles: WatchHandle[] = []
    private timer: unknown = undefined
    private onChange: (() => void) | null = null

    constructor(
        private readonly watchFn: WatchFn,
        private readonly timers: WatcherTimers,
        private readonly debounceMs = 800
    ) {}

    /** Start watching the folders; replaces any previous watches. */
    start(folders: string[], onChange: () => void): void {
        this.stop()
        this.onChange = onChange
        for (const folder of folders) {
            if (!folder.trim()) {
                continue
            }
            this.handles.push(this.watchFn(folder, (filename) => this.handleEvent(filename)))
        }
    }

    stop(): void {
        for (const handle of this.handles) {
            handle.close()
        }
        this.handles = []
        if (this.timer !== undefined) {
            this.timers.clear(this.timer)
            this.timer = undefined
        }
        this.onChange = null
    }

    get watching(): boolean {
        return this.handles.length > 0
    }

    private handleEvent(filename: string | null): void {
        // Only SKILL.md changes affect the catalog. A null filename (some
        // platforms omit it) is treated as "something changed" → rescan.
        if (filename !== null && !filename.endsWith('SKILL.md')) {
            return
        }
        if (this.timer !== undefined) {
            this.timers.clear(this.timer)
        }
        this.timer = this.timers.set(() => {
            this.timer = undefined
            this.onChange?.()
        }, this.debounceMs)
    }
}

/** Default fs-watch primitive (recursive; degrades to a no-op if unsupported). */
export const nodeFsWatchFn: WatchFn = (dir, onEvent) => {
    try {
        const watcher = watch(dir, { recursive: true }, (_event, filename) => {
            onEvent(filename === null || filename === undefined ? null : String(filename))
        })
        watcher.on('error', () => {})
        return { close: () => watcher.close() }
    } catch {
        // e.g. recursive watching unavailable on this platform/filesystem.
        return { close: () => {} }
    }
}
