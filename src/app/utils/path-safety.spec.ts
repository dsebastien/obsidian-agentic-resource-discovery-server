import { describe, it, expect } from 'bun:test'
import { safeJoin } from './path-safety'

describe('safeJoin', () => {
    it('joins a relative path inside the root', () => {
        expect(safeJoin('/root/skills', 'SKILL.md')).toBe('/root/skills/SKILL.md')
        expect(safeJoin('/root/skills', 'scripts/run.sh')).toBe('/root/skills/scripts/run.sh')
    })

    it('rejects parent-directory traversal', () => {
        expect(safeJoin('/root/skills', '../secret')).toBeNull()
        expect(safeJoin('/root/skills', '../../etc/passwd')).toBeNull()
    })

    it('rejects URL-encoded traversal', () => {
        expect(safeJoin('/root/skills', '..%2F..%2Fetc%2Fpasswd')).toBeNull()
    })

    it('rejects null bytes', () => {
        expect(safeJoin('/root/skills', 'a\0b')).toBeNull()
    })

    it('keeps an absolute-looking segment contained within the root', () => {
        // path.join treats a leading slash as relative, so it cannot escape
        const result = safeJoin('/root/skills', '/etc/passwd')
        expect(result).toBe('/root/skills/etc/passwd')
    })

    it('allows the root itself', () => {
        expect(safeJoin('/root/skills', '')).toBe('/root/skills')
    })
})
