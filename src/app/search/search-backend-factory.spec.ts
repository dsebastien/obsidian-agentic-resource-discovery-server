import { describe, it, expect } from 'bun:test'
import { createSearchBackend } from './search-backend-factory'
import { SearchBackendConfigSchema } from '../types/plugin-settings.intf'

const config = (over: object = {}) => SearchBackendConfigSchema.parse(over)

describe('createSearchBackend', () => {
    it('creates the lexical backend by default', () => {
        expect(createSearchBackend(config()).name).toBe('lexical')
    })

    it('falls back to lexical for not-yet-implemented backends', () => {
        // local-model / qmd-sidecar / hosted-api are deferred; they must not
        // crash the registry — they degrade to the always-available lexical one.
        expect(createSearchBackend(config({ kind: 'local-model' })).name).toBe('lexical')
        expect(createSearchBackend(config({ kind: 'qmd-sidecar' })).name).toBe('lexical')
        expect(createSearchBackend(config({ kind: 'hosted-api' })).name).toBe('lexical')
    })
})
