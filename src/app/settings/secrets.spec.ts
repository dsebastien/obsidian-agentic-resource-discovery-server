import { describe, expect, it } from 'bun:test'
import {
    LEGACY_SECRET_GRACE_DAYS,
    parsePluginSettings,
    type PluginSettings
} from '../types/plugin-settings.intf'
import {
    clearSecret,
    DEFAULT_BEARER_TOKEN_SECRET_NAME,
    DEFAULT_EMBEDDING_API_KEY_SECRET_NAME,
    ensureBearerTokenSecret,
    hasLegacySecretCopies,
    isSecretMissing,
    legacyGraceExpired,
    migrateLegacySecrets,
    readSecret,
    removeLegacySecretCopies,
    resolveBearerToken,
    resolveEmbeddingApiKey,
    rotateSecret,
    selectSecretName,
    storeSecret,
    type SecretStore
} from './secrets'

/** In-memory SecretStorage mirroring Obsidian's id validation. */
class FakeSecretStore implements SecretStore {
    readonly secrets = new Map<string, string>()
    failWrites = false

    constructor(initial: Record<string, string> = {}) {
        for (const [k, v] of Object.entries(initial)) this.secrets.set(k, v)
    }

    getSecret(id: string): string | null {
        return this.secrets.get(id) ?? null
    }

    setSecret(id: string, secret: string): void {
        if (this.failWrites) throw new Error('storage unavailable')
        if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`invalid id ${id}`)
        this.secrets.set(id, secret)
    }
}

/** Settings as loaded from a legacy (pre-SecretStorage) data.json. */
const legacy = (server: object = {}, searchBackend: object = {}): PluginSettings =>
    parsePluginSettings({ server, searchBackend })

/** What saveData would write, round-tripped through JSON. */
const persisted = (settings: PluginSettings): Record<string, Record<string, unknown>> =>
    JSON.parse(JSON.stringify(settings)) as Record<string, Record<string, unknown>>

const NOW = new Date('2026-10-03T10:00:00.000Z')
const daysLater = (days: number): Date => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000)

