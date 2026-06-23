import { describe, it, expect } from 'bun:test'
import { SkillWatcher, type WatchFn } from './skill-watcher'

const timers = {
    set: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)
}

/** A fake watch primitive that lets the test fire events for a folder. */
function fakeWatch() {
    const listeners = new Map<string, (filename: string | null) => void>()
    const watchFn: WatchFn = (dir, onEvent) => {
        listeners.set(dir, onEvent)
        return { close: () => listeners.delete(dir) }
    }
    return {
        watchFn,
        fire: (dir: string, filename: string | null) => listeners.get(dir)?.(filename),
        watchedDirs: () => [...listeners.keys()]
    }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('SkillWatcher', () => {
    it('triggers a debounced rescan after a SKILL.md change', async () => {
        const { watchFn, fire } = fakeWatch()
        let calls = 0
        const watcher = new SkillWatcher(watchFn, timers, 20)
        watcher.start(['/skills'], () => calls++)

        fire('/skills', 'SKILL.md')
        fire('/skills', 'sub/SKILL.md') // rapid second event
        await delay(50)
        expect(calls).toBe(1) // debounced into one rescan
        watcher.stop()
    })

    it('ignores changes to non-SKILL.md files', async () => {
        const { watchFn, fire } = fakeWatch()
        let calls = 0
        const watcher = new SkillWatcher(watchFn, timers, 20)
        watcher.start(['/skills'], () => calls++)

        fire('/skills', 'assets/diagram.png')
        await delay(50)
        expect(calls).toBe(0)
        watcher.stop()
    })

    it('reacts to a null filename (platforms that omit it)', async () => {
        const { watchFn, fire } = fakeWatch()
        let calls = 0
        const watcher = new SkillWatcher(watchFn, timers, 20)
        watcher.start(['/skills'], () => calls++)

        fire('/skills', null)
        await delay(50)
        expect(calls).toBe(1)
        watcher.stop()
    })

    it('watches every configured folder and skips blank paths', () => {
        const { watchFn, watchedDirs } = fakeWatch()
        const watcher = new SkillWatcher(watchFn, timers, 20)
        watcher.start(['/a', '  ', '/b'], () => {})
        expect(watchedDirs().sort()).toEqual(['/a', '/b'])
        expect(watcher.watching).toBe(true)
        watcher.stop()
        expect(watcher.watching).toBe(false)
    })

    it('stop() cancels a pending rescan and closes handles', async () => {
        const { watchFn, fire, watchedDirs } = fakeWatch()
        let calls = 0
        const watcher = new SkillWatcher(watchFn, timers, 20)
        watcher.start(['/skills'], () => calls++)

        fire('/skills', 'SKILL.md')
        watcher.stop() // before the debounce elapses
        await delay(50)
        expect(calls).toBe(0)
        expect(watchedDirs()).toEqual([])
    })

    it('restarting replaces the previous watches', () => {
        const { watchFn, watchedDirs } = fakeWatch()
        const watcher = new SkillWatcher(watchFn, timers, 20)
        watcher.start(['/a'], () => {})
        watcher.start(['/b'], () => {})
        expect(watchedDirs()).toEqual(['/b'])
        watcher.stop()
    })
})
