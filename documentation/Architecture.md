# Architecture

Technical overview of the plugin. For the full design and milestone history see [`plans/implementation-plan.md`](plans/implementation-plan.md).

## What it is

A local-first **ARD (Agentic Resource Discovery) publisher + Agent Registry** running inside Obsidian. It scans AI Skills into a catalog and serves that catalog (REST + MCP) on `127.0.0.1` so local agents can search and fetch resources. `isDesktopOnly` — it needs Node's `http` server and `fs`.

## Design tenets

1. **Deep modules behind small interfaces.** Each subsystem exposes a minimal interface and is tested through it (the codebase-design discipline).
2. **The router is pure; the socket is an adapter.** All request behaviour is a pure `RegistryRequest → RegistryResponse` function (`server/router.ts`), unit-tested without sockets. `server/http-server.ts` is a thin `node:http` adapter over it.
3. **Test-first, verified on real data.** Every module was built red→green; the scanner/enricher were verified against the real ~395-skill vault.
4. **No mandatory downloads.** Default search is in-process BM25; the MCP transport is hand-rolled JSON-RPC (no heavy SDK). The one bundled binary is the QuickJS WASM sandbox (inlined).

## Data flow

```
settings (skill folders, resources)
   │
   ▼  scanSkillFolders (chunked, non-blocking)            manualResourcesToEntries
   │      parse SKILL.md → enrich → CatalogEntry[]            settings.resources → CatalogEntry[]
   └──────────────────────┬──────────────────────────────────────────┘
                          ▼
                 RegistryController
                   ├─ CatalogService.replaceEntries(skills + manual)
                   ├─ SearchBackend.index(entries)
                   └─ ArdHttpServer.start(port)  ── createRouter(deps) ──┐
                                                                         ▼
   GET /.well-known/ai-catalog.json ─ CatalogService.toCatalog()
   POST /search                     ─ SearchBackend.search() → ARD results
   GET /agents                      ─ CatalogService.listAll() (paged)
   GET /skills/<name>/<path>        ─ FsSkillFileService (traversal-safe)
   POST /mcp                        ─ handleMcpMessage() → tools: search/get_skill/execute
                                       └─ execute → QuickJS sandbox over catalog metadata
```

## Module map (`src/app/`)

| Area       | Modules                                                                                       | Responsibility                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `types/`   | `ard.types`, `plugin-settings.intf`, `skills/skill-frontmatter.types`                         | ARD wire types; Zod-validated settings + `parsePluginSettings`; skill frontmatter shapes.                                                   |
| `domain/`  | `urn`                                                                                         | Build/validate `urn:air:` identifiers.                                                                                                      |
| `catalog/` | `catalog-service`, `resource-mapper`                                                          | In-memory catalog → `ai-catalog.json`; manual resources → entries.                                                                          |
| `skills/`  | `skill-parser`, `skill-enricher`, `skill-scanner`, `skill-file-server`, `skill-watcher`       | Parse frontmatter (js-yaml); enrich → entry (tags, queries, `x-osk-*`); discover/scan folders; serve files; opt-in fs watching (debounced). |
| `search/`  | `search-backend` (interface), `lexical-search-backend` (MiniSearch), `search-backend-factory` | Pluggable relevance ranking; 0–100 score.                                                                                                   |
| `server/`  | `router` (pure), `http-server` (node:http adapter), `registry-controller`                     | HTTP behaviour; transport; lifecycle orchestration.                                                                                         |
| `mcp/`     | `sandbox` (QuickJS), `mcp-server` (JSON-RPC + tools)                                          | Code Mode endpoint.                                                                                                                         |
| `utils/`   | `token`, `path-safety`, `log`                                                                 | Bearer token; safe path join; logging.                                                                                                      |
| top        | `plugin` (`ArdServerPlugin`), `settings/settings-tab`, `settings/components/folder-suggest`   | Obsidian lifecycle + settings UI; shared vault-folder autocomplete.                                                                         |

## Key seams

- **`SearchBackend`** — `index(entries)` / `search(req)` / `isReady()`. Lexical today; vector/qmd/hosted are drop-ins (`search-backend-factory`).
- **`SkillFileService`** — `manifest(name)` / `file(name, relPath)`. `FsSkillFileService` is the fs implementation; the router depends only on the interface.
- **`RegistryController`** — the only seam the plugin drives (`start` / `stop` / `rebuild` / `setSkillEntries`). It owns the catalog, search backend, file service, and HTTP server. The router closes over a mutable `RouterDeps`, so `rebuild()` swaps the catalog and reindexes in place while the server keeps serving.

## Build & test

Bun bundles `src/main.ts` → `dist/main.js` (CJS, node target, `obsidian`/`electron`/CodeMirror external). Tests are `*.spec.ts` (`bun:test`), `obsidian` mocked via `src/test-setup.ts`. `bun run validate` = tsc + tests + lint.
