# Architecture

Technical overview of the plugin.

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
   GET /status                      ─ catalog size + SearchBackend.name/embeddingState (readiness)
   POST /search                     ─ SearchBackend.search() → ARD results
   POST /explore                    ─ facet counts (type/tags/capabilities) over the same set
   GET /agents                      ─ CatalogService.listAll() (paged, filterable)
   GET /skills/<name>/<path>        ─ FsSkillFileService (traversal-safe)
   POST /mcp                        ─ handleMcpMessage() → tools: search/get_skill/execute
                                       └─ execute → QuickJS sandbox over catalog metadata
```

The plugin itself only talks to two objects: `RegistryCoordinator` (what runs when)
and `RegistryController` (what is running).

```
ArdServerPlugin (Obsidian adapter: settings, vault paths, Notices, timers)
   └─ RegistryCoordinator (op mutex, dispose guard, restart-vs-rebuild, watcher)
        ├─ RegistryPort  → RegistryController
        ├─ WatcherPort   → SkillWatcher
        └─ scan()        → scanSkillFolders (incremental via ScanCache)
```

## Module map (`src/app/`)

| Area       | Modules                                                                                                                                                                                                                                                                                                                                                          | Responsibility                                                                                                                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types/`   | `ard.types`, `plugin-settings.intf`, `skills/skill-frontmatter.types`                                                                                                                                                                                                                                                                                            | ARD wire types; Zod-validated settings + `parsePluginSettings`; skill frontmatter shapes.                                                                                                                                                                                     |
| `domain/`  | `urn`                                                                                                                                                                                                                                                                                                                                                            | Build/validate `urn:air:` identifiers.                                                                                                                                                                                                                                        |
| `catalog/` | `catalog-service`, `resource-mapper`                                                                                                                                                                                                                                                                                                                             | In-memory catalog → `ai-catalog.json`; manual resources → entries.                                                                                                                                                                                                            |
| `skills/`  | `skill-parser`, `skill-enricher`, `skill-scanner`, `skill-file-server`, `skill-watcher`                                                                                                                                                                                                                                                                          | Parse frontmatter (js-yaml); enrich → entry (tags, queries, `x-osk-*`); discover/scan folders (incremental: unchanged mtimes are reused via `ScanCache`); serve files; opt-in fs watching (debounced).                                                                        |
| `search/`  | `search-backend` (interface), `lexical-search-backend` (MiniSearch), `semantic-search-backend` (hybrid), `vector-store`, `rrf`, `search-utils` (shared filter/segment helpers), `embedding/embedder` + `embedding/http-embedder` + `embedding/hosted-embedding` + `embedding/embedding-cache` + `embedding/persistent-embedding-cache`, `search-backend-factory` | Pluggable relevance ranking; 0–100 score. Lexical BM25 default; `local-model` and `hosted-api` fuse BM25 + dense-vector cosine (RRF), embeddings from an OpenAI-compatible server (local or hosted) behind an injectable `Embedder` seam, with vectors cached across reloads. |
| `server/`  | `router` (pure), `http-server` (node:http adapter), `registry-controller`, `registry-coordinator` (pure)                                                                                                                                                                                                                                                         | HTTP behaviour; transport; what is running; what runs when. The adapter caps request bodies (5 MB → 413); the router compares the bearer token in constant time.                                                                                                              |
| `mcp/`     | `sandbox` (QuickJS), `registry-shim`, `minisearch-source` (bundle-time macro), `mcp-server` (JSON-RPC + tools)                                                                                                                                                                                                                                                   | Code Mode endpoint; the in-sandbox `registry` API.                                                                                                                                                                                                                            |
| `utils/`   | `token`, `path-safety`, `log`                                                                                                                                                                                                                                                                                                                                    | Bearer token; safe path join; logging.                                                                                                                                                                                                                                        |
| top        | `plugin` (`ArdServerPlugin`), `settings/settings-tab`, `settings/mcp-client-config`, `settings/components/folder-suggest`                                                                                                                                                                                                                                        | Obsidian lifecycle + settings UI; copy-paste client snippets; shared vault-folder autocomplete.                                                                                                                                                                               |

