import { describe, it, expect } from 'bun:test'
import { generateBearerToken } from './token'

describe('generateBearerToken', () => {
    it('returns 64 lowercase hex characters (256 bits of entropy)', () => {
        const token = generateBearerToken()
        expect(token).toMatch(/^[0-9a-f]{64}$/)
    })

    it('returns a different value on each call', () => {
        const a = generateBearerToken()
        const b = generateBearerToken()
        expect(a).not.toBe(b)
    })
})
