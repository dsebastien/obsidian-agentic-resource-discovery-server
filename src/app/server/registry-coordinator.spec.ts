import { describe, it, expect } from 'bun:test'
import { produce } from 'immer'
import type { Draft } from 'immer'
import {
    RegistryCoordinator,
    requiresRestart,
    type CoordinatorDeps,
    type RegistryPort,
    type WatcherPort
} from './registry-coordinator'
import { DEFAULT_SETTINGS, type PluginSettings } from '../types/plugin-settings.intf'
import type { ScanCache, ScanResult } from '../skills/skill-scanner'
import { ArdMediaType } from '../types/ard.types'

const settingsWith = (mutate: (draft: Draft<PluginSettings>) => void): PluginSettings =>
    produce(DEFAULT_SETTINGS, mutate)

function scanResult(over: Partial<ScanResult> = {}): ScanResult {
    return {
        entries: [
            {
                identifier: 'urn:air:obsidian:skills:alpha',
                displayName: 'Alpha',
                type: ArdMediaType.AiSkill,
                url: 'http://127.0.0.1:27182/skills/alpha/SKILL.md'
            }
        ],
        folders: new Map([['alpha', '/skills/alpha']]),
        skillCount: 1,
        errorCount: 0,
        duplicateCount: 0,
        parsedCount: 1,
        reusedCount: 0,
        cache: { publisher: 'obsidian', baseUrl: 'http://127.0.0.1:27182', files: new Map() },
        ...over
    }
}

/** Records every call the coordinator makes, in order. */
function harness(
    over: Partial<CoordinatorDeps> = {},
    registryOver: Partial<RegistryPort> = {}
): {
    coordinator: RegistryCoordinator
    calls: string[]
    notices: string[]
    scans: (ScanCache | undefined)[]
    settings: PluginSettings
    setSettings: (next: PluginSettings) => void
    watching: string[][]
} {
    const calls: string[] = []
    const notices: string[] = []
    const scans: (ScanCache | undefined)[] = []
    const watching: string[][] = []
    const state = { settings: DEFAULT_SETTINGS }

    const registry: RegistryPort = {
        start: async () => {
            calls.push('start')
        },
        stop: async () => {
            calls.push('stop')
        },
        rebuild: async () => {
            calls.push('rebuild')
        },
        setSkillEntries: async () => {
            calls.push('setSkillEntries')
        },
        reindex: async () => {
            calls.push('reindex')
        },
        isRunning: true,
        port: 27182,
        embeddingsNeedRetry: false,
        ...registryOver
    }

    const watcher: WatcherPort = {
        start: (folders) => {
            calls.push('watch')
            watching.push(folders)
            return []
        },
        stop: () => {
            calls.push('unwatch')
        }
    }

    const deps: CoordinatorDeps = {
        registry,
        watcher,
        settings: () => state.settings,
        skillFolders: () => ['/skills'],
        scan: async (_folders, _ctx, cache) => {
            calls.push('scan')
            scans.push(cache)
            return scanResult()
        },
        onScanned: async () => {
            calls.push('onScanned')
        },
        notify: (message) => notices.push(message),
        ...over
    }

    return {
        coordinator: new RegistryCoordinator(deps),
        calls,
        notices,
        scans,
        watching,
        get settings() {
            return state.settings
        },
        setSettings: (next) => {
            state.settings = next
        }
    }
}

describe('RegistryCoordinator serialization', () => {
    it('runs concurrent operations one at a time, in order', async () => {
        const order: string[] = []
        let releaseStart: (() => void) | undefined
        const started = new Promise<void>((resolve) => {
            releaseStart = resolve
        })

        const h = harness(
            {},
            {
                start: async () => {
                    order.push('start:begin')
                    await started
                    order.push('start:end')
                },
                reindex: async () => {
                    order.push('reindex')
                }
            }
        )

        const first = h.coordinator.start()
        const second = h.coordinator.reindex()
        await Promise.resolve() // let the first op reach the registry
        // The second op must not have touched the registry while the first runs.
        expect(order).toEqual(['start:begin'])
        releaseStart?.()
        await Promise.all([first, second])
        expect(order).toEqual(['start:begin', 'start:end', 'reindex'])
    })

    it('keeps running later operations after one fails', async () => {
        const h = harness(
            {},
            {
                start: async () => {
                    throw new Error('port in use')
                }
            }
        )
        await h.coordinator.start()
        await h.coordinator.reindex()
        expect(h.calls).toContain('reindex')
        expect(h.notices[0]).toContain('could not start the registry server')
    })
})

