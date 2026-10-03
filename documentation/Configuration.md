# Configuration

Technical reference for the plugin's settings. The user-facing version is in [`docs/configuration.md`](../docs/configuration.md). The authoritative schema is `src/app/types/plugin-settings.intf.ts` (Zod).

## Settings schema

`parsePluginSettings(raw): PluginSettings` is the single entry point. It never throws: non-object input yields defaults, and each field has a `.catch(default)` so one corrupt value falls back without discarding valid siblings.

| Field                            | Type                    | Default                                         | Notes                                                                               |
| -------------------------------- | ----------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `publisher`                      | string                  | `"obsidian"`                                    | URN publisher segment.                                                              |
| `catalogDisplayName`             | string                  | `"Personal Obsidian Agentic Resource Registry"` | Catalog `host.displayName`.                                                         |
| `catalogIdentifier`              | string?                 | —                                               | Optional `host.identifier` (DID/domain).                                            |
| `skillFolders`                   | string[]                | `[]`                                            | Absolute or vault-relative folders to scan.                                         |
| `watchSkillFolders`              | boolean                 | `false`                                         | Opt-in fs watching of skill folders; debounced rescan on `SKILL.md` change.         |
| `resources`                      | ManualResource[]        | `[]`                                            | Manually configured non-skill entries.                                              |
| `syncProjectMcpConfig`           | boolean                 | `false`                                         | Opt-in: keep `mcpServers.<projectMcpServerName>` in `<vault>/.mcp.json` current.    |
| `projectMcpServerName`           | string                  | `"ard"`                                         | Key of the entry in `.mcp.json`; blank → `ard`.                                     |
| `server.port`                    | int 1024–65535          | `27182`                                         | Listen port.                                                                        |
| `server.bindAddress`             | `"127.0.0.1"` (literal) | `"127.0.0.1"`                                   | Not user-configurable (BR-1).                                                       |
| `server.bearerTokenSecretName`   | string                  | `""` → set on first run                         | SecretStorage name of the bearer token (64 hex chars). Value never in data.json.    |
| `server.bearerToken`             | string?                 | absent                                          | Legacy plaintext (pre-SecretStorage). Read-only per-device bootstrap; see below.    |
| `server.enableCors`              | boolean                 | `true`                                          | `Access-Control-Allow-Origin: *`.                                                   |
| `searchBackend.kind`             | enum                    | `"lexical"`                                     | `lexical` \| `local-model` \| `hosted-api`.                                         |
| `searchBackend.*`                | —                       | —                                               | Embedding server URL/model, or hosted API provider/base URL/model.                  |
| `searchBackend.apiKeySecretName` | string                  | `""`                                            | SecretStorage name of the hosted API key. Legacy plaintext: `searchBackend.apiKey`. |
| `legacySecretMigratedAt`         | ISO string?             | absent                                          | Internal: first legacy-secret migration; plaintext purged 60 days later.            |
| `lastScanStats`                  | object                  | `{0,0}`                                         | Internal: last scan counts + timestamp.                                             |

`ManualResource`: `{ id, enabled, type, slug, displayName, description?, url?, inlineData?, capabilities[], tags[], representativeQueries[] }` where `type` is one of the MCP/A2A/catalog/registry media types.

## Storage

Persisted via Obsidian `saveData`/`loadData` to `.obsidian/plugins/agentic-resource-discovery-server/data.json`. Mutations go through `ArdServerPlugin.updateSettings(draft => …)` (immer), which persists and then reconciles the running registry.

## Secrets (BR-6c)

`settings/secrets.ts`, pure over a `SecretStore` port (`app.secretStorage`: `getSecret`/`setSecret`; no delete API, "" = absent). Default names `agentic-resource-discovery-server-bearer-token`, `agentic-resource-discovery-server-embedding-api-key`.

