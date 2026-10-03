import { produce, type Draft } from 'immer'
import { LEGACY_SECRET_GRACE_DAYS, type PluginSettings } from '../types/plugin-settings.intf'

/**
 * Plugin secrets (the server bearer token, the hosted embedding API key) live in
 * Obsidian's SecretStorage, never in data.json: data.json travels with the vault
 * (git, Syncthing, cloud sync), SecretStorage stays on the device. Settings only
 * persist the secret's NAME; values are read at use time and never cached into
 * the settings object.
 *
 * Migration is per device. A legacy plaintext value in data.json is a read-only
 * bootstrap: every device copies it into its own SecretStorage on load, so all
 * synced devices keep working with no action. It is never written again, is
 * removed when the secret is changed or cleared, and is purged
 * {@link LEGACY_SECRET_GRACE_DAYS} days after the first migration (or on demand).
 *
 * Everything here is pure over the {@link SecretStore} port so it is unit-tested
 * without Obsidian.
 */

/** The slice of Obsidian's `SecretStorage` this plugin uses (`app.secretStorage`). */
export interface SecretStore {
    /** `null` (or "" once cleared: there is no delete API) when absent. */
    getSecret(id: string): string | null
    /** @throws when the id is not lowercase alphanumeric with dashes */
    setSecret(id: string, secret: string): void
}

/** Default SecretStorage name of the server bearer token (`<plugin-id>-<what>`). */
export const DEFAULT_BEARER_TOKEN_SECRET_NAME = 'agentic-resource-discovery-server-bearer-token'

/** Default SecretStorage name of the hosted embedding API key. */
export const DEFAULT_EMBEDDING_API_KEY_SECRET_NAME =
    'agentic-resource-discovery-server-embedding-api-key'

/** The plugin's secrets. */
export type SecretField = 'bearerToken' | 'embeddingApiKey'

interface SecretFieldAccess {
    /** Settings path of the legacy plaintext field (for logs). */
    legacyPath: string
    defaultName: string
    name: (settings: PluginSettings) => string
    setName: (draft: Draft<PluginSettings>, name: string) => void
    legacy: (settings: PluginSettings) => string | undefined
    deleteLegacy: (draft: Draft<PluginSettings>) => void
}

const FIELDS: Record<SecretField, SecretFieldAccess> = {
    bearerToken: {
        legacyPath: 'server.bearerToken',
        defaultName: DEFAULT_BEARER_TOKEN_SECRET_NAME,
        name: (s) => s.server.bearerTokenSecretName.trim(),
        setName: (d, name) => {
            d.server.bearerTokenSecretName = name
        },
        legacy: (s) => s.server.bearerToken,
        deleteLegacy: (d) => {
            delete d.server.bearerToken
        }
    },
    embeddingApiKey: {
        legacyPath: 'searchBackend.apiKey',
        defaultName: DEFAULT_EMBEDDING_API_KEY_SECRET_NAME,
        name: (s) => s.searchBackend.apiKeySecretName.trim(),
        setName: (d, name) => {
            d.searchBackend.apiKeySecretName = name
        },
        legacy: (s) => s.searchBackend.apiKey,
        deleteLegacy: (d) => {
            delete d.searchBackend.apiKey
        }
    }
}

const SECRET_FIELDS: readonly SecretField[] = ['bearerToken', 'embeddingApiKey']

const DAY_MS = 24 * 60 * 60 * 1000

/** Bound on `-N` suffixes tried by {@link storeSecret}. */
const MAX_NAME_ATTEMPTS = 100

/**
 * Value of the named secret, or `null` when no name is configured, the secret
 * does not exist on this device, or it is blank (cleared). Never throws.
 */
export function readSecret(store: SecretStore, name: string): string | null {
    const id = name.trim()
    if (id.length === 0) {
        return null
    }
    try {
        return nonBlank(store.getSecret(id) ?? undefined)
    } catch {
        return null
    }
}

/**
 * Value of a plugin secret in effect: this device's SecretStorage, else the
 * legacy plaintext bootstrap still in data.json, else `null`.
 */