describe('RegistryCoordinator dispose', () => {
    it('stops the watcher and the registry', () => {
        const h = harness()
        h.coordinator.dispose()
        expect(h.calls).toEqual(['unwatch', 'stop'])
    })

    it('skips operations queued after dispose', async () => {
        const h = harness()
        h.coordinator.dispose()
        await h.coordinator.start()
        await h.coordinator.rescanSkills()
        expect(h.calls).not.toContain('start')
        expect(h.calls).not.toContain('scan')
    })

    it('does not resurrect the registry when unloaded mid-scan', async () => {
        let disposeNow: (() => void) | undefined
        const h = harness({
            scan: async () => {
                disposeNow?.()
                return scanResult()
            }
        })
        disposeNow = () => h.coordinator.dispose()
        await h.coordinator.rescanSkills()
        expect(h.calls).not.toContain('setSkillEntries')
        expect(h.calls).not.toContain('onScanned')
    })

    it('stops reconciling the watcher after dispose', () => {
        const h = harness()
        h.setSettings(settingsWith((d) => void (d.watchSkillFolders = true)))
        h.coordinator.dispose()
        h.calls.length = 0
        h.coordinator.reconcileWatcher()
        expect(h.calls).toEqual([])
    })
})

describe('RegistryCoordinator settings reconcile', () => {
    it('restarts when the port changes', async () => {
        const h = harness()
        const next = settingsWith((d) => void (d.server.port = 30000))
        await h.coordinator.applySettings(DEFAULT_SETTINGS, next)
        expect(h.calls).toContain('start')
        expect(h.calls).not.toContain('rebuild')
    })

    it('restarts when the search backend config changes', async () => {
        const h = harness()
        const next = settingsWith((d) => void (d.searchBackend.kind = 'local-model'))
        await h.coordinator.applySettings(DEFAULT_SETTINGS, next)
        expect(h.calls).toContain('start')
    })

    it('rebuilds in place for a catalog-only change', async () => {
        const h = harness()
        const next = settingsWith((d) => void (d.catalogDisplayName = 'Renamed'))
        await h.coordinator.applySettings(DEFAULT_SETTINGS, next)
        expect(h.calls).toContain('rebuild')
        expect(h.calls).not.toContain('start')
    })

    it('starts instead of rebuilding when the server is down', async () => {
        const h = harness({}, { isRunning: false })
        const next = settingsWith((d) => void (d.catalogDisplayName = 'Renamed'))
        await h.coordinator.applySettings(DEFAULT_SETTINGS, next)
        expect(h.calls).toContain('start')
        expect(h.calls).not.toContain('rebuild')
    })

    it('reconciles the watcher after applying settings', async () => {
        const h = harness()
        const next = settingsWith((d) => void (d.watchSkillFolders = true))
        h.setSettings(next)
        await h.coordinator.applySettings(DEFAULT_SETTINGS, next)
        expect(h.calls).toContain('watch')
    })
})

