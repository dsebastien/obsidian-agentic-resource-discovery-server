import { describe, it, expect } from 'bun:test'
import { createSearchBackend } from './search-backend-factory'
import { SearchBackendConfigSchema } from '../types/plugin-settings.intf'

const config = (over: object = {}) => SearchBackendConfigSchema.parse(over)

describe('createSearchBackend', () => {
    it('creates the lexical backend by default', () => {
        expect(createSearchBackend(config()).name).toBe('lexical')
    })

    it('creates the hybrid semantic backend for local-model and hosted-api', () => {
        // Embeddings load lazily and degrade to lexical until ready, so
        // constructing these is safe even with no server/key present.
        expect(createSearchBackend(config({ kind: 'local-model' })).name).toBe('semantic')
        expect(createSearchBackend(config({ kind: 'hosted-api' })).name).toBe('semantic')
    })

    it('falls back to lexical for the still-deferred qmd-sidecar backend', () => {
        // Not implemented yet; must not crash the registry — degrades to lexical.
        expect(createSearchBackend(config({ kind: 'qmd-sidecar' })).name).toBe('lexical')
    })
})