export function resolveSecret(
    settings: PluginSettings,
    store: SecretStore,
    field: SecretField
): string | null {
    const access = FIELDS[field]
    return readSecret(store, access.name(settings)) ?? nonBlank(access.legacy(settings))
}

/** Bearer token in effect, or "" (the router then refuses every authenticated request). */
export function resolveBearerToken(settings: PluginSettings, store: SecretStore): string {
    return resolveSecret(settings, store, 'bearerToken') ?? ''
}

/** Hosted embedding API key in effect, if any. */
export function resolveEmbeddingApiKey(
    settings: PluginSettings,
    store: SecretStore
): string | undefined {
    return resolveSecret(settings, store, 'embeddingApiKey') ?? undefined
}

/**
 * Store `value` under `preferred` (or a free `-2`, `-3`, … suffix of it) without
 * overwriting a different existing secret. Reuses a name that already holds the
 * same value. Returns the name used.
 */
export function storeSecret(store: SecretStore, preferred: string, value: string): string {
    for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
        const name = attempt === 1 ? preferred : `${preferred}-${attempt}`
        const existing = store.getSecret(name)
        if (existing === value) {
            return name
        }
        if (existing === null || existing.length === 0) {
            store.setSecret(name, value)
            return name
        }
    }
    throw new Error(`No free secret name for ${preferred}`)
}

export interface SecretMigrationResult {
    settings: PluginSettings
    /** Whether settings changed and must be persisted. */
    changed: boolean
    /** Legacy fields whose copy into SecretStorage failed (still used as fallback). */
    failed: string[]
}

/**
 * Per-device migration, run on every load. Idempotent.
 *
 * For each legacy plaintext secret in data.json:
 * - blank → removed;
 * - no secret name yet → stored under the default name (suffixed rather than
 *   overwriting a different secret) and the name recorded;
 * - name set but this device's SecretStorage lacks it → copied in (a value
 *   already there wins: it is newer than the legacy copy).
 *
 * The plaintext is kept (other synced devices bootstrap from it) and
 * `legacySecretMigratedAt` is stamped on the first migration. Once
 * {@link LEGACY_SECRET_GRACE_DAYS} days have passed since then, the plaintext is
 * purged.
 */
export function migrateLegacySecrets(
    settings: PluginSettings,
    store: SecretStore,
    now: Date = new Date()
): SecretMigrationResult {
    const failed: string[] = []
    let migrated = false
    let next = settings

    for (const field of SECRET_FIELDS) {
        const access = FIELDS[field]
        const raw = access.legacy(next)
        if (raw === undefined) {
            continue
        }
        const legacy = nonBlank(raw)
        if (legacy === null) {
            next = produce(next, (draft) => access.deleteLegacy(draft))
            continue
        }
        try {
            const name = access.name(next)
            if (name.length === 0) {
                const stored = storeSecret(store, access.defaultName, legacy)
                next = produce(next, (draft) => access.setName(draft, stored))
            } else if (readSecret(store, name) === null) {
                store.setSecret(name, legacy)
            }
            migrated = true
        } catch {
            failed.push(access.legacyPath)
        }
    }

    if (migrated && next.legacySecretMigratedAt === undefined) {
        next = produce(next, (draft) => {
            draft.legacySecretMigratedAt = now.toISOString()
        })
    }

    if (failed.length === 0 && legacyGraceExpired(next, now)) {
        next = removeLegacySecretCopies(next)
    }

    return { settings: next, changed: next !== settings, failed }
}

/** Whether the legacy plaintext grace period is over. */
export function legacyGraceExpired(settings: PluginSettings, now: Date = new Date()): boolean {
    const since = settings.legacySecretMigratedAt
    if (since === undefined) {
        return false
    }
    const start = Date.parse(since)
    return Number.isFinite(start) && now.getTime() - start >= LEGACY_SECRET_GRACE_DAYS * DAY_MS
}

