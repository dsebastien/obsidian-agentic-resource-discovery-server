import { describe, it, expect } from 'bun:test'
import { createSearchBackend } from './search-backend-factory'
import { SearchBackendConfigSchema } from '../types/plugin-settings.intf'

const config = (over: object = {}) => SearchBackendConfigSchema.parse(over)

describe('createSearchBackend', () => {
    it('creates the lexical backend by default', () => {
        expect(createSearchBackend(config()).name).toBe('lexical')
    })

    it('creates the hybrid semantic backend for local-model', () => {
        // The embedding model loads lazily and degrades to lexical until ready,
        // so constructing it is safe even without the model present.
        expect(createSearchBackend(config({ kind: 'local-model' })).name).toBe('semantic')
    })

    it('falls back to lexical for the still-deferred backends', () => {
        // qmd-sidecar / hosted-api are not implemented yet; they must not crash
        // the registry — they degrade to the always-available lexical one.
        expect(createSearchBackend(config({ kind: 'qmd-sidecar' })).name).toBe('lexical')
        expect(createSearchBackend(config({ kind: 'hosted-api' })).name).toBe('lexical')
    })
})