describe('migrateLegacySecrets', () => {
    it('copies a legacy bearer token into SecretStorage, keeping the plaintext bootstrap', () => {
        const store = new FakeSecretStore()
        const { settings, changed, failed } = migrateLegacySecrets(
            legacy({ bearerToken: 'tok-123' }),
            store,
            NOW
        )
        expect(changed).toBe(true)
        expect(failed).toEqual([])
        expect(store.getSecret(DEFAULT_BEARER_TOKEN_SECRET_NAME)).toBe('tok-123')
        expect(settings.server.bearerTokenSecretName).toBe(DEFAULT_BEARER_TOKEN_SECRET_NAME)
        expect(settings.legacySecretMigratedAt).toBe(NOW.toISOString())
        // Kept so other synced devices can bootstrap from it.
        expect(settings.server.bearerToken).toBe('tok-123')
        // The same token stays in effect: existing clients keep working.
        expect(resolveBearerToken(settings, store)).toBe('tok-123')
    })

    it('copies a legacy hosted API key into SecretStorage', () => {
        const store = new FakeSecretStore()
        const { settings, changed } = migrateLegacySecrets(
            legacy({}, { kind: 'hosted-api', apiKey: 'sk-abc' }),
            store,
            NOW
        )
        expect(changed).toBe(true)
        expect(store.getSecret(DEFAULT_EMBEDDING_API_KEY_SECRET_NAME)).toBe('sk-abc')
        expect(settings.searchBackend.apiKeySecretName).toBe(DEFAULT_EMBEDDING_API_KEY_SECRET_NAME)
        expect(resolveEmbeddingApiKey(settings, store)).toBe('sk-abc')
    })

    it('device B: synced data.json (name + legacy value), empty SecretStorage → migrated and working', () => {
        const deviceA = new FakeSecretStore()
        const fromA = migrateLegacySecrets(
            legacy({ bearerToken: 'tok' }, { apiKey: 'sk' }),
            deviceA,
            NOW
        ).settings
        const synced = parsePluginSettings(persisted(fromA))

        const deviceB = new FakeSecretStore()
        // Before migrating, B already works off the bootstrap copy.
        expect(resolveBearerToken(synced, deviceB)).toBe('tok')
        const { settings, changed } = migrateLegacySecrets(synced, deviceB, daysLater(3))
        expect(changed).toBe(false) // nothing to persist: names and stamp already synced
        expect(deviceB.getSecret(DEFAULT_BEARER_TOKEN_SECRET_NAME)).toBe('tok')
        expect(deviceB.getSecret(DEFAULT_EMBEDDING_API_KEY_SECRET_NAME)).toBe('sk')
        expect(settings.legacySecretMigratedAt).toBe(NOW.toISOString())
        expect(ensureBearerTokenSecret(settings, deviceB, () => 'new').state).toBe('present')
    })

    it('prefers a value already in SecretStorage over the legacy copy', () => {
        const store = new FakeSecretStore({ 'my-token': 'newer' })
        const { settings } = migrateLegacySecrets(
            legacy({ bearerToken: 'older', bearerTokenSecretName: 'my-token' }),
            store,
            NOW
        )
        expect(store.getSecret('my-token')).toBe('newer')
        expect(resolveBearerToken(settings, store)).toBe('newer')
    })

    it('is idempotent', () => {
        const store = new FakeSecretStore()
        const first = migrateLegacySecrets(
            legacy({ bearerToken: 'tok' }, { apiKey: 'sk' }),
            store,
            NOW
        )
        const second = migrateLegacySecrets(first.settings, store, daysLater(1))
        expect(second.changed).toBe(false)
        expect(second.settings).toBe(first.settings)
        const reloaded = migrateLegacySecrets(
            parsePluginSettings(persisted(first.settings)),
            store,
            daysLater(2)
        )
        expect(reloaded.changed).toBe(false)
        expect(store.secrets.size).toBe(2)
    })

    it('does nothing for fresh settings', () => {
        const store = new FakeSecretStore()
        const result = migrateLegacySecrets(parsePluginSettings(undefined), store, NOW)
        expect(result.changed).toBe(false)
        expect(result.settings.legacySecretMigratedAt).toBeUndefined()
        expect(store.secrets.size).toBe(0)
    })

    it('reuses an existing secret holding the same value', () => {
        const store = new FakeSecretStore({ [DEFAULT_BEARER_TOKEN_SECRET_NAME]: 'tok' })
        const { settings } = migrateLegacySecrets(legacy({ bearerToken: 'tok' }), store, NOW)
        expect(settings.server.bearerTokenSecretName).toBe(DEFAULT_BEARER_TOKEN_SECRET_NAME)
        expect(store.secrets.size).toBe(1)
    })

    it('never overwrites a different secret: uses a suffixed name instead', () => {
        const store = new FakeSecretStore({
            [DEFAULT_BEARER_TOKEN_SECRET_NAME]: 'other',
            [`${DEFAULT_BEARER_TOKEN_SECRET_NAME}-2`]: 'another'
        })
        const { settings } = migrateLegacySecrets(legacy({ bearerToken: 'tok' }), store, NOW)
        expect(settings.server.bearerTokenSecretName).toBe(`${DEFAULT_BEARER_TOKEN_SECRET_NAME}-3`)
        expect(store.getSecret(DEFAULT_BEARER_TOKEN_SECRET_NAME)).toBe('other')
        expect(resolveBearerToken(settings, store)).toBe('tok')
    })

    it('drops a blank legacy field without creating a secret', () => {
        const store = new FakeSecretStore()
        const { settings, changed } = migrateLegacySecrets(
            legacy({ bearerToken: '  ' }, { apiKey: '' }),
            store,
            NOW
        )
        expect(changed).toBe(true)
        expect(store.secrets.size).toBe(0)
        expect(settings.legacySecretMigratedAt).toBeUndefined()
        expect(persisted(settings)['server']).not.toHaveProperty('bearerToken')
        expect(persisted(settings)['searchBackend']).not.toHaveProperty('apiKey')
    })

    it('keeps working off the plaintext when SecretStorage refuses the write', () => {
        const store = new FakeSecretStore()
        store.failWrites = true
        const input = legacy({ bearerToken: 'tok' }, { apiKey: 'sk' })
        const { settings, changed, failed } = migrateLegacySecrets(input, store, NOW)
        expect(changed).toBe(false)
        expect(failed).toEqual(['server.bearerToken', 'searchBackend.apiKey'])
        expect(resolveBearerToken(settings, store)).toBe('tok')
        expect(resolveEmbeddingApiKey(settings, store)).toBe('sk')
        store.failWrites = false
        const retried = migrateLegacySecrets(settings, store, NOW)
        expect(retried.changed).toBe(true)
        expect(store.getSecret(DEFAULT_BEARER_TOKEN_SECRET_NAME)).toBe('tok')
    })

    it('purges the plaintext once the 60-day grace period is over', () => {
        const store = new FakeSecretStore()
        const first = migrateLegacySecrets(
            legacy({ bearerToken: 'tok' }, { apiKey: 'sk' }),
            store,
            NOW
        ).settings
        const before = migrateLegacySecrets(first, store, daysLater(LEGACY_SECRET_GRACE_DAYS - 1))
        expect(before.changed).toBe(false)
        expect(hasLegacySecretCopies(before.settings)).toBe(true)

        const after = migrateLegacySecrets(first, store, daysLater(LEGACY_SECRET_GRACE_DAYS))
        expect(after.changed).toBe(true)
        expect(hasLegacySecretCopies(after.settings)).toBe(false)
        expect(persisted(after.settings)['server']).not.toHaveProperty('bearerToken')
        expect(persisted(after.settings)['searchBackend']).not.toHaveProperty('apiKey')
        // Still working from SecretStorage.
        expect(resolveBearerToken(after.settings, store)).toBe('tok')
        expect(resolveEmbeddingApiKey(after.settings, store)).toBe('sk')
    })
})