/** Whether data.json still carries a legacy plaintext secret. */
export function hasLegacySecretCopies(settings: PluginSettings): boolean {
    return SECRET_FIELDS.some((field) => FIELDS[field].legacy(settings) !== undefined)
}

/**
 * Drop every legacy plaintext secret from settings (grace period over, or the
 * "Remove plain-text copy now" button). Returns the same object when none remain.
 */
export function removeLegacySecretCopies(settings: PluginSettings): PluginSettings {
    if (!hasLegacySecretCopies(settings)) {
        return settings
    }
    return produce(settings, (draft) => {
        for (const field of SECRET_FIELDS) FIELDS[field].deleteLegacy(draft)
    })
}

/**
 * Set a new value for a secret (rotation, re-entry): written to SecretStorage
 * only, under the configured name (or a free default one), and the now-stale
 * legacy plaintext is removed. Persist the returned settings.
 */
export function rotateSecret(
    settings: PluginSettings,
    store: SecretStore,
    field: SecretField,
    value: string
): PluginSettings {
    const access = FIELDS[field]
    let name = access.name(settings)
    if (name.length > 0) {
        store.setSecret(name, value)
    } else {
        name = storeSecret(store, access.defaultName, value)
    }
    return produce(settings, (draft) => {
        access.setName(draft, name)
        access.deleteLegacy(draft)
    })
}

/**
 * The user picked another SecretStorage entry for a secret: record the name and
 * drop the legacy plaintext (it no longer applies).
 */
export function selectSecretName(
    settings: PluginSettings,
    field: SecretField,
    name: string
): PluginSettings {
    const access = FIELDS[field]
    return produce(settings, (draft) => {
        access.setName(draft, name.trim())
        access.deleteLegacy(draft)
    })
}

/**
 * Clear a secret (logout / "clear key"): blank this device's SecretStorage entry
 * (there is no delete API; "" reads as absent), forget the name and drop the
 * legacy plaintext. Like the old behaviour, clearing applies to every device.
 */
export function clearSecret(
    settings: PluginSettings,
    store: SecretStore,
    field: SecretField
): PluginSettings {
    const access = FIELDS[field]
    const name = access.name(settings)
    if (name.length > 0) {
        store.setSecret(name, '')
    }
    return produce(settings, (draft) => {
        access.setName(draft, '')
        access.deleteLegacy(draft)
    })
}

export type BearerTokenState =
    /** Fresh install: a token was generated and stored; persist the settings. */
    | 'generated'
    /** A token is available on this device (SecretStorage or legacy bootstrap). */
    | 'present'
    /**
     * A name is configured but neither this device's SecretStorage nor the
     * legacy plaintext has a value. Never regenerated: that would break clients.
     */
    | 'missing'

/**
 * Ensure the server has a bearer token. Generates one only on a fresh install
 * (no secret name and no legacy plaintext token), storing it in SecretStorage.
 * Run after {@link migrateLegacySecrets}.
 */
export function ensureBearerTokenSecret(
    settings: PluginSettings,
    store: SecretStore,
    generate: () => string
): { settings: PluginSettings; state: BearerTokenState } {
    if (resolveSecret(settings, store, 'bearerToken') !== null) {
        return { settings, state: 'present' }
    }
    if (FIELDS.bearerToken.name(settings).length > 0) {
        return { settings, state: 'missing' }
    }
    const stored = storeSecret(store, DEFAULT_BEARER_TOKEN_SECRET_NAME, generate())
    return {
        settings: produce(settings, (draft) => {
            draft.server.bearerTokenSecretName = stored
        }),
        state: 'generated'
    }
}

/**
 * Whether a configured secret has no value on this device (neither in
 * SecretStorage nor as a legacy bootstrap): the user must set it here.
 */
export function isSecretMissing(
    settings: PluginSettings,
    store: SecretStore,
    field: SecretField
): boolean {
    return FIELDS[field].name(settings).length > 0 && resolveSecret(settings, store, field) === null
}

const nonBlank = (value: string | undefined): string | null =>
    typeof value === 'string' && value.trim().length > 0 ? value : null