## Key seams

- **`SearchBackend`** — `index(entries)` / `search(req)` / `isReady()`, plus an optional `embeddingState` (`idle`/`building`/`ready`/`failed`) so a supervisor can retry a failed background build without disturbing one in progress. Lexical (default) and the hybrid `SemanticSearchBackend` (used by both `local-model` and `hosted-api`) ship via `search-backend-factory`.
- **`Embedder`** — `load()` / `embed(texts)` / `isReady()`, returns L2-normalised vectors. Injectable: a deterministic fake drives `SemanticSearchBackend`'s unit tests; `HttpEmbedder` calls any OpenAI-compatible `/v1/embeddings` endpoint via `requestUrl` (no CORS) — a local server (`local-model`: Ollama, LM Studio, …) or a hosted API (`hosted-api`: OpenAI/Voyage/Jina/custom, resolved by `hosted-embedding.ts`). Nothing bundled or downloaded; an unreachable/unauthorized server degrades to lexical. `SemanticSearchBackend` builds embeddings in the background and reports `embeddingState`; the plugin retries `failed` builds on a 30s `registerInterval` so a late-starting server recovers automatically.
- **Code Mode sandbox** — `runSandbox` injects the catalog and a `registry` API (`registry-shim.ts`) into a QuickJS isolate. `registry.search` builds a MiniSearch index with the **same configuration and documents as `LexicalSearchBackend`** (the library's own source is inlined at bundle time by the `minisearch-source` macro and evaluated lazily inside the isolate), so in-sandbox ranking matches `POST /search` exactly — verified by a parity spec. No host bridge is opened: the isolate stays network- and filesystem-free.
- **`SkillFileService`** — `manifest(name)` / `file(name, relPath)`. `FsSkillFileService` is the fs implementation; the router depends only on the interface.
- **`RegistryController`** — owns what is running: the catalog, search backend, file service, and HTTP server (`start` / `stop` / `rebuild` / `setSkillEntries` / `reindex`, plus `isRunning` / `port` / `catalogSize` / `embeddingState` for the status panel). The router closes over a mutable `RouterDeps`, so `rebuild()` swaps the catalog and reindexes in place while the server keeps serving.
- **`RegistryCoordinator`** — owns what runs when, with **no `obsidian` import**, so the lifecycle rules are unit-tested (`registry-coordinator.spec.ts`). It drives `RegistryPort` (the controller) and `WatcherPort` (the skill watcher) and receives settings, folder resolution, scanning, and notices as injected callbacks. It holds:
    - **Serialization** — every registry-mutating op (start, rescan, reindex, settings reconcile) goes through one promise chain, so a background skill scan and a concurrent settings change can't race (e.g. both calling `start()` on the same port).
    - **Dispose guard** — `dispose()` (called from `onunload`) stops any queued or in-flight op from resurrecting the server, including a scan that was already running.
    - **`requiresRestart(previous, next)`** — the pure restart-vs-rebuild decision: port, bind address, and any search-backend config field are captured at start, so changing them recreates the server; anything else rebuilds the catalog in place.
    - **Scan cache** — the previous `ScanCache` is kept and fed back in, making every rescan incremental.
- **`EmbeddingCache`** — `get` / `set` / `save(keysInUse)`, keyed by a content hash of the embedded text plus the embedder id and dimensions (so switching model or provider invalidates automatically). `PersistentEmbeddingCache` writes through an injected storage seam; the plugin backs it with `embedding-cache.json` next to the plugin, giving warm restarts without re-embedding.

## Build & test

Bun bundles `src/main.ts` → `dist/main.js` (CJS, node target, `obsidian`/`electron`/CodeMirror external). Tests are `*.spec.ts` (`bun:test`), `obsidian` mocked via `src/test-setup.ts`. `bun run validate` = tsc + tests + lint.
