import { z } from 'zod'

/**
 * Plugin settings.
 *
 * The single public entry point is {@link parsePluginSettings}: it takes
 * whatever Obsidian's `loadData()` returns (which may be `undefined`, a partial
 * object from an older version, or corrupt) and always yields a complete,
 * valid {@link PluginSettings}. Validation, defaulting, and forward-migration
 * all live behind that one call — callers never touch Zod.
 *
 * Field-level `.catch(...)` keeps corruption local: one malformed field falls
 * back to its default without discarding valid sibling fields.
 */

/** IANA media types we can expose as catalog entries for manually-added resources. */
export const MANUAL_RESOURCE_TYPES = [
    'application/mcp-server-card+json',
    'application/a2a-agent-card+json',
    'application/ai-catalog+json',
    'application/ai-registry+json'
] as const

export const ManualResourceSchema = z.object({
    /** Internal stable id (UUID). */
    id: z.string(),
    enabled: z.boolean().default(true).catch(true),
    type: z.enum(MANUAL_RESOURCE_TYPES).default('application/mcp-server-card+json'),
    /** Terminal URN segment, e.g. urn:air:obsidian:mcp:<slug>. */
    slug: z.string(),
    displayName: z.string(),
    description: z.string().optional(),
    /** Remote URL of the artifact (mutually exclusive with inlineData). */
    url: z.string().optional(),
    /** Inline artifact document (mutually exclusive with url). */
    inlineData: z.record(z.string(), z.unknown()).optional(),
    capabilities: z.array(z.string()).default([]).catch([]),
    tags: z.array(z.string()).default([]).catch([]),
    representativeQueries: z.array(z.string()).max(5).default([]).catch([])
})

export type ManualResource = z.infer<typeof ManualResourceSchema>

/** Which search backend powers the registry `POST /search` ranking. */
export const SEARCH_BACKEND_KINDS = ['lexical', 'local-model', 'qmd-sidecar', 'hosted-api'] as const

/**
 * Hosted embedding providers for the `hosted-api` backend. All speak the
 * OpenAI-compatible `/v1/embeddings` shape; `custom` points at any other
 * compatible gateway via an explicit base URL.
 */
export const HOSTED_EMBEDDING_PROVIDERS = ['openai', 'voyage', 'jina', 'custom'] as const

export const SearchBackendConfigSchema = z.object({
    kind: z.enum(SEARCH_BACKEND_KINDS).default('lexical').catch('lexical'),
    // local-model options: an OpenAI-compatible embedding server (Ollama, LM
    // Studio, llama.cpp, LocalAI, …) the user already runs. Nothing is bundled
    // or downloaded by the plugin.
    embeddingServerUrl: z
        .string()
        .default('http://localhost:11434/v1')
        .catch('http://localhost:11434/v1'),
    embeddingModel: z.string().default('nomic-embed-text').catch('nomic-embed-text'),
    // qmd-sidecar options
    qmdExecutable: z.string().default('qmd').catch('qmd'),
    qmdIndexPath: z.string().optional(),
    // hosted-api options: a remote OpenAI-compatible embedding API (BYO key).
    apiProvider: z.enum(HOSTED_EMBEDDING_PROVIDERS).default('openai').catch('openai'),
    apiBaseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    apiModel: z.string().optional(),
    enableHybrid: z.boolean().default(false).catch(false)
})

export type SearchBackendConfig = z.infer<typeof SearchBackendConfigSchema>

export const ServerSettingsSchema = z.object({
    port: z.number().int().min(1024).max(65535).default(27182).catch(27182),
    /**
     * Hard security invariant: the registry only ever binds to loopback. Any
     * other value (e.g. an attempt to expose it on the LAN) resets to 127.0.0.1.
     */
    bindAddress: z.literal('127.0.0.1').default('127.0.0.1').catch('127.0.0.1'),
    /** "" until generated on first run. */
    bearerToken: z.string().default('').catch(''),
    enableCors: z.boolean().default(true).catch(true)
})

export type ServerSettings = z.infer<typeof ServerSettingsSchema>

export const LastScanStatsSchema = z.object({
    skillCount: z.number().default(0).catch(0),
    errorCount: z.number().default(0).catch(0),
    lastScanAt: z.string().optional()
})

export const PluginSettingsSchema = z.object({
    enabled: z.boolean().default(true).catch(true),
    // Catalog identity
    publisher: z.string().default('obsidian').catch('obsidian'),
    catalogDisplayName: z
        .string()
        .default('Personal Obsidian Agentic Resource Registry')
        .catch('Personal Obsidian Agentic Resource Registry'),
    catalogIdentifier: z.string().optional(),
    // Skill scanning
    skillFolders: z.array(z.string()).default([]).catch([]),
    /** Opt-in filesystem watching of skill folders (off by default; best-effort). */
    watchSkillFolders: z.boolean().default(false).catch(false),
    // Manually-configured resources
    resources: z.array(ManualResourceSchema).default([]).catch([]),
    // Server + search
    server: ServerSettingsSchema.default(() => ServerSettingsSchema.parse({})).catch(() =>
        ServerSettingsSchema.parse({})
    ),
    searchBackend: SearchBackendConfigSchema.default(() =>
        SearchBackendConfigSchema.parse({})
    ).catch(() => SearchBackendConfigSchema.parse({})),
    // Internal, not user-editable
    lastScanStats: LastScanStatsSchema.default(() => LastScanStatsSchema.parse({})).catch(() =>
        LastScanStatsSchema.parse({})
    )
})

export type PluginSettings = z.infer<typeof PluginSettingsSchema>

/** The canonical default settings (first-run state). */
export const DEFAULT_SETTINGS: PluginSettings = PluginSettingsSchema.parse({})

/**
 * Turn whatever was persisted into a complete, valid settings object. Never
 * throws: non-object input yields the defaults, and individual malformed fields
 * fall back to their defaults while valid fields are preserved.
 */
export const parsePluginSettings = (raw: unknown): PluginSettings => {
    const result = PluginSettingsSchema.safeParse(raw)
    return result.success ? result.data : DEFAULT_SETTINGS
}
