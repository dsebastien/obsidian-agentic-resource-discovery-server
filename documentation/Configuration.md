# Configuration

Technical reference for the plugin's settings. The user-facing version is in [`docs/configuration.md`](../docs/configuration.md). The authoritative schema is `src/app/types/plugin-settings.intf.ts` (Zod).

## Settings schema

`parsePluginSettings(raw): PluginSettings` is the single entry point. It never throws: non-object input yields defaults, and each field has a `.catch(default)` so one corrupt value falls back without discarding valid siblings.

| Field                | Type                    | Default                                         | Notes                                                                              |
| -------------------- | ----------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `enabled`            | boolean                 | `true`                                          | Master switch; when false the registry is stopped.                                 |
| `publisher`          | string                  | `"obsidian"`                                    | URN publisher segment.                                                             |
| `catalogDisplayName` | string                  | `"Personal Obsidian Agentic Resource Registry"` | Catalog `host.displayName`.                                                        |
| `catalogIdentifier`  | string?                 | —                                               | Optional `host.identifier` (DID/domain).                                           |
| `skillFolders`       | string[]                | `[]`                                            | Absolute or vault-relative folders to scan.                                        |
| `autoRescanOnChange` | boolean                 | `true`                                          | Reserved for file-watching (deferred).                                             |
| `resources`          | ManualResource[]        | `[]`                                            | Manually configured non-skill entries.                                             |
| `server.port`        | int 1024–65535          | `27182`                                         | Listen port.                                                                       |
| `server.bindAddress` | `"127.0.0.1"` (literal) | `"127.0.0.1"`                                   | Not user-configurable (BR-1).                                                      |
| `server.bearerToken` | string                  | `""` → generated                                | 64 hex chars once generated.                                                       |
| `server.enableCors`  | boolean                 | `true`                                          | `Access-Control-Allow-Origin: *`.                                                  |
| `searchBackend.kind` | enum                    | `"lexical"`                                     | `lexical` \| `local-model` \| `qmd-sidecar` \| `hosted-api` (last three deferred). |
| `searchBackend.*`    | —                       | —                                               | Model id, qmd path, API provider/key for future backends.                          |
| `lastScanStats`      | object                  | `{0,0}`                                         | Internal: last scan counts + timestamp.                                            |

`ManualResource`: `{ id, enabled, type, slug, displayName, description?, url?, inlineData?, capabilities[], tags[], representativeQueries[] }` where `type` is one of the MCP/A2A/catalog/registry media types.

## Storage

Persisted via Obsidian `saveData`/`loadData` to `.obsidian/plugins/agentic-resource-discovery-server/data.json`. Mutations go through `ArdServerPlugin.updateSettings(draft => …)` (immer), which persists and then reconciles the running registry.

## Reconciliation rules

On a settings change the plugin decides between **restart** and **rebuild**:

- **Restart** (new server) when `server.port`, `server.bindAddress`, or `searchBackend.kind` changes, or the server isn't running.
- **Rebuild in place** (swap catalog + reindex, server keeps serving) otherwise.
- **Stop** when `enabled` becomes false.

## Environment

- `OBSIDIAN_VAULT_LOCATION` (build-time, optional) — auto-copies `dist/` into a vault after `bun run dev`. See [DEVELOPMENT.md](../DEVELOPMENT.md).