describe('legacy plaintext lifecycle', () => {
    const migrated = (): { settings: PluginSettings; store: FakeSecretStore } => {
        const store = new FakeSecretStore()
        const { settings } = migrateLegacySecrets(
            legacy({ bearerToken: 'tok' }, { apiKey: 'sk' }),
            store,
            NOW
        )
        return { settings, store }
    }

    it('rotating writes SecretStorage only and removes the stale legacy copy', () => {
        const { settings, store } = migrated()
        const next = rotateSecret(settings, store, 'bearerToken', 'rotated')
        expect(store.getSecret(DEFAULT_BEARER_TOKEN_SECRET_NAME)).toBe('rotated')
        expect(next.server.bearerToken).toBeUndefined()
        expect(JSON.stringify(next)).not.toContain('rotated')
        expect(resolveBearerToken(next, store)).toBe('rotated')
        // The other secret's bootstrap is untouched.
        expect(next.searchBackend.apiKey).toBe('sk')
    })

    it('rotating with no name yet stores under the default name', () => {
        const store = new FakeSecretStore()
        const next = rotateSecret(parsePluginSettings({}), store, 'embeddingApiKey', 'sk-new')
        expect(next.searchBackend.apiKeySecretName).toBe(DEFAULT_EMBEDDING_API_KEY_SECRET_NAME)
        expect(resolveEmbeddingApiKey(next, store)).toBe('sk-new')
    })

    it('selecting another secret name drops the legacy copy', () => {
        const { settings, store } = migrated()
        store.setSecret('team-key', 'sk-team')
        const next = selectSecretName(settings, 'embeddingApiKey', 'team-key')
        expect(next.searchBackend.apiKey).toBeUndefined()
        expect(resolveEmbeddingApiKey(next, store)).toBe('sk-team')
    })

    it('clearing (logout) blanks this device secret and drops the legacy copy', () => {
        const { settings, store } = migrated()
        const next = clearSecret(settings, store, 'embeddingApiKey')
        expect(store.getSecret(DEFAULT_EMBEDDING_API_KEY_SECRET_NAME)).toBe('')
        expect(next.searchBackend.apiKey).toBeUndefined()
        expect(next.searchBackend.apiKeySecretName).toBe('')
        expect(resolveEmbeddingApiKey(next, store)).toBeUndefined()
        // A reload does not resurrect it.
        expect(migrateLegacySecrets(next, store, daysLater(1)).changed).toBe(false)
        expect(resolveEmbeddingApiKey(next, store)).toBeUndefined()
    })

    it('"Remove plain-text copy now" drops every legacy copy and keeps secrets working', () => {
        const { settings, store } = migrated()
        const next = removeLegacySecretCopies(settings)
        expect(hasLegacySecretCopies(next)).toBe(false)
        expect(resolveBearerToken(next, store)).toBe('tok')
        expect(resolveEmbeddingApiKey(next, store)).toBe('sk')
        expect(removeLegacySecretCopies(next)).toBe(next)
    })

    it('reports grace expiry from the migration stamp', () => {
        const { settings } = migrated()
        expect(legacyGraceExpired(settings, daysLater(59))).toBe(false)
        expect(legacyGraceExpired(settings, daysLater(60))).toBe(true)
        expect(legacyGraceExpired(parsePluginSettings({}), daysLater(600))).toBe(false)
    })
})