- **Read at use time:** `RegistryController` takes `RegistrySecrets` getters; `RouterDeps.bearerToken` and `HttpEmbedderConfig.apiKey` are functions called per request. Precedence: SecretStorage → legacy plaintext → none ("" token fails closed). Copy buttons, MCP/curl snippets and `.mcp.json` sync use `plugin.bearerToken()`.
- **Per-device migration** (`migrateLegacySecrets`, every load, idempotent): legacy plaintext present → blank: dropped; no name: stored under the default name (suffix `-2`… rather than overwrite a different secret) and name recorded; name set but absent here: copied in (an existing value wins). Plaintext kept as bootstrap for other synced devices; `legacySecretMigratedAt` stamped once; purged after `LEGACY_SECRET_GRACE_DAYS` (60). A failed `setSecret` keeps the plaintext in use and retries next load.
- **Writes never touch data.json values:** `rotateSecret` (Regenerate), `selectSecretName` (picker), `clearSecret` (API key trash: blanks this device's secret, clears the name) all drop the legacy copy. **Remove plain-text copy now** = `removeLegacySecretCopies`.
- **First run** (`ensureBearerTokenSecret`): generate only when no name and no legacy value. Name set but no value anywhere → `missing`: persistent Notice + settings warning row, never regenerated. Same warning for a missing hosted API key.
- Restart vs rebuild compares `apiKeySecretName`; `.mcp.json` sync compares `bearerTokenSecretName` and is re-run explicitly after Regenerate.

## Reconciliation rules

The registry runs whenever the plugin is loaded; stop it by disabling the plugin in **Settings → Community plugins** (there is no separate in-plugin toggle). On a settings change the plugin decides between **restart** and **rebuild**:

- **Restart** (new server) when `server.port`, `server.bindAddress`, or any `searchBackend.*` field changes, or the server isn't running.
- **Rebuild in place** (swap catalog + reindex, server keeps serving) otherwise.

All registry-mutating operations (start, rescan, reindex, reconcile) are **serialized** through one promise chain so a background scan and a concurrent settings change can't race; an `onunload` `disposed` guard prevents any in-flight op from resurrecting the server after the plugin unloads. Each reconcile also calls `reconcileWatcher()` to start/stop the opt-in `SkillWatcher` to match `watchSkillFolders` + the (resolved) folder list (and surfaces a Notice for folders that can't be watched).

## Project `.mcp.json` sync

`settings/project-mcp-config.ts`. Pure core `mergeProjectMcpConfig(existing | null, name, entry) → content | null` (null = entry already current, compared structurally so a differently formatted file is not rewritten); throws `ProjectMcpConfigError` when the file is not a JSON object or `mcpServers` is not an object. Entry = `buildMcpServerEntry` (`{ type: "http", url: http://127.0.0.1:<port>/mcp, headers.Authorization: "Bearer <token>" }`), shared with **Copy MCP config**. Output: 2-space indent, trailing newline, every other key preserved.

`ProjectMcpConfigSync` does the I/O through `vault.adapter` (`exists`/`read`/`write` on the dotfile), skips an empty token, and notifies once per session on an unmergeable file. The plugin runs it after `coordinator.start()` in `onload` (token already ensured by `ensureBearerToken`) and inside `updateSettings` after reconcile when `projectMcpConfigAffected(previous, next)`: sync on and (just turned on, or port/token/name changed). Port = bound port, else configured port. Turning it off never touches the file (BR-6b).

## Skill folder resolution

Skill-folder inputs use the shared `FolderSuggest` (`settings/components/folder-suggest.ts`) for vault-folder autocomplete, which yields **vault-relative** paths. Since the scanner/watcher use Node `fs` (folders may be outside the vault), `ArdServerPlugin.resolveSkillFolders()` resolves each configured folder to an absolute path before scanning/watching: absolute paths are used as-is, relative paths are joined to `FileSystemAdapter.getBasePath()` (the vault root), and blanks are dropped.

## Environment

- `OBSIDIAN_VAULT_LOCATION` (build-time, optional) — auto-copies `dist/` into a vault after `bun run dev`. See [DEVELOPMENT.md](../DEVELOPMENT.md).