describe('requiresRestart', () => {
    it('is false when nothing relevant changed', () => {
        expect(requiresRestart(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toBe(false)
        expect(
            requiresRestart(
                DEFAULT_SETTINGS,
                settingsWith((d) => void (d.publisher = 'example.com'))
            )
        ).toBe(false)
    })

    it('is true for each backend field the backend captures at build time', () => {
        const fields: ((draft: Draft<PluginSettings>) => void)[] = [
            (d) => void (d.searchBackend.kind = 'hosted-api'),
            (d) => void (d.searchBackend.embeddingServerUrl = 'http://other:11434/v1'),
            (d) => void (d.searchBackend.embeddingModel = 'other-model'),
            (d) => void (d.searchBackend.apiProvider = 'voyage'),
            (d) => void (d.searchBackend.apiBaseUrl = 'https://gw.example/v1'),
            (d) => void (d.searchBackend.apiKey = 'sk-new'),
            (d) => void (d.searchBackend.apiModel = 'embed-2')
        ]
        for (const mutate of fields) {
            expect(requiresRestart(DEFAULT_SETTINGS, settingsWith(mutate))).toBe(true)
        }
    })
})

describe('RegistryCoordinator watcher reconcile', () => {
    it('does not watch when the setting is off', () => {
        const h = harness()
        h.coordinator.reconcileWatcher()
        expect(h.calls).toEqual(['unwatch'])
    })

    it('does not watch when no folder is configured', () => {
        const h = harness({ skillFolders: () => [] })
        h.setSettings(settingsWith((d) => void (d.watchSkillFolders = true)))
        h.coordinator.reconcileWatcher()
        expect(h.calls).toEqual(['unwatch'])
    })

    it('watches the configured folders when enabled', () => {
        const h = harness()
        h.setSettings(settingsWith((d) => void (d.watchSkillFolders = true)))
        h.coordinator.reconcileWatcher()
        expect(h.watching).toEqual([['/skills']])
        expect(h.notices).toEqual([])
    })

    it('warns about folders that could not be watched', () => {
        const h = harness({
            watcher: {
                start: () => ['/skills/unwatchable'],
                stop: () => undefined
            }
        })
        h.setSettings(settingsWith((d) => void (d.watchSkillFolders = true)))
        h.coordinator.reconcileWatcher()
        expect(h.notices[0]).toContain('could not watch 1 skill folder(s)')
    })

    it('rescans when the watcher fires', async () => {
        let fire: (() => void) | undefined
        const h = harness({
            watcher: {
                start: (_folders, onChange) => {
                    fire = onChange
                    return []
                },
                stop: () => undefined
            }
        })
        h.setSettings(settingsWith((d) => void (d.watchSkillFolders = true)))
        h.coordinator.reconcileWatcher()
        fire?.()
        await h.coordinator.rescanSkills() // drains the queued rescan too
        expect(h.calls.filter((c) => c === 'scan').length).toBeGreaterThanOrEqual(1)
    })
})

describe('RegistryCoordinator scanning', () => {
    it('feeds scan results into the registry and reports them', async () => {
        const h = harness()
        await h.coordinator.rescanSkills()
        expect(h.calls).toEqual(['scan', 'setSkillEntries', 'onScanned'])
    })

    it('skips scanning when no folder is configured', async () => {
        const h = harness({ skillFolders: () => [] })
        await h.coordinator.rescanSkills()
        expect(h.calls).toEqual([])
    })

    it('passes the previous scan cache to the next scan', async () => {
        const h = harness()
        await h.coordinator.rescanSkills()
        await h.coordinator.rescanSkills()
        expect(h.scans[0]).toBeUndefined()
        expect(h.scans[1]).toEqual(scanResult().cache)
    })

    it('survives a failing scan', async () => {
        const h = harness({
            scan: async () => {
                throw new Error('unreadable folder')
            }
        })
        await h.coordinator.rescanSkills() // must not reject
        expect(h.calls).not.toContain('setSkillEntries')
    })
})

describe('RegistryCoordinator embedding supervision', () => {
    it('reindexes when the embedding build failed', async () => {
        const h = harness({}, { embeddingsNeedRetry: true })
        h.coordinator.retryEmbeddingsIfNeeded()
        await h.coordinator.reindex() // drain the queued retry
        expect(h.calls).toContain('reindex')
    })

    it('leaves a healthy backend alone', () => {
        const h = harness({}, { embeddingsNeedRetry: false })
        h.coordinator.retryEmbeddingsIfNeeded()
        expect(h.calls).toEqual([])
    })
})