describe('ensureBearerTokenSecret', () => {
    const generate = (): string => 'generated-token'

    it('generates and stores a token on a fresh install', () => {
        const store = new FakeSecretStore()
        const { settings, state } = ensureBearerTokenSecret(
            parsePluginSettings(undefined),
            store,
            generate
        )
        expect(state).toBe('generated')
        expect(settings.server.bearerTokenSecretName).toBe(DEFAULT_BEARER_TOKEN_SECRET_NAME)
        expect(store.getSecret(DEFAULT_BEARER_TOKEN_SECRET_NAME)).toBe('generated-token')
        expect(JSON.stringify(settings)).not.toContain('generated-token')
    })

    it('reports present when the named secret exists', () => {
        const store = new FakeSecretStore({ 'my-token': 'tok' })
        const input = legacy({ bearerTokenSecretName: 'my-token' })
        const { settings, state } = ensureBearerTokenSecret(input, store, generate)
        expect(state).toBe('present')
        expect(settings).toBe(input)
    })

    it('never regenerates when the named secret is missing on this device', () => {
        const store = new FakeSecretStore()
        const input = legacy({ bearerTokenSecretName: 'my-token' })
        const { settings, state } = ensureBearerTokenSecret(input, store, generate)
        expect(state).toBe('missing')
        expect(settings).toBe(input)
        expect(store.secrets.size).toBe(0)
        expect(resolveBearerToken(settings, store)).toBe('')
        expect(isSecretMissing(settings, store, 'bearerToken')).toBe(true)
    })

    it('does not generate over a legacy token that could not be migrated', () => {
        const store = new FakeSecretStore()
        const input = legacy({ bearerToken: 'tok' })
        const { state } = ensureBearerTokenSecret(input, store, generate)
        expect(state).toBe('present')
        expect(store.secrets.size).toBe(0)
    })
})

describe('readSecret / storeSecret', () => {
    it('returns null for no name, a missing secret, or a blank value', () => {
        const store = new FakeSecretStore({ blank: ' ', set: 'v' })
        expect(readSecret(store, '')).toBeNull()
        expect(readSecret(store, 'absent')).toBeNull()
        expect(readSecret(store, 'blank')).toBeNull()
        expect(readSecret(store, 'set')).toBe('v')
    })

    it('never throws when the store does', () => {
        const store: SecretStore = {
            getSecret: () => {
                throw new Error('boom')
            },
            setSecret: () => {}
        }
        expect(readSecret(store, 'x')).toBeNull()
    })

    it('fills a blank slot rather than suffixing', () => {
        const store = new FakeSecretStore({ name: '' })
        expect(storeSecret(store, 'name', 'v')).toBe('name')
        expect(store.getSecret('name')).toBe('v')
    })
})
