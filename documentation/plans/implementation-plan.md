# obsidian-agentic-resource-discovery-server: Implementation Plan

**Status:** Living — M0–M6 implemented (2026-06-23). See §1a for the current milestone table; sections below the status block are the original design and are superseded where §1a says so.  
**Author:** Synthesis agent + implementation notes  
**Target repo:** `/home/sebastien/wks/obsidian-agentic-resource-discovery-server`  
**Template base:** `/home/sebastien/wks/obsidian-plugin-template`

## 1. Summary

This document is the authoritative engineering plan for the `obsidian-agentic-resource-discovery-server` Obsidian plugin. The plugin turns an Obsidian vault into a **local-first ARD (Agentic Resource Discovery) publisher and Agent Registry**. It scans configured skill folders (Anthropic Agent Skills format), enriches each skill's SKILL.md frontmatter into a structured `ai-catalog.json` manifest, and runs a localhost HTTP server that exposes the ARD REST registry API plus an MCP endpoint using the Code Mode pattern. The result is that any AI agent on the same machine can discover and invoke the user's personal library of 395+ Claude skills without those skills ever leaving the local machine. The plugin is `isDesktopOnly: true`, requires no cloud services by default, and is designed to add zero mandatory model-download friction: the default search backend is a pure in-process BM25 index (MiniSearch, ~7 kB gzipped). Heavier semantic backends are opt-in. ARD v1 conformance target is the mandatory "Discoverable" level (specVersion, entries, POST /search with federation param, CORS). "Trusted" conformance (JWS signing, SPIFFE/DID identity, provenance) is explicitly deferred.

---

## 1a. Implementation Status

_Living section — updated after each milestone. Built test-first (Matt Pocock `tdd` / `codebase-design` skills); each milestone ends green on `bun run validate` (tsc + tests + lint) and `bun run build`._

| Milestone                                              | Status               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** — Scaffold + settings skeleton                  | ✅ Done (2026-06-23) | Template materialized + initialized (`isDesktopOnly: true`), classes renamed, init tooling removed. Settings (Zod, safe parse, loopback invariant), URN + token modules, 5-section settings tab. Published to `origin/main`.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **M1** — HTTP server + static catalog + lexical search | ✅ Done (2026-06-23) | Pure router + thin node:http adapter, `RegistryController` seam, `CatalogService`, MiniSearch `LexicalSearchBackend`, manual-resource→entry mapper, wired into the plugin lifecycle. Endpoints: `GET /.well-known/ai-catalog.json`, `POST /search`, `GET /agents` (paginated), `POST /explore`→501, `GET /health`. 97 tests.                                                                                                                                                                                                                                                                                                                              |
| **M2** — Skill scanning + enrichment                   | ✅ Done (2026-06-23) | `skill-parser` (js-yaml), `skill-enricher` (tags + representativeQueries heuristics + `x-osk-*`), `skill-scanner` (recursive discovery, chunked, injectable scheduler). Wired into the plugin (`onLayoutReady` scan + "Rescan skills now" button). **Verified on the real 395-skill vault: 395 scanned, 0 errors.** 122 tests.                                                                                                                                                                                                                                                                                                                            |
| **M3** — Skill file serving                            | ✅ Done (2026-06-23) | `utils/path-safety` (safeJoin), `skills/skill-file-server` (`FsSkillFileService`: manifest + file serving, extension allowlist, traversal-safe), router `GET /skills/<name>` + `/skills/<name>/<path>` (binary-capable responses), wired through `RegistryController`. Verified e2e on real data: search → fetch SKILL.md (200, text/markdown). 140 tests. **Auto file-watching deferred to M6** (manual "Rescan" + startup scan cover it; skills often live on a FUSE mount where fs.watch is unreliable).                                                                                                                                               |
| **M4** — MCP Code Mode endpoint                        | ✅ Done (2026-06-23) | `mcp/sandbox` (QuickJS WASM Code Mode sandbox: injected catalog + `registry` API, timeout/memory caps, no host access) + `mcp/mcp-server` (lean JSON-RPC 2.0: `initialize`/`tools/list`/`tools/call`; tools `search`/`get_skill`/`execute`), mounted at `POST /mcp`. **Hand-rolled JSON-RPC instead of `@modelcontextprotocol/sdk`** (avoids the heavy SDK + SSE transport; keeps the bundle lean). 158 tests; bundle 1.6 MB (QuickJS WASM inlined).                                                                                                                                                                                                      |
| **M5** — Pluggable backend factory                     | ✅ Done (2026-06-23) | `search/search-backend-factory` (`createSearchBackend`) wired into `RegistryController`; a backend-config change restarts the registry. **Hybrid semantic search now built & tested** (post-v1): `local-model` → `SemanticSearchBackend` (lexical BM25 ⊕ dense-vector cosine via RRF) behind an injectable `Embedder` seam (`VectorStore`, `rrf.ts`). The embedder is `HttpEmbedder` — it calls a **local OpenAI-compatible embedding server the user already runs** (Ollama, LM Studio, …) via Obsidian `requestUrl`, so **nothing is bundled or downloaded by the plugin** (bundle stays 1.65 MB; the original Transformers.js/ONNX path was dropped to honor the zero-download non-goal). Two-phase indexing — lexical serves instantly, embeddings build in the background; degrades to lexical if the server is unreachable. `hosted-api` (OpenAI/Voyage/Jina/custom, BYO key — `hosted-embedding.ts`) now ships too. (A qmd-sidecar backend was explored and **dropped** — its BM25 mode duplicated the built-in lexical backend and its hybrid mode was heavy/fragile and overlapped the embedding backends; the `qmd-sidecar` kind was removed entirely.) **Auto-retry**: `embeddingState` (`idle`/`building`/`ready`/`failed`) drives a 30 s `registerInterval` in the plugin that re-attempts `failed` builds (never interrupting a `building` one), so a late-starting embedding server recovers on its own. **Verified live (2026-06-23) against the real 397-skill vault + Ollama `nomic-embed-text`**: 397 entries embedded (768-dim), hybrid fusion returns strong semantic matches (e.g. "capture ideas before I forget them" → the `osk-ideas-*` skills), `pageSize`/tag filters work, stopped server → lexical (HTTP 200), dead-endpoint → `failed → building → ready` recovery with no manual reindex, and `hosted-api` via the custom→Ollama route. On CPU-only Ollama the initial embed of 397 entries takes ~50–60 s; search serves lexical until it completes. Empty-catalog indexing skips the embedder entirely. 204 tests.                                                                                                          |
| **M6** — Hardening + docs                              | ✅ Done (2026-06-23) | EADDRINUSE retry (3×500ms). Full docs (README, `docs/` guide, `documentation/` technical, `AGENTS.md`). **Opt-in file watching** added (`skills/skill-watcher`, off by default, debounced, injected fs-watch/timers; best-effort on FUSE mounts). **Real MCP-client e2e passed** — official `@modelcontextprotocol/sdk@1.29.0` `Client` + `StreamableHTTPClientTransport` connects to `/mcp` and calls `search`/`get_skill`/`execute` (run from an isolated project; the SDK can't load in-repo because the repo pins `ajv@6` via overrides, conflicting with the SDK's `ajv-formats`). Remaining post-v1: MCP session TTL. 166 tests. |

### Design refinements adopted during implementation

These supersede the original prose where they differ (the original plan stays below as rationale):

1. **Server = pure router + thin transport adapter.** Instead of an OO `ArdHttpServer` with embedded handlers (`server/handlers/*`), the request logic is a pure function `createRouter(deps): (RegistryRequest) => Promise<RegistryResponse>` in `server/router.ts`, fully unit-tested without sockets. `server/http-server.ts` is a ~60-line node:http adapter that maps `IncomingMessage`→`RegistryRequest` and writes the response. This is the codebase-design "test through the interface, not past it" principle.
2. **`RegistryController` seam** (`server/registry-controller.ts`) owns catalog + search backend + HTTP server as one unit. The plugin drives only `start/stop/rebuild(settings)` and never sees routers or sockets. The router closes over a mutable `RouterDeps`, so `rebuild()` swaps the catalog and reindexes in place while the server keeps serving (used for settings changes and, later, rescans).
3. **Simplified `SearchBackend` interface.** Dropped the separate `CatalogIndexEntry` projection (YAGNI — one shape). The interface is `index(entries: CatalogEntry[])` + `search(req): Promise<SearchResult[]>` + `isReady()`; each backend derives its own internal index representation from plain `CatalogEntry`. See §8.1 (updated).
4. **Manual-resource mapping is its own module** (`catalog/resource-mapper.ts`): `manualResourcesToEntries(resources, publisher)` namespaces each media type (`mcp`/`agents`/`catalogs`/`registries`), enforces exactly-one `url|data`, and skips incomplete/disabled entries. Skill entries (M2) will be a sibling mapper feeding the same `CatalogService`.
5. **Catalog Content-Type is `application/json`** (per the ARD "AI Catalog" note), not `application/ai-catalog+json`; the latter is the conceptual media type.
6. **Settings are validated, never trusted.** `parsePluginSettings` (Zod, per-field `.catch`) hardens against corrupt persisted data; the bind address is a literal `127.0.0.1` that resets on tampering.
7. **Frontmatter parsing uses `js-yaml`, not `gray-matter`.** gray-matter@4 calls `yaml.safeLoad`, removed in js-yaml@4 — which this repo pins via `overrides`. So `skill-parser.ts` splits the `---` fence itself and uses `js-yaml`'s safe `load`. (M2)
8. **Frontmatter values are untrusted and coerced.** YAML turns unquoted timestamps into `Date` objects (and yields numbers/booleans), so the enricher routes every field through an `asString`/`asStringArray` coercion before string ops. Found by verifying on the real corpus — 22/395 skills initially errored on `Date.slice`; now 395/395 scan clean. (M2)
9. **Non-blocking scan via an injected scheduler.** `scanSkillFolders(roots, ctx, { scheduler })` yields between chunks; the plugin injects a `window.setTimeout` yielder (UI-friendly, satisfies the obsidianmd lint rule) while tests inject a no-op. Keeps the scanner pure-testable in Bun. (M2)
10. **Opt-in file watching via injected primitives.** `skills/skill-watcher.ts` debounces `SKILL.md` changes into one rescan; the `fs.watch` primitive and timers are injected so the debounce/filter logic is deterministic in tests. Setting `watchSkillFolders` (default OFF). Best-effort on FUSE/cloud mounts. (post-M6)
11. **Folder picker + path resolution.** Skill-folder inputs reuse the author's shared `FolderSuggest` (`settings/components/folder-suggest.ts`, vault-folder autocomplete). Because the suggester yields vault-relative paths but the scanner uses Node `fs`, the plugin resolves each configured folder to absolute before scanning/watching — absolute as-is, relative joined to `FileSystemAdapter.getBasePath()` (`plugin.resolveSkillFolders()`). (post-M6)

## 1b. Handoff — picking up the remaining work

Everything M0–M6 is implemented, tested (168 specs), documented, and on `origin/main`. The plugin runs end-to-end and was verified against the real 395-skill vault and the official MCP SDK client. The **"Reindex" button** follow-up is now done (`RegistryController.reindex()` / `plugin.reindex()` + a button in the Search backend settings section). What's left is **post-v1, all optional**, none blocking use:

| Follow-up                                           | Where                                                                                                             | Notes / recipe                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~**Semantic search — live smoke test**~~ ✅ done | `search/embedding/http-embedder.ts` | **Verified live (2026-06-23)** against the real 397-skill vault + Ollama `nomic-embed-text`: embeddings build (397×768-dim), hybrid fusion ranks well, filters/`pageSize` work, stopped-server → lexical fallback (200). Note: CPU-only Ollama embeds the full catalog in ~50–60 s (search serves lexical meanwhile); a GPU or smaller model is faster. Driven via `bun run dev` (hot-reload into the vault) + the `obsidian` CLI (`plugin:reload`, `eval`, `dev:errors`). |
| ~~**Embedding auto-retry**~~ ✅ done | `search/semantic-search-backend.ts`, `server/registry-controller.ts`, `plugin.ts` | `SemanticSearchBackend` now exposes `embeddingState` (`idle`/`building`/`ready`/`failed`); `RegistryController.embeddingsNeedRetry` surfaces `failed`; the plugin retries on a 30 s `registerInterval` (only when `failed`, never interrupting a `building` pass). **Verified live**: `failed → building → ready` after a dead endpoint was fixed, with no manual reindex. |
| ~~**Hosted-api backend**~~ ✅ done | `search/embedding/hosted-embedding.ts`, `search-backend-factory.ts` | `hosted-api` → `SemanticSearchBackend(HttpEmbedder(...))` with the endpoint/model/key resolved by `resolveHostedEmbedderConfig` (providers: openai/voyage/jina/custom; all OpenAI-compatible `/v1/embeddings`). Settings UI: provider dropdown + (custom) base URL + model + password-masked key. **Verified live** via the `custom` provider pointed at local Ollama (building→ready, fused results). Privacy: queries + skill metadata are sent to the provider; bodies are not. |
| ~~**qmd sidecar backend**~~ ❌ dropped | — | Explored, then removed by decision: qmd's BM25 mode duplicated the built-in lexical backend, and its hybrid mode was heavy/fragile (needs qmd's own model; GPU-OOM'd in testing) and overlapped the embedding backends. The `qmd-sidecar` kind + its settings fields were deleted. The §8.4 / §11 design sections below are historical only. |
| **MCP session TTL**                                 | `mcp/mcp-server.ts`                                                                                               | The handler is stateless today (no leak). If session state is added later, expire idle sessions.                                                                                                                                                                                                                                         |
| ~~**Trusted conformance**~~ ❌ won't do | — | Per decision: not implementing JWS signing / SPIFFE-DID identity / provenance. Low value for a local-first, loopback, single-user setup. |
| **Real-domain publishing + federation**             | —                                                                                                                 | Out of scope for local-first; §18.                                                                                                                                                                                                                                                                                                       |

**Before starting:** read §1a (status + refinements 1–11 supersede the prose below), `documentation/Architecture.md` (module map + seams), and `documentation/Business Rules.md` (BR-1…15 are mandatory). **Working rhythm:** TDD red→green per module (`bun test <file>`), verify on the real vault where relevant, finish green on `bun run validate` + `bun run build`, update this §1a + the relevant `docs/`/`documentation/` pages, and commit per unit (conventional commits, scopes `all`/`build`/`deps`/`docs`/`plugin`). See the `AGENTS.md` project section for lint gotchas. The MCP SDK can't be imported in-repo (the repo pins `ajv@6`); run the client e2e from an isolated project (two processes).

---

## 2. Background

### 2.1 ARD: Agentic Resource Discovery

ARD (spec `v0.9 Draft`, `github.com/ards-project/ard-spec`, rendered at `agenticresourcediscovery.org/spec`) is a lightweight open protocol for publishing and discovering agentic resources — skills, MCP servers, A2A agents, and nested catalogs. It has two surfaces:

**Static catalog.** A JSON document (`ai-catalog.json`) served at `/.well-known/ai-catalog.json`. Top-level shape: `{ specVersion: "1.0", host?: HostInfo, entries: CatalogEntry[] }`. Each entry has a URN identifier (`urn:air:<publisher>:<segments>`), a `displayName`, an IANA `type`, exactly one of `url | data`, and optional `description`, `tags`, `capabilities`, `representativeQueries` (2–5 NL query examples), `version`, `updatedAt`, and `trustManifest`.

**Dynamic registry.** REST endpoints that search the catalog:

- `POST /search` — required; NL text query + filter → ranked results each with `score` (0–100 relevance only, not trust)
- `POST /explore` — optional faceting (respond 501 if unsupported)
- `GET /agents` — optional deterministic listing

A registry is itself discoverable via an entry of type `application/ai-registry+json` in the static catalog.

**URN naming.** The canonical NID is `urn:air:` (ADR-0009; the HuggingFace live implementation still uses `urn:ai:` due to transition lag). The `<publisher>` segment is supposed to be a valid FQDN. For local-first use the spec endorses `agent.localhost` as a placeholder (`urn:air:agent.localhost:skills:<name>`). This plugin defaults to `urn:air:obsidian:skills:<name>` (configurable to a real domain).

**Conformance levels (per project context; not formal taxonomy in v0.9 prose):**

- _Discoverable_ — static catalog + POST /search: this plugin's v1 target
- _Trusted_ — trustManifest + JWS signing + SPIFFE/DID/HTTPS identity: future work

### 2.2 This Plugin

The plugin wires together five subsystems inside a single Obsidian plugin process (desktop-only, Electron renderer with full Node.js access):

1. **Skill scanner** — finds SKILL.md files in user-configured folders, parses YAML frontmatter, enriches metadata deterministically (no LLM calls), builds `CatalogEntry` objects.
2. **Catalog builder** — assembles `AiCatalog` from scanned skills + manually configured resources (MCP server cards, A2A agents, nested catalogs).
3. **Search backend** — pluggable; default is MiniSearch BM25+ in-process (zero download); optional: Transformers.js ONNX local model (~23 MB), qmd sidecar (full pipeline), hosted embedding API (BYOK).
4. **HTTP server** — Node.js `http.createServer`, binds to `127.0.0.1:<configuredPort>`, bearer-token auth on all routes except `/.well-known/ai-catalog.json`, serves the catalog and registry API.
5. **MCP endpoint** — Code Mode pattern mounted at `/mcp` on the same HTTP server; exposes `search`, `get_skill`, and `execute` tools; uses `quickjs-emscripten` for sandboxed code execution.

---

## 3. Goals and Non-Goals

### v1 Goals

- Parse 395+ SKILL.md files at startup in the background without blocking Obsidian load.
- Derive `displayName`, `description`, `tags`, `capabilities`, `representativeQueries` from frontmatter alone (deterministic heuristics, no LLM required).
- Serve `/.well-known/ai-catalog.json` with `specVersion: "1.0"` and all scanned entries.
- Implement `POST /search` with `query.text`, `query.filter`, `federation` param, and ARD 0–100 `score` field.
- Serve stable URLs for SKILL.md and bundled asset files (`GET /skills/<name>/<path>`).
- Bearer-token auth (generated on first run, shown in settings) on all endpoints except the static catalog.
- Pluggable search backend with lexical BM25 as the zero-friction default.
- MCP endpoint at `/mcp` (Streamable HTTP, JSON-only mode) with three tools: `search`, `get_skill`, `execute`.
- Code Mode `execute` tool with `quickjs-emscripten` sandbox (10 s timeout, 64 MB memory cap).
- Settings UI: skill folder list, manual resource list, server port/token, search backend selector.
- Settings persist via `immer` + Obsidian `loadData`/`saveData`, type-safe with Zod validation.
- Incremental re-scan on SKILL.md change via Obsidian vault events.
- `GET /explore` responds 501 (optional facets not implemented in v1).
- `GET /agents` responds with paginated listing (optional but simple to implement).
- `isDesktopOnly: true`, bind address `127.0.0.1`, CORS `Access-Control-Allow-Origin: *`.

### v1 Non-Goals (explicitly deferred)

| Deferred feature                                                                                      | Reason                                                                          |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Trusted conformance** (TrustManifest, JWS signature, SPIFFE/DID identity, attestations, provenance) | Requires PKI infrastructure; no user demand for v1                              |
| **Real-domain publishing** (HTTPS, RFC 8615 `.well-known`, DNS SVCB, robots.txt)                      | Localhost only in v1                                                            |
| **Federation** (`POST /search?federation=auto` referral chaining)                                     | Requires crawling external registries                                           |
| **HuggingFace Discover interop**                                                                      | Depends on real-domain publishing                                               |
| **Semantic vector search** (Transformers.js ONNX)                                                     | Implemented as opt-in backend; not the default                                  |
| **qmd sidecar backend**                                                                               | Documented and architecturally supported; requires user to install qmd globally |
| **Hosted embedding API**                                                                              | BYOK, opt-in                                                                    |
| **`POST /explore` facets**                                                                            | Returns 501; implementation is straightforward to add in v2                     |
| **OpenAPI tool entries**                                                                              | Settings form stub; enrichment from spec auto-extraction deferred               |
| **Mobile support**                                                                                    | `isDesktopOnly: true` enforced                                                  |
| **TypeScript transpilation in sandbox**                                                               | QuickJS runs JavaScript; model should write plain JS                            |

---

## 4. High-Level Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Obsidian Process (Electron)                       │
│                                                                          │
│  ┌──────────────────────┐    ┌─────────────────────────────────────────┐│
│  │   ArdServerPlugin    │    │       Settings UI (PluginSettingTab)    ││
│  │  (Plugin subclass)   │◄──►│  skill folders, resources, port, token  ││
│  │  onload / onunload   │    │  backend selector, scan status          ││
│  └──────────┬───────────┘    └─────────────────────────────────────────┘│
│             │                                                            │
│     ┌───────┴────────────────────────────────────────────┐              │
│     │                 Service Orchestrator               │              │
│     └─┬──────────┬──────────────┬──────────────┬────────┘              │
│        │          │              │              │                        │
│  ┌─────▼──┐ ┌─────▼────┐ ┌──────▼─────┐ ┌────▼─────┐                 │
│  │ Skill   │ │ Catalog  │ │  Search    │ │   HTTP   │                 │
│  │ Scanner │ │ Builder  │ │  Backend   │ │  Server  │                 │
│  │         │ │          │ │ (pluggable)│ │(node:http│                 │
│  │ fs.read │ │AiCatalog │ │            │ │127.0.0.1)│                 │
│  │ gray-   │ │ JSON     │ │ LexicalSB  │ └────┬─────┘                 │
│  │ matter  │ │ build    │ │ (default)  │      │                        │
│  │ derive  │ │          │ │ LocalModel │      │  Routes:               │
│  │ tags,RQ │ │          │ │ QMDSidecar │      │  GET /.well-known/     │
│  └─────────┘ └──────────┘ │ HostedAPI  │      │    ai-catalog.json     │
│        │          │        └──────┬─────┘      │  POST /search          │
│        └──────────┘               │            │  POST /explore (501)   │
│                 catalog entries   │            │  GET /agents           │
│                 ──────────────►   │            │  GET /skills/<n>/<f>   │
│                 index(entries)    │            │  POST /mcp             │
│                                   │            └──────┬─────────────────┘
│                                   │                   │                 │
│                              search(req)        ┌─────▼──────┐         │
│                              ◄──────────────────┤ MCP Server │         │
│                                                 │ (SDK v1.29)│         │
│                                                 │ 3 tools:   │         │
│                                                 │ search     │         │
│                                                 │ get_skill  │         │
│                                                 │ execute    │         │
│                                                 │ (QuickJS   │         │
│                                                 │  sandbox)  │         │
│                                                 └────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
                    │ localhost:<port>
                    ▼
        AI agents, MCP clients, browsers
```

### Data Flow

```
User configures skill folders in Settings
       │
       ▼
onload → loadSettings → server.start()
       │
       └─ app.workspace.onLayoutReady(() => {
              skillScanner.scanAll()                   // async, non-blocking
                  │
                  ├─ discover skill folders (readdir)
                  ├─ parse SKILL.md frontmatter (gray-matter, 4 KB read/file)
                  ├─ derive displayName, tags, capabilities, representativeQueries
                  │
                  └─ → catalog.rebuild(entries)
                             │
                             └─ → searchBackend.index(entries)   // async
          })
       │
       ▼
HTTP server handles incoming requests:
  GET /.well-known/ai-catalog.json
      → catalog.toJSON()  (synchronous, always ready)

  POST /search
      → parse body, validate with Zod
      → searchBackend.search(req)         // BM25 or vector, returns BackendSearchResult[]
      → map to ARD SearchResultItem[]     // add score, source fields
      → 200 JSON

  GET /skills/<name>/SKILL.md
      → path-traversal check → fs.readFile → 200 text/markdown

  POST /mcp
      → bearer auth → MCP SDK transport → buildMcpServer()
            → tool: search → searchBackend.search()
            → tool: get_skill → catalog.getEntry()
            → tool: execute → CodeModeSandbox.run(code)
```

---

## 5. Data Model

### 5.1 ARD Types (canonical, from spec schema)

```typescript
// src/app/types/ard.types.ts

/** ai-catalog.json top level. additionalProperties: false in spec JSON Schema. */
export interface AiCatalog {
    specVersion: '1.0'
    host?: HostInfo
    entries: CatalogEntry[]
}

export interface HostInfo {
    displayName: string
    identifier?: string // DID ("did:web:...") or plain domain ("dsebastien.net")
    documentationUrl?: string // format: uri
    logoUrl?: string // format: uri
    trustManifest?: TrustManifest
}

/**
 * One entry in the catalog. Exactly ONE of url | data must be present (oneOf in JSON Schema).
 * No additionalProperties constraint at entry level — extension fields (x-*) are tolerated.
 */
export interface CatalogEntry {
    identifier: string // urn:air:<publisher>(:<segment>)+ — regex: ^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$
    displayName: string
    type: string // IANA media type string (see ArdMediaType enum below)
    url?: string // format: uri — EXACTLY ONE of url | data
    data?: Record<string, unknown>
    description?: string
    tags?: string[]
    capabilities?: string[] // explicit skill/tool names e.g. ["developassion.analytics.report"]
    representativeQueries?: string[] // JSON Schema: minItems: 2, maxItems: 5
    version?: string
    updatedAt?: string // ISO 8601 date-time
    /** Restricted: values must be string | number | boolean | null — no nested objects */
    metadata?: Record<string, string | number | boolean | null>
    trustManifest?: TrustManifest
    // Extension fields (non-standard, tolerated by spec, ignored by conformance tool):
    [key: `x-${string}`]: unknown
}

export enum ArdMediaType {
    AiSkill = 'application/ai-skill',
    McpServerCard = 'application/mcp-server-card+json',
    A2aAgentCard = 'application/a2a-agent-card+json',
    AiCatalog = 'application/ai-catalog+json',
    AiRegistry = 'application/ai-registry+json',
    AiSkillMarkdown = 'application/ai-skill+md'
}

/** Stub for future Trusted conformance phase. Required fields: identity. */
export interface TrustManifest {
    identity: string // SPIFFE ID, DID URI, or HTTPS FQDN URI
    identityType?: 'spiffe' | 'did' | 'https' | 'other'
    trustSchema?: TrustSchema
    attestations?: Attestation[]
    provenance?: ProvenanceLink[]
    signature?: string // detached JWS over trustManifest content
}

export interface Attestation {
    type: string
    uri: string
    mediaType: string // required in JSON Schema (despite prose omission)
    digest?: string
}

export interface ProvenanceLink {
    relation: 'derivedFrom' | 'publishedFrom' | 'copiedFrom'
    sourceId: string
    sourceDigest?: string
}

export interface TrustSchema {
    identifier: string
    version: string
    governanceUri?: string
    verificationMethods?: string[]
}

// ===== Registry REST API shapes =====

export type FilterObject = Record<string, string | string[]>

export interface ArdSearchRequest {
    query: { text: string; filter?: FilterObject }
    federation?: 'auto' | 'referrals' | 'none'
    pageSize?: number
    pageToken?: string
}

export interface ArdSearchResponse {
    results: SearchResultItem[]
    referrals?: RegistryReferral[]
    pageToken?: string
}

export interface SearchResultItem extends CatalogEntry {
    score: number // 0–100, relevance only
    source: string // registry base URL (our localhost URL)
}

export interface RegistryReferral {
    identifier: string
    displayName: string
    type: 'application/ai-registry' | 'application/ai-registry+json'
    url: string
}

export interface ArdListResponse {
    items: CatalogEntry[]
    total?: number
    pageToken?: string
}

export interface ArdErrorResponse {
    errorCode: string
    message: string
}
```

### 5.2 Plugin Settings Types

```typescript
// src/app/types/plugin-settings.intf.ts

import { z } from 'zod'

// ---- Individual resource settings ----

export const ManualResourceSchema = z.object({
    id: z.string(), // internal UUID
    enabled: z.boolean().default(true),
    type: z.enum([
        'application/mcp-server-card+json',
        'application/a2a-agent-card+json',
        'application/ai-catalog+json',
        'application/ai-registry+json'
    ]),
    slug: z.string(), // becomes URN terminal segment
    displayName: z.string(),
    description: z.string().optional(),
    url: z.string().url().optional(), // remote URL for the artifact
    inlineData: z.record(z.unknown()).optional(), // for data: entries
    capabilities: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    representativeQueries: z.array(z.string()).min(0).max(5).default([])
})

export type ManualResource = z.infer<typeof ManualResourceSchema>

// ---- Search backend settings ----

export type SearchBackendKind = 'lexical' | 'local-model' | 'qmd-sidecar' | 'hosted-api'

export const SearchBackendConfigSchema = z.object({
    kind: z.enum(['lexical', 'local-model', 'qmd-sidecar', 'hosted-api']).default('lexical'),
    // local-model options:
    modelId: z.string().default('Xenova/all-MiniLM-L6-v2'),
    modelCacheDir: z.string().optional(),
    // qmd-sidecar options:
    qmdExecutable: z.string().default('qmd'),
    qmdDaemonPort: z.number().int().optional(),
    qmdIndexPath: z.string().optional(),
    // hosted-api options:
    apiProvider: z.enum(['openai', 'voyage', 'cohere', 'jina']).optional(),
    apiKey: z.string().optional(),
    apiModel: z.string().optional(),
    // hybrid BM25+vector:
    enableHybrid: z.boolean().default(false)
})

export type SearchBackendConfig = z.infer<typeof SearchBackendConfigSchema>

// ---- Server settings ----

export const ServerSettingsSchema = z.object({
    port: z.number().int().min(1024).max(65535).default(27182),
    bindAddress: z.literal('127.0.0.1').default('127.0.0.1'),
    bearerToken: z.string().default(''), // "" = not yet generated
    enableCors: z.boolean().default(true)
})

export type ServerSettings = z.infer<typeof ServerSettingsSchema>

// ---- Top-level plugin settings ----

export const PluginSettingsSchema = z.object({
    enabled: z.boolean().default(true),
    // Catalog identity
    publisher: z.string().default('obsidian'), // URN publisher segment (should be FQDN ideally)
    catalogDisplayName: z.string().default('Personal Obsidian Skill Registry'),
    catalogIdentifier: z.string().optional(), // DID or domain for host.identifier
    // Skill scanning
    skillFolders: z.array(z.string()).default([]),
    autoRescanOnChange: z.boolean().default(true),
    // Manual resources
    resources: z.array(ManualResourceSchema).default([]),
    // Server
    server: ServerSettingsSchema.default({}),
    // Search
    searchBackend: SearchBackendConfigSchema.default({}),
    // Internal: last scan stats (not user-editable)
    lastScanStats: z
        .object({
            skillCount: z.number().default(0),
            errorCount: z.number().default(0),
            lastScanAt: z.string().optional()
        })
        .default({})
})

export type PluginSettings = z.infer<typeof PluginSettingsSchema>

export const DEFAULT_SETTINGS: PluginSettings = PluginSettingsSchema.parse({})
```

### 5.3 Internal Catalog Store Types

```typescript
// src/app/catalog/types.ts

import type { CatalogEntry } from '../types/ard.types'

/** Internal extended entry that carries non-ARD fields for search and skill serving */
export interface InternalEntry extends CatalogEntry {
    /** Absolute FS path to the skill folder, or null for manual resources */
    _fsPath: string | null
    /** Bundled files relative to _fsPath */
    _bundleFiles: string[]
    /** Internal: from 'x-osk-user-invocable' extension field */
    _userInvocable: boolean
}

/** The in-memory catalog store (rebuilt on scan) */
export interface CatalogStore {
    entries: Map<string, InternalEntry> // keyed by identifier URN
    buildTimestamp: number
    publisher: string
    baseUrl: string // e.g. "http://127.0.0.1:27182"
}
```

---

## 6. Settings and UI

### 6.1 Full Settings Schema (Zod)

Defined in Section 5.2. Key default values:

| Setting              | Default      | Notes                                                         |
| -------------------- | ------------ | ------------------------------------------------------------- |
| `publisher`          | `"obsidian"` | Non-FQDN; acceptable for local-first                          |
| `server.port`        | `27182`      | e (Euler's constant × 10000, memorable)                       |
| `server.bearerToken` | `""`         | Generated on first load via `randomBytes(32).toString('hex')` |
| `searchBackend.kind` | `"lexical"`  | MiniSearch BM25+; zero download                               |
| `skillFolders`       | `[]`         | User must configure                                           |
| `autoRescanOnChange` | `true`       | Vault event watching                                          |

### 6.2 Settings Tab Structure

The settings tab class is `ArdServerSettingTab extends PluginSettingTab`. Its `display()` method renders five sections in order. No method names may collide with `PluginSettingTab` base names (`update`, `display`, `hide`, `icon`, `settingItems`); use `renderXSection` / `updateSetting` as prefixes.

**Helper pattern (from obsidian-cli-rest, settings-tab.ts lines 310–314):**

```typescript
private async updateSetting(updater: (draft: Draft<PluginSettings>) => void): Promise<void> {
  this.plugin.settings = produce(this.plugin.settings, updater);
  await this.plugin.saveSettings();
}
```

**Section 1 — Server**

```
┌─ Server ──────────────────────────────────────────────────────┐
│  Port        [27182              ]                            │
│  Status      ● Running on 127.0.0.1:27182  [Stop] [Start]   │
│  Bearer token [••••••••••••••••••] [Copy] [Regenerate]       │
│  Publisher   [obsidian           ]  (tip: use FQDN for spec) │
│  Catalog name[Personal Obsidian …]                           │
└───────────────────────────────────────────────────────────────┘
```

Port validation: integer, 1024–65535. Bearer token: `setDisabled(true)` text field in monospace font + Copy button + Regenerate button (regenerate calls `randomBytes(32).toString('hex')`, re-renders via `this.display()`). Status line is updated dynamically from `this.plugin.httpServer.isRunning`.

**Section 2 — Skill Folders**

```
┌─ Skill folders ───────────────────────────────────────────────┐
│  /c/users/.../skills  [Remove]                                │
│  [text input with AbstractInputSuggest for vault paths]  [+]  │
│  Last scan: 395 skills, 2 errors, 2026-06-23T14:30:00Z        │
│  [Rebuild catalog now]                                        │
└───────────────────────────────────────────────────────────────┘
```

Folder list: each entry is a `Setting` with a text input (autocomplete via `AbstractInputSuggest` for vault-relative paths; external absolute paths typed manually) and a `setIcon('trash')` remove button. "Add folder" button appends an empty string to the array, re-renders. Scan status line reads `settings.lastScanStats`. "Rebuild catalog" triggers `plugin.skillScanner.scanAll()`.

**Section 3 — Additional Resources**

```
┌─ Additional resources ────────────────────────────────────────┐
│  [Add MCP server card] [Add A2A agent card]                   │
│  [Add nested catalog]  [Add registry entry]                   │
│                                                               │
│  ▼ MCP: my-mcp-server                              [Remove]  │
│    Display name: My MCP Server                               │
│    URL: http://localhost:8080/server-card.json               │
│    Capabilities (CSV): tool1, tool2                          │
│    Representative queries (one per line):                    │
│    [textarea]                                                │
└───────────────────────────────────────────────────────────────┘
```

Each resource renders as a collapsible sub-section (using `containerEl.createEl('details')` / `summary`). Type selector is a `Setting.addDropdown`.

**Section 4 — Search Backend**

```
┌─ Search backend ──────────────────────────────────────────────┐
│  Backend  [BM25 lexical (built-in) ▼]                        │
│                                                               │
│  (if local-model selected:)                                   │
│  Model    [Xenova/all-MiniLM-L6-v2]                          │
│  Cache dir [<plugin data dir>       ]                         │
│  Status   ● Model not downloaded yet  [Download now]         │
│                                                               │
│  (if qmd-sidecar selected:)                                   │
│  qmd path [qmd                      ]  [Check availability]  │
│  Index path[<vault>/.obsidian/...   ]                         │
│  Status   ● qmd not found in PATH                            │
│                                                               │
│  (if hosted-api selected:)                                    │
│  Provider [OpenAI ▼]  Model [text-embedding-3-small]         │
│  API key  [••••••••••••••••••]  ⚠ stored in plugin data       │
└───────────────────────────────────────────────────────────────┘
```

Backend dropdown triggers `this.display()` on change to show the relevant sub-form. Notice banners (`Notice` from `obsidian`) warn on first-run download requirements.

**Section 5 — Support / Author**

Reuse the template's buy-me-a-coffee and follow button (optional; keep or remove).

---

## 7. Skill Scanning and Enrichment Pipeline

### 7.1 Non-Blocking Startup

```typescript
// src/app/plugin.ts
override async onload(): Promise<void> {
  await this.loadSettings();
  if (settings.server.bearerToken === "") {
    // generate on first run
    this.settings = produce(this.settings, d => {
      d.server.bearerToken = randomBytes(32).toString('hex');
    });
    await this.saveSettings();
  }
  this.addSettingTab(new ArdServerSettingTab(this.app, this));
  await this.httpServer.start(settings.server.port);

  this.app.workspace.onLayoutReady(() => {
    void this.skillScanner.scanAll();          // non-blocking
    this.registerVaultWatchers();
  });

  this.register(() => this.httpServer.stop()); // cleanup on unload
}
```

`onLayoutReady` defers the scan until all plugins have loaded and vault events have settled, preventing the vault `create` event flood on initial load.

### 7.2 Frontmatter Parsing

Use `gray-matter` for YAML+Markdown frontmatter parsing. Read only the first 4 KB of each file to extract the frontmatter block (skills average ~2 KB frontmatter):

```typescript
import matter from 'gray-matter'
import { open } from 'node:fs/promises'

async function parseFrontmatter(skillMdPath: string): Promise<SkillFrontmatter | null> {
    const fd = await open(skillMdPath)
    const buf = Buffer.alloc(4096)
    const { bytesRead } = await fd.read(buf, 0, 4096)
    await fd.close()
    const head = buf.slice(0, bytesRead).toString('utf-8')
    const endFm = head.indexOf('\n---', 3)
    const fmSlice = endFm > 0 ? head.slice(0, endFm + 4) : head
    try {
        const { data } = matter(fmSlice)
        return data as SkillFrontmatter
    } catch (e) {
        return null // log + increment errorCount
    }
}
```

After frontmatter, extract the H1 title (first `# ` line in the body) for `displayName`:

```typescript
async function extractH1Title(skillMdPath: string): Promise<string | null> {
    // Read up to 8 KB for H1 after frontmatter
    const fd = await open(skillMdPath)
    const buf = Buffer.alloc(8192)
    const { bytesRead } = await fd.read(buf, 0, 8192)
    await fd.close()
    const content = buf.slice(0, bytesRead).toString('utf-8')
    const match = content.match(/^# (.+)$/m)
    if (!match) return null
    // Strip parentheticals like "(Polymorphic)", "(v2)"
    return match[1].replace(/\s*\([^)]*\)\s*/g, '').trim()
}
```

### 7.3 SKILL.md → CatalogEntry Field Mapping

| ARD Field               | Source                              | Algorithm                                                                                                                      |
| ----------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `identifier`            | `fm.name`                           | `urn:air:${settings.publisher}:skills:${fm.name}`                                                                              |
| `displayName`           | H1 body title, else `fm.name`       | Prefer H1 (stripped of parentheticals); fallback: kebab-to-TitleCase (`developassion-analytics` → `"DeveloPassion Analytics"`) |
| `type`                  | constant                            | `"application/ai-skill"`                                                                                                       |
| `url`                   | `fm.name` + `baseUrl`               | `${baseUrl}/skills/${fm.name}/SKILL.md`                                                                                        |
| `description`           | `fm.description` + `fm.when_to_use` | Concatenate with ". " separator; truncate combined to 1024 chars                                                               |
| `tags`                  | multi-source                        | See Section 7.4                                                                                                                |
| `capabilities`          | `fm.metadata.capability`            | Single-element array: `[fm.metadata.capability]`                                                                               |
| `representativeQueries` | heuristic                           | See Section 7.5                                                                                                                |
| `version`               | `fm.metadata.updated`               | Date portion of ISO string: `"2026-04-15"`. Fallback: file mtime.                                                              |
| `updatedAt`             | `fm.metadata.updated`               | Full ISO 8601 + `Z` suffix (spec: format date-time). Fallback: file mtime `.toISOString()`.                                    |
| `x-osk-dependencies`    | `fm.metadata.dependencies`          | Array of skill folder names (non-standard extension field)                                                                     |
| `x-osk-kind`            | `fm.metadata.kind`                  | `"analyzer"` \| `"generator"` \| etc.                                                                                          |
| `x-osk-tier`            | `fm.metadata.tier`                  | `"primitive"` \| `"workflow"` \| `"ritual"`                                                                                    |
| `x-osk-effects`         | `fm.metadata.effects`               | `"read-only"` \| `"write-vault"` \| `"external"` \| `"destructive"`                                                            |
| `x-osk-effort`          | `fm.effort`                         | `"low"` \| `"medium"` \| `"high"` \| `"xhigh"` \| `"max"`                                                                      |
| `x-osk-model`           | `fm.model`                          | Model ID string                                                                                                                |
| `x-osk-argument-hint`   | `fm['argument-hint']`               | Raw CLI hint string or null                                                                                                    |
| `x-osk-user-invocable`  | `fm['user-invocable']`              | Default `true`; `false` → tagged `"internal"`                                                                                  |
| `x-osk-bundle-files`    | FS listing                          | Array of relative paths from skill folder root                                                                                 |

**Not mapped to ARD standard fields:** `effort`, `model`, `allowed-tools`, `context` (fork), `disable-model-invocation`, `metadata.composes`, `metadata.note-types`, `metadata.refresh-tool`. These are stored as `x-osk-*` extension fields for MCP Code Mode use and internal search ranking.

**Important constraint:** ARD `representativeQueries` requires `minItems: 2`. If the heuristic produces fewer than 2 queries (possible for context/barrel skills), omit the field entirely rather than violating the constraint.

### 7.4 Tag Derivation Algorithm

```typescript
function deriveTags(fm: SkillFrontmatter): string[] {
    const tags = new Set<string>()
    const parts = fm.name.split('-')

    // 1. Namespace (first segment)
    tags.add(`ns:${parts[0]}`)

    // 2. Category (second segment, if present)
    if (parts.length >= 2) tags.add(`category:${parts[1]}`)

    // 3. Kind, tier, effects
    tags.add(`kind:${fm.metadata.kind}`)
    tags.add(`tier:${fm.metadata.tier}`)
    tags.add(`effects:${fm.metadata.effects}`)

    // 4. Capability domain (first dot-segment of capability string)
    const capDomain = fm.metadata.capability.split('.')[0]
    tags.add(`domain:${capDomain}`)

    // 5. Note types
    for (const nt of fm.metadata['note-types'] ?? []) {
        tags.add(`note-type:${nt}`)
    }

    // 6. Invocability
    const isInternal = fm['user-invocable'] === false || fm['disable-model-invocation'] === true
    tags.add(isInternal ? 'internal' : 'user-invocable')

    // 7. Subagent execution
    if (fm.context === 'fork') tags.add('runs-as-subagent')

    // 8. Tool family tags (from allowed-tools string)
    const allowedTools = fm['allowed-tools'] ?? ''
    if (/WebFetch|WebSearch/.test(allowedTools)) tags.add('uses-web')
    if (/\bBash\b/.test(allowedTools)) tags.add('uses-bash')
    if (/mcp__qmd/.test(allowedTools)) tags.add('uses-qmd')
    if (/\b(Write|Edit)\b/.test(allowedTools)) tags.add('writes-files')

    return [...tags].sort()
}
```

### 7.5 `representativeQueries` Heuristic Algorithm

The algorithm produces 2–5 NL query examples from frontmatter alone. Outputs must be plausible user utterances, not internal identifiers.

```typescript
function deriveRepresentativeQueries(fm: SkillFrontmatter): string[] | undefined {
    const queries: string[] = []
    const humanName = extractH1TitleSync(fm) ?? toTitleCase(fm.name)
    const desc = fm.description ?? ''
    const hint = fm['argument-hint'] ?? ''
    const when = fm.when_to_use ?? ''
    const cap = fm.metadata.capability ?? ''
    const kind = fm.metadata.kind ?? ''

    // Template 1: verb clause from description (always attempted)
    const firstClause = desc.split(/[.!?]/)[0]?.trim()
    if (firstClause && firstClause.length > 5) {
        queries.push(simplify(firstClause))
    }

    // Template 2: argument-hint modes (if polymorphic)
    // Match {option1|option2|...} patterns
    const braceMatch = hint.match(/\{([^}]+)\}/)
    if (braceMatch) {
        const modes = braceMatch[1].split('|').slice(0, 2)
        for (const mode of modes) {
            queries.push(`${humanName} for ${mode}`)
        }
    }

    // Template 3: first trigger phrase from when_to_use
    if (when) {
        const triggerMatch = when.match(/"([^"]+)"/)
        const phrase = triggerMatch
            ? triggerMatch[1]
            : when
                  .split(/[,;]/)[0]
                  ?.replace(/^(Use when (the user )?(asks?|wants?) (about |to )?)/i, '')
                  .trim()
        if (phrase && phrase.length > 3) {
            queries.push(`Show me ${phrase}`)
        }
    }

    // Template 4: capability verb → human query
    const capParts = cap.split('.')
    const verb = capParts[capParts.length - 1] ?? ''
    const verbMap: Record<string, string> = {
        create: 'Create',
        write: 'Write',
        analyze: 'Analyze',
        run: 'Run',
        report: 'Generate report for',
        activate: 'Activate',
        rank: 'Rank',
        review: 'Review',
        publish: 'Publish',
        validate: 'Validate',
        transform: 'Transform with',
        fetch: 'Fetch using'
    }
    const verbPrefix = verbMap[verb] ?? verb.charAt(0).toUpperCase() + verb.slice(1)
    if (verbPrefix) queries.push(`${verbPrefix} ${humanName}`)

    // Template 5: kind-based generic
    const kindTemplates: Record<string, string> = {
        analyzer: `Analyze using ${humanName}`,
        generator: `Generate ${humanName} output`,
        transformer: `Transform content with ${humanName}`,
        validator: `Validate with ${humanName}`,
        effect: `Run ${humanName}`,
        orchestrator: `Orchestrate ${humanName} workflow`,
        context: `Load ${humanName} context`
    }
    if (kindTemplates[kind] && queries.length < 5) {
        queries.push(kindTemplates[kind])
    }

    // Dedup and enforce 2-5 range
    const unique = [...new Set(queries)].slice(0, 5)
    return unique.length >= 2 ? unique : undefined // omit if < 2 (ARD minItems constraint)
}
```

### 7.6 Chunked Scan (Non-Blocking)

```typescript
// src/app/skills/skill-scanner.ts

const CHUNK_SIZE = 20 // files per event-loop yield

async function scanAll(roots: string[]): Promise<ScanResult> {
    const allFolders = await discoverSkillFolders(roots)
    let skillCount = 0,
        errorCount = 0
    const entries: InternalEntry[] = []

    for (let i = 0; i < allFolders.length; i += CHUNK_SIZE) {
        const chunk = allFolders.slice(i, i + CHUNK_SIZE)
        const results = await Promise.all(chunk.map((f) => parseSkillFolder(f)))
        for (const r of results) {
            if (r) {
                entries.push(r)
                skillCount++
            } else errorCount++
        }
        // Yield to event loop between chunks — MUST use window.setTimeout (Obsidian lint rule)
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    }

    return { entries, skillCount, errorCount }
}
```

`window.setTimeout` (not bare `setTimeout`) is required by `AGENTS.md` line 457–459 to satisfy the `eslint-plugin-obsidianmd` rule. Timer handles must be typed as `number`.

### 7.7 Incremental Re-scan and File Watching

**Inside vault:** Register Obsidian vault events inside `onLayoutReady`:

```typescript
this.registerEvent(
    this.app.vault.on('modify', async (file) => {
        if (file.name === 'SKILL.md' && isInSkillRoot(file.path)) {
            await this.debouncedRescankSkill(file.parent!.name)
        }
    })
)
// Similarly for 'create' and 'delete'
```

**Outside vault (external folders):** Use `fs.watch` with `recursive: true`. On Linux, `recursive: true` does not work — fall back to `registerInterval` polling every 5 minutes (`this.registerInterval(window.setInterval(scan, 5 * 60 * 1000))`).

```typescript
const watcher = fsWatch(folder, { recursive: true }, (event, filename) => {
    if (filename?.endsWith('SKILL.md')) void this.debouncedRescan()
})
this.register(() => watcher.close())
```

Debounce: 300 ms via `window.setTimeout`. Store debounce timer handle as `number`.

**Incremental update:** Maintain `Map<string, { mtime: number; entry: InternalEntry }>` keyed by skill name. On watcher event, re-parse only the affected skill, update the map, call `catalogBuilder.upsertEntry(entry)` and `searchBackend.upsertEntry(indexEntry)`.

### 7.8 Skill Resource File URL Scheme

```
Primary resource (always):
  GET /skills/<name>/SKILL.md
  Content-Type: text/markdown; charset=utf-8

Bundled assets:
  GET /skills/<name>/<relative-path>
  Content-Type: derived from extension

Skill manifest (index of all bundle files):
  GET /skills/<name>
  Content-Type: application/json
  Body: { name, files: [{ path, url, type, size }] }
```

**Content-Type mapping:**

| Extension       | Content-Type                   |
| --------------- | ------------------------------ |
| `.md`           | `text/markdown; charset=utf-8` |
| `.ts`           | `application/typescript`       |
| `.mjs`, `.js`   | `application/javascript`       |
| `.sh`           | `application/x-sh`             |
| `.json`         | `application/json`             |
| `.py`           | `text/x-python`                |
| `.png`          | `image/png`                    |
| `.jpg`, `.jpeg` | `image/jpeg`                   |
| `.svg`          | `image/svg+xml`                |
| `.pdf`          | `application/pdf`              |

Path-traversal safety is covered in Section 16.

---

## 8. Search Backend

### 8.1 Pluggable Interface

> **⚠️ Superseded by the shipped interface (see §1a refinement 3).** The interface below kept a separate `CatalogIndexEntry` projection; the implemented `src/app/search/search-backend.ts` is simpler — `index(entries: CatalogEntry[])` + `search(req): Promise<SearchResult[]>` + `isReady()`, with each backend deriving its own index from plain `CatalogEntry`. The block below is retained for the field-boost / RRF rationale.

```typescript
// src/app/search/search-backend.ts

export interface CatalogIndexEntry {
    id: string // entry.identifier (URN)
    displayName: string
    description?: string
    tags?: string[]
    capabilities?: string[]
    representativeQueries?: string[]
    type: string
    name?: string // skill folder name (for BM25 boost)
    argumentHint?: string // adds mode vocabulary
    _raw: CatalogEntry // original entry for result assembly
}

export interface BackendSearchResult {
    id: string
    score: number // ARD 0–100 relevance
    entry: CatalogIndexEntry
    explanation?: {
        lexScore?: number
        vecScore?: number
        fusionMethod?: 'bm25' | 'rrf' | 'cosine' | 'hosted'
    }
}

export interface SearchRequest {
    query: string
    limit?: number // default 10
    filter?: {
        type?: string[]
        tags?: string[]
        capabilities?: string[]
    }
}

export interface SearchBackend {
    readonly name: string
    readonly supportsSemanticSearch: boolean
    readonly requiresModelDownload: boolean

    index(entries: CatalogIndexEntry[], opts?: { force?: boolean }): Promise<void>
    removeEntry(id: string): void
    upsertEntry(entry: CatalogIndexEntry): Promise<void>
    search(request: SearchRequest): Promise<BackendSearchResult[]>
    isReady(): boolean
    dispose(): Promise<void>
}

export type SearchBackendKind = 'lexical' | 'local-model' | 'qmd-sidecar' | 'hosted-api'
```

### 8.2 Default: LexicalSearchBackend (MiniSearch BM25+)

```typescript
// src/app/search/lexical-search-backend.ts
import MiniSearch from 'minisearch'

export class LexicalSearchBackend implements SearchBackend {
    readonly name = 'BM25 Lexical (MiniSearch)'
    readonly supportsSemanticSearch = false
    readonly requiresModelDownload = false

    private ms: MiniSearch<CatalogIndexEntry>

    constructor() {
        this.ms = new MiniSearch<CatalogIndexEntry>({
            idField: 'id',
            fields: [
                'displayName',
                'name',
                'description',
                'capabilities',
                'representativeQueries',
                'tags',
                'argumentHint'
            ],
            storeFields: ['id', '_raw'],
            searchOptions: {
                boost: {
                    displayName: 3,
                    capabilities: 2.5,
                    tags: 2,
                    representativeQueries: 1.5,
                    description: 1,
                    name: 2,
                    argumentHint: 0.8
                },
                fuzzy: 0.2, // edit-distance fraction of term length
                prefix: true // "code gen" matches "code generation"
            }
        })
    }

    async index(entries: CatalogIndexEntry[]): Promise<void> {
        this.ms.removeAll()
        // MiniSearch requires arrays for multi-value fields; join them for indexing
        const docs = entries.map((e) => ({
            ...e,
            tags: e.tags?.join(' ') ?? '',
            capabilities: e.capabilities?.join(' ') ?? '',
            representativeQueries: e.representativeQueries?.join(' ') ?? ''
        }))
        this.ms.addAll(docs)
    }

    async search(req: SearchRequest): Promise<BackendSearchResult[]> {
        const raw = this.ms.search(req.query, { limit: (req.limit ?? 10) * 3 })
        // Normalize BM25 scores to 0-100
        const topScore = raw[0]?.score ?? 1
        return raw
            .filter((r) => this.matchesFilter(r, req.filter))
            .slice(0, req.limit ?? 10)
            .map((r) => ({
                id: r.id as string,
                score: Math.min(100, Math.round((r.score / topScore) * 85)),
                entry: r as unknown as CatalogIndexEntry,
                explanation: { lexScore: r.score, fusionMethod: 'bm25' as const }
            }))
    }

    isReady(): boolean {
        return true
    }
    removeEntry(id: string): void {
        try {
            this.ms.discard(id)
        } catch {}
    }
    async upsertEntry(e: CatalogIndexEntry): Promise<void> {
        this.removeEntry(e.id)
        this.ms.add(e)
    }
    async dispose(): Promise<void> {}

    private matchesFilter(r: Record<string, unknown>, filter?: SearchRequest['filter']): boolean {
        if (!filter) return true
        const entry = r._raw as CatalogIndexEntry
        if (filter.type?.length && !filter.type.includes(entry.type)) return false
        if (filter.tags?.length && !filter.tags.some((t) => entry.tags?.includes(t))) return false
        if (
            filter.capabilities?.length &&
            !filter.capabilities.some((c) => entry.capabilities?.includes(c))
        )
            return false
        return true
    }
}
```

**Score normalization rationale:** MiniSearch's BM25+ scores are unbounded positive floats. The formula `(score / topScore) * 85` reserves the top 85 for "best lexical match" and prevents all results clustering at 100. This matches the ARD intent that 0–100 represents relevance only.

### 8.3 LocalModelSearchBackend (Transformers.js, opt-in)

Uses `@huggingface/transformers` (v3+), ONNX WASM backend, `all-MiniLM-L6-v2` int8 quantized (~23 MB first-run download). Model loads in an inline Web Worker compiled with `esbuild-plugin-inline-worker` (pattern from `RyotaUshio/obsidian-web-worker-example`).

Score fusion uses **Reciprocal Rank Fusion (RRF)**:

```
rrf_score(doc) = 1/(60 + rank_bm25) + 1/(60 + rank_vec)
ard_score = round(min_max_normalize(rrf_score) * 100)
```

`isReady()` returns `false` until model loaded + index built; the HTTP server returns an empty result set with a `503` if invoked before ready, or falls back to the lexical backend.

### 8.4 QMDSidecarSearchBackend (optional, for qmd power users)

Spawns `qmd` CLI or `qmd mcp --http --port <n>` daemon. Uses `store.searchLex()` (BM25 only, no model download) by default; upgrades to `store.search()` (hybrid) if the user opts in and the 318 MB embedding model is already cached. Score mapping: `Math.round(qmdScore * 100)` (qmd returns 0.0–1.0 floats). `isReady()` checks: qmd binary exists on PATH, SQLite index file exists, `store.getStatus().totalDocuments > 0`.

Sidecar lifecycle: spawn from `onload` after first scan, kill from `onunload` via `this.register(() => sidecar.stop())`. Use module-level singleton guard (same pattern as HTTP server orphan cleanup — see Section 9.3).

### 8.5 HostedEmbeddingSearchBackend (optional, BYOK)

Batch-embeds entries via API on `index()` call; caches vectors in plugin data dir (`Float32Array`, binary file). Query embedding at search time adds ~100–300 ms network latency. Combines cosine similarity with BM25 via RRF → ARD 0–100. `isReady()` requires `apiKey` configured and non-empty vector cache.

### 8.6 Backend Selection and Fallback

```typescript
// src/app/search/search-backend-factory.ts
export function createSearchBackend(config: SearchBackendConfig): SearchBackend {
    switch (config.kind) {
        case 'local-model':
            return new LocalModelSearchBackend(config)
        case 'qmd-sidecar':
            return new QMDSidecarSearchBackend(config)
        case 'hosted-api':
            return new HostedEmbeddingSearchBackend(config)
        case 'lexical':
        default:
            return new LexicalSearchBackend()
    }
}
```

At search time, if the active backend is not ready (`!backend.isReady()`), fall back to `LexicalSearchBackend` automatically and include a `X-Search-Backend: fallback-lexical` response header so the client knows.

---

## 9. The HTTP Server

### 9.1 Tech Choice

Node.js `http.createServer` with no framework. Direct prior art: `/home/sebastien/wks/obsidian-cli-rest/src/app/services/http-server.ts`. All Node.js built-ins (`node:http`, `node:crypto`, `node:path`, `node:fs`) are bundled by Bun (they are NOT in `EXTERNAL_MODULES` in `scripts/build.ts`).

### 9.2 Route Table

| Method    | Path                           | Auth   | Description                                     |
| --------- | ------------------------------ | ------ | ----------------------------------------------- |
| `OPTIONS` | `*`                            | No     | CORS preflight → 204                            |
| `GET`     | `/.well-known/ai-catalog.json` | No     | Static catalog JSON                             |
| `POST`    | `/search`                      | Bearer | ARD registry search                             |
| `POST`    | `/explore`                     | Bearer | ARD facets → 501 (v1)                           |
| `GET`     | `/agents`                      | Bearer | ARD deterministic listing                       |
| `GET`     | `/skills/<name>`               | Bearer | Skill manifest (bundle file index)              |
| `GET`     | `/skills/<name>/<path>`        | Bearer | Skill resource file                             |
| `POST`    | `/mcp`                         | Bearer | MCP Streamable HTTP endpoint                    |
| `GET`     | `/health`                      | No     | `{"status":"ok","uptime":<sec>}` for monitoring |

**Auth exemptions:** `/.well-known/ai-catalog.json` and `/health` are public per ARD spec. All other routes require `Authorization: Bearer <token>`.

### 9.3 Server Lifecycle

```typescript
// src/app/services/http-server.ts

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'

// Module-level singleton guards orphan servers during hot-reload
let _sharedServer: ArdHttpServer | null = null

export class ArdHttpServer {
    private server: Server | null = null

    static async startOrReplace(port: number): Promise<ArdHttpServer> {
        if (_sharedServer) await _sharedServer.stop()
        _sharedServer = new ArdHttpServer()
        await _sharedServer.start(port)
        return _sharedServer
    }

    async start(port: number, bind = '127.0.0.1'): Promise<void> {
        this.server = createServer((req, res) => {
            void this.handle(req, res)
        })
        return new Promise((resolve, reject) => {
            this.server!.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    // Retry logic: 3 attempts × 500 ms (see obsidian-cli-rest plugin.ts:142-167)
                }
                reject(err)
            })
            this.server!.listen(port, bind, () => resolve())
        })
    }

    async stop(): Promise<void> {
        if (!this.server) return
        this.server.closeAllConnections() // Node >= 18; releases keep-alive connections immediately
        return new Promise((resolve) =>
            this.server!.close(() => {
                this.server = null
                resolve()
            })
        )
    }

    get isRunning(): boolean {
        return this.server?.listening ?? false
    }
}
```

**EADDRINUSE retry:** 3 attempts × 500 ms backoff handles the race condition during Obsidian hot-reload (OS port release lag).

### 9.4 Request/Response Shapes

**`GET /.well-known/ai-catalog.json`**

```typescript
// Response headers:
// Content-Type: application/json
// Access-Control-Allow-Origin: *
// Cache-Control: no-cache

// Body: AiCatalog JSON
{
  "specVersion": "1.0",
  "host": {
    "displayName": "Personal Obsidian Skill Registry",
    "identifier": "obsidian"
  },
  "entries": [ /* CatalogEntry[] */ ]
}
```

**`POST /search`**

Request body (Zod-validated):

```json
{
    "query": { "text": "summarize a document", "filter": { "type": ["application/ai-skill"] } },
    "federation": "none",
    "pageSize": 10
}
```

Response (200):

```json
{
    "results": [
        {
            "identifier": "urn:air:obsidian:skills:osk-summarize",
            "displayName": "OSK Summarize",
            "type": "application/ai-skill",
            "url": "http://127.0.0.1:27182/skills/osk-summarize/SKILL.md",
            "score": 87,
            "source": "http://127.0.0.1:27182"
        }
    ]
}
```

Error shape (all non-2xx):

```json
{ "errorCode": "INVALID_ARGUMENT", "message": "query.text is required" }
```

**`GET /agents`**

Query params: `pageSize` (default 20, max 100), `pageToken` (base64 cursor), `filter` (EBNF string — v1: support only `type=<mediaType>`).

Response (200):

```json
{
    "items": [
        /* CatalogEntry[] */
    ],
    "total": 395
}
```

Internal skills (`x-osk-user-invocable: false`) are excluded from `GET /agents` by default.

**`POST /explore`**

Response: `501 Not Implemented` with body `{ "errorCode": "NOT_IMPLEMENTED", "message": "Explore endpoint not supported in v1" }`.

### 9.5 CORS

All responses must include:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, mcp-session-id
```

OPTIONS preflight: `204 No Content` with CORS headers only.

### 9.6 Bearer Auth Middleware

```typescript
function checkAuth(req: IncomingMessage, token: string): boolean {
    const auth = req.headers['authorization'] ?? ''
    return auth === `Bearer ${token}`
}
```

Public paths exempt from auth check: `/.well-known/ai-catalog.json`, `/health`, preflight `OPTIONS`.

Rejected requests: `401 Unauthorized` + `WWW-Authenticate: Bearer realm="ard-registry"`.

---

## 10. MCP Endpoint (Code Mode)

### 10.1 Transport

`@modelcontextprotocol/sdk` v1.29.0, `WebStandardStreamableHTTPServerTransport` with `enableJsonResponse: true` (JSON-only, no SSE). Mounted at `POST /mcp` on the shared node HTTP server. Session management: `Map<sessionId, WebStandardStreamableHTTPServerTransport>` (one server instance per client session).

Auth: enforced at the HTTP router level before the MCP handler is reached — same bearer token as REST.

### 10.2 Session Management

```typescript
// src/app/mcp/session-manager.ts

const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()

export async function handleMcpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    rawBody: string,
    catalog: CatalogService,
    searchBackend: SearchBackend
): Promise<void> {
    const body = JSON.parse(rawBody)
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    let transport: WebStandardStreamableHTTPServerTransport

    if (sessionId && sessions.has(sessionId)) {
        transport = sessions.get(sessionId)!
    } else if (isInitializeRequest(body)) {
        transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (sid) => sessions.set(sid, transport)
        })
        transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId)
        }
        const mcpServer = buildMcpServer(catalog, searchBackend)
        await mcpServer.connect(transport)
    } else {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Missing mcp-session-id or invalid initialize request' }))
        return
    }

    // Bridge IncomingMessage to Web API Request
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v
    }
    const webReq = new Request(`http://localhost/mcp`, { method: 'POST', headers, body: rawBody })
    const webRes = await transport.handleRequest(webReq, { parsedBody: body })
    res.writeHead(webRes.status, Object.fromEntries(webRes.headers))
    res.end(Buffer.from(await webRes.arrayBuffer()))
}
```

### 10.3 MCP Server and Tool Definitions

```typescript
// src/app/mcp/mcp-server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export function buildMcpServer(catalog: CatalogService, search: SearchBackend): McpServer {
    const server = new McpServer(
        { name: 'ard-registry', version: '1.0.0' },
        { instructions: buildSystemPrompt(catalog) }
    )

    // ---- Tool: search ----
    server.registerTool(
        'search',
        {
            title: 'Search Registry',
            description:
                'Search the local ARD registry by natural-language query. Returns ranked results ' +
                '(score 0-100) with metadata but NOT skill bodies — use get_skill for those.',
            annotations: { readOnlyHint: true, openWorldHint: false },
            inputSchema: {
                query: z
                    .string()
                    .describe('Natural-language description of the skill or capability needed'),
                limit: z.number().int().min(1).max(20).optional().default(10),
                filter: z
                    .object({
                        type: z
                            .enum([
                                'application/ai-skill',
                                'application/mcp-server-card+json',
                                'application/a2a-agent-card+json'
                            ])
                            .optional(),
                        tags: z.array(z.string()).optional(),
                        capabilities: z.array(z.string()).optional(),
                        tier: z.enum(['primitive', 'workflow', 'ritual']).optional()
                    })
                    .optional()
            }
        },
        async ({ query, limit, filter }) => {
            const results = await search.search({ query, limit: limit ?? 10, filter })
            return {
                content: [{ type: 'text', text: formatSearchResults(results) }],
                structuredContent: {
                    results: results.map((r) => ({ ...r.entry._raw, score: r.score })),
                    total: results.length
                }
            }
        }
    )

    // ---- Tool: get_skill ----
    server.registerTool(
        'get_skill',
        {
            title: 'Get Skill',
            description:
                'Fetch the full catalog entry for a resource by URN identifier. ' +
                'Optionally includes the full SKILL.md body.',
            annotations: { readOnlyHint: true, openWorldHint: false },
            inputSchema: {
                identifier: z.string().describe('URN identifier from search results'),
                include_body: z.boolean().optional().default(true)
            }
        },
        async ({ identifier, include_body }) => {
            const entry = await catalog.getEntry(identifier, { includeBody: include_body ?? true })
            if (!entry) {
                return {
                    content: [{ type: 'text', text: `Not found: ${identifier}` }],
                    isError: true
                }
            }
            return {
                content: [{ type: 'text', text: formatEntry(entry) }],
                structuredContent: entry
            }
        }
    )

    // ---- Tool: execute (Code Mode core) ----
    server.registerTool(
        'execute',
        {
            title: 'Execute Registry Code',
            description:
                'Write JavaScript code that calls the registry API to discover, filter, and aggregate ' +
                'resources in one shot. The `registry` global is pre-injected with the full catalog metadata. ' +
                'Return a value from your code — it is JSON-serialized and returned. ' +
                'Limits: 10 s wall-clock, 64 MB memory. No network access. No file system access.\n\n' +
                'Available API:\n' +
                '  registry.search(query, opts?) → Promise<SearchResult[]>\n' +
                '  registry.get(identifier) → Promise<CatalogEntry | null>\n' +
                '  registry.listAll(filter?) → Promise<CatalogEntry[]>\n' +
                '  registry.getSkillBody(identifier) → Promise<null>  // use get_skill tool instead',
            annotations: { readOnlyHint: true, openWorldHint: false },
            inputSchema: {
                code: z
                    .string()
                    .describe('Async JavaScript function body. Return your result explicitly.')
            }
        },
        async ({ code }) => {
            const sandbox = new CodeModeSandbox(catalog, search)
            const result = await sandbox.run(code)
            if (!result.ok) {
                return {
                    content: [{ type: 'text', text: `Execution error: ${result.error}` }],
                    isError: true
                }
            }
            return {
                content: [{ type: 'text', text: JSON.stringify(result.value, null, 2) }],
                structuredContent: { result: result.value }
            }
        }
    )

    // ---- Resource: Registry API type definitions ----
    server.registerResource(
        'registry-api',
        'ard://registry-api.d.ts',
        {
            title: 'Registry TypeScript API',
            description: 'Type definitions for the registry global in execute() code.',
            mimeType: 'application/x-typescript'
        },
        async (uri) => ({
            contents: [
                { uri: uri.href, mimeType: 'application/x-typescript', text: REGISTRY_API_TYPES }
            ]
        })
    )

    return server
}

function buildSystemPrompt(catalog: CatalogService): string {
    return [
        `You are connected to a local ARD registry with ${catalog.entryCount()} resources.`,
        `Resources: AI Skills (application/ai-skill), MCP servers, A2A agents.`,
        `URN format: urn:air:${catalog.publisher}:skills:<name>`,
        ``,
        `DISCOVERY STRATEGY (most efficient first):`,
        `1. search() — NL query → ranked results with metadata (no bodies)`,
        `2. get_skill() — fetch full SKILL.md body by identifier`,
        `3. execute() — write code for multi-step discovery (preferred for filtering/aggregation)`,
        ``,
        `The execute tool runs synchronously against pre-loaded catalog metadata. Write plain JavaScript (no TS types in runtime code).`
    ].join('\n')
}
```

### 10.4 Code Mode Sandbox

```typescript
// src/app/mcp/sandbox.ts

import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core'
import releaseVariant from '@jitl/quickjs-singlefile-cjs-release-sync'

const TIMEOUT_MS = 10_000
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024

let _QuickJS: Awaited<ReturnType<typeof newQuickJSWASMModuleFromVariant>> | null = null

async function getQuickJS() {
    if (!_QuickJS) _QuickJS = await newQuickJSWASMModuleFromVariant(releaseVariant)
    return _QuickJS
}

export type SandboxResult = { ok: true; value: unknown } | { ok: false; error: string }

export class CodeModeSandbox {
    constructor(
        private catalog: CatalogService,
        private search: SearchBackend
    ) {}

    async run(userCode: string): Promise<SandboxResult> {
        const QuickJS = await getQuickJS()
        const runtime = QuickJS.newRuntime()
        runtime.setMemoryLimit(MEMORY_LIMIT_BYTES)
        runtime.setMaxStackSize(512 * 1024)

        const deadline = Date.now() + TIMEOUT_MS
        let interrupted = false
        runtime.setInterruptHandler(() => {
            if (Date.now() > deadline) {
                interrupted = true
                return true
            }
            return false
        })

        const context = runtime.newContext()
        try {
            // Pre-fetch all catalog entries (metadata only, no bodies) and inject as JSON global
            const allEntries = await this.catalog.listAll()
            const entriesJson = JSON.stringify(allEntries)
            context.evalCode(`const __catalog__ = ${entriesJson};`)?.value?.dispose()

            // Inject synchronous registry shim backed by pre-fetched data
            context.evalCode(REGISTRY_SHIM_CODE)?.value?.dispose()

            // Wrap user code in async IIFE
            const wrapped = `(async()=>{ const __r__ = await (async()=>{ ${userCode} })(); globalThis.__result__=JSON.stringify(__r__??null); })().catch(e=>{globalThis.__error__=String(e);});`
            const evalRes = context.evalCode(wrapped)
            if (evalRes.error) {
                const err = context.dump(evalRes.error)
                evalRes.error.dispose()
                return { ok: false, error: String(err) }
            }
            evalRes.value?.dispose()

            // Pump pending microtasks
            let jobResult
            do {
                jobResult = context.runtime.executePendingJobs()
                if (interrupted) return { ok: false, error: 'Execution timed out (10 s limit)' }
            } while ((jobResult.value ?? 0) > 0)

            // Read result
            const errH = context.getProp(context.global, '__error__')
            const errV = context.dump(errH)
            errH.dispose()
            if (errV) return { ok: false, error: String(errV) }

            const resH = context.getProp(context.global, '__result__')
            const resV = context.dump(resH)
            resH.dispose()
            return { ok: true, value: resV ? JSON.parse(resV as string) : null }
        } finally {
            context.dispose()
            runtime.dispose()
        }
    }
}
```

**Sandbox design rationale:** `quickjs-emscripten` (`@jitl/quickjs-singlefile-cjs-release-sync` + `quickjs-emscripten-core`) was chosen over alternatives for these reasons:

| Option               | Verdict                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node:vm`            | Not a sandbox — trivially escapable via prototype chain. Never use for code isolation.                                                                                        |
| `vm2`                | Deprecated 2023; CVE published January 2026. Do not use.                                                                                                                      |
| `isolated-vm`        | Strong V8-isolate sandbox but requires a native `.node` binary built against the exact Electron ABI — significant packaging complexity for an Obsidian plugin.                |
| `quickjs-emscripten` | Strong WASM boundary isolation, no native addon, no ABI issues, ~1.3 MB total. Singlefile CJS variant works directly in Electron's require-based plugin loader. **Selected.** |

The threat model here is "accidental harmful code from the model" (infinite loops, large allocations, unintended data access), not adversarial attacker-controlled code. QuickJS handles both well. The WASM memory limit (64 MB) and interrupt handler (timeout) prevent resource exhaustion.

**Async bridge approach:** The QuickJS sync-variant runtime cannot natively bridge async host promises. The solution is pre-injection: all catalog entry metadata (identifiers, displayNames, descriptions, tags, capabilities, representativeQueries — no SKILL.md bodies) is serialized as JSON and injected as a `__catalog__` global before execution. The `registry` shim runs in-memory BM25 keyword matching against this data. This keeps the sandbox fully synchronous while providing useful search capability. For `registry.getSkillBody()`, the tool description instructs the model to use the `get_skill` MCP tool directly (a deliberate design boundary — bodies can be 5–20 KB each, too large to pre-inject for 395 skills).

**TypeScript in execute:** QuickJS runs JavaScript only. The `execute` tool description and `REGISTRY_API_TYPES` resource use TypeScript declaration syntax for IDE/model comprehension, but the model must write plain JavaScript in the `code` argument (no type annotations at runtime). This is documented in the system prompt and tool description.

---

## 11. qmd / Sidecar Process

qmd is **not** a required dependency. It is one of four pluggable backend options. This section covers the design for users who opt in.

### 11.1 Why qmd Cannot Run In-Process

`node-llama-cpp` (qmd's native ML runtime) requires native `.node` binaries. Obsidian plugins execute in the Electron renderer process; `node-llama-cpp` documentation explicitly states this crashes the application. Additionally, native addons must not be packed into ASAR archives and require compilation against the exact Electron ABI — not feasible for community plugin distribution.

### 11.2 Sidecar Architecture

```
Obsidian Plugin Process                    qmd sidecar (system Node.js)
(Electron renderer)                         (runs outside Electron)
        │                                           │
        │  spawn(process.execPath or 'node',        │
        │         ['sidecar/qmd-bridge.mjs'])  ────►│
        │                                           │
        │  stdin: newline-delimited JSON-RPC  ─────►│  createStore() → SQLite + BM25
        │  stdout: newline-delimited JSON-RPC ◄─────│  searchLex() → BM25 only (default)
        │                                           │  search() → hybrid (opt-in)
        │  proc.on('exit') → restart w/ backoff     │
        │  plugin.register(() => sidecar.stop())    │  proc.exit(0) on 'exit' message
```

The sidecar script is a JS/MJS file bundled alongside `main.js` in the plugin output. It is NOT compiled into `main.js` (it must run as a separate Node.js process). It imports `@tobilu/qmd` from the user's global node_modules.

**Key API calls:**

| Operation             | qmd method                               | Models needed                    |
| --------------------- | ---------------------------------------- | -------------------------------- |
| BM25 search (default) | `store.searchLex(query, { limit })`      | None                             |
| Hybrid search         | `store.search({ query, rerank: false })` | 318 MB embed model               |
| Full pipeline         | `store.search({ query })`                | 2.1 GB (embed + rerank + expand) |
| Index update          | `store.update()`                         | None                             |
| Status                | `store.getStatus()`                      | None                             |

Use `QMD_FORCE_CPU=1` env var to prevent GPU probe delays in the sidecar environment.

### 11.3 Model Cache Location

GGUF models are cached by qmd at `~/.cache/qmd/models/` (global user cache, NOT inside the plugin). The plugin does not download, bundle, or manage GGUF files. If the user has already used qmd (e.g., for vault semantic search), the model cache is already present — this makes the sidecar backend essentially zero-additional-cost for existing qmd users.

### 11.4 Avoiding Bundle Bloat

qmd is in `package.json` `devDependencies` or not listed at all — it is never bundled into `main.js`. The `QMDSidecarSearchBackend` class contains only the spawn/stdio logic and imports nothing from `@tobilu/qmd`. The sidecar script (`src/app/search/qmd-bridge.mjs`) is copied to `dist/` as a separate file and excluded from the main bundle via `Bun.build` `external` config.

---

## 12. Project Scaffolding

### 12.1 Files to Change from Template

**`manifest.json`:**

```json
{
    "id": "obsidian-agentic-resource-discovery-server",
    "name": "Agentic Resource Discovery Server",
    "description": "Local-first ARD publisher and Agent Registry. Serves your AI skills and agentic resources to AI agents via a localhost HTTP server with REST and MCP endpoints.",
    "version": "0.1.0",
    "minAppVersion": "1.4.0",
    "isDesktopOnly": true,
    "author": "Sébastien Dubois",
    "authorUrl": "https://dsebastien.net",
    "fundingUrl": "https://www.buymeacoffee.com/dsebastien"
}
```

**`package.json`:** Update `name`, `description`, `repository.url`, `bugs.url`, `homepage` to match the new plugin ID.

**`src/main.ts`:** Change the default export class from `TemplatePlugin` to `ArdServerPlugin` (or just update the `export default` re-export). The template's `src/main.ts` re-exports from `src/app/plugin.ts`.

**`src/app/plugin.ts`:** Rename `TemplatePlugin` → `ArdServerPlugin`. Rename `TemplatePluginSettingTab` → `ArdServerSettingTab`. Replace the stub `onload` body with the full initialization sequence (server start, scanner init, vault watcher registration).

**`src/app/settings/settings-tab.ts`:** Rename class, replace stub `display()` with the five-section UI described in Section 6.

**`src/app/types/plugin-settings.intf.ts`:** Replace stub `PluginSettings` with the full Zod-derived schema from Section 5.2.

### 12.2 New Dependencies

```jsonc
// package.json — dependencies (bundled):
"minisearch": "^7.1.2",               // BM25+ lexical search, ~7 kB gzip
"gray-matter": "^4.0.3",              // YAML frontmatter + markdown parsing
"@modelcontextprotocol/sdk": "^1.29.0", // MCP Streamable HTTP server
"quickjs-emscripten-core": "^0.33.0", // QuickJS WASM sandbox core
"@jitl/quickjs-singlefile-cjs-release-sync": "^0.33.0", // QuickJS CJS variant (~1.3 MB)

// package.json — devDependencies (not bundled):
"@huggingface/transformers": "^3.0.0", // Local model backend (opt-in, loaded at runtime)
// Note: WASM files from onnxruntime-web must be excluded from bundle and
// handled as static assets — see Section 12.3 below.
```

**Why these packages:**

- `minisearch`: Zero-dependency BM25+, 7 kB gzipped, proven in Obsidian Omnisearch.
- `gray-matter`: Robust YAML+Markdown frontmatter parsing, handles edge cases in SKILL.md files.
- `@modelcontextprotocol/sdk`: Already globally installed at `~/.bun/install/global/node_modules/@modelcontextprotocol/sdk`; v1.29.0 confirmed working with the session-map pattern used in qmd's MCP server.
- `quickjs-emscripten-core` + `@jitl/quickjs-singlefile-cjs-release-sync`: WASM-boundary sandbox without native addons; singlefile CJS variant avoids `.wasm` file path issues in Electron.

### 12.3 Build Config Adaptations

The template `scripts/build.ts` already uses `format: 'cjs'`, `target: 'node'`, and bundles Node.js built-ins. The following additions are needed:

1. **QuickJS WASM**: The singlefile CJS variant bundles the WASM inline — no separate `.wasm` file needed. No build change required.

2. **qmd bridge sidecar**: Add a second `Bun.build` call for the sidecar script (separate entrypoint, no bundling of qmd imports):

    ```typescript
    await Bun.build({
        entrypoints: ['src/app/search/qmd-bridge.mjs'],
        outdir: 'dist',
        external: ['@tobilu/qmd', 'node-llama-cpp', 'better-sqlite3'],
        format: 'esm',
        target: 'node'
    })
    ```

3. **Transformers.js ONNX assets** (when implementing LocalModelSearchBackend): `.onnx` files must NOT go through esbuild; they are downloaded to a user cache dir at runtime. No build change needed for v1 (backend is opt-in and downloads at first use, not at build time).

4. **`EXTERNAL_MODULES`**: No changes needed — `obsidian`, `electron`, `@codemirror/*` remain the only externals. All new runtime dependencies are pure JS/WASM and bundle cleanly.

---

## 13. Source File Layout

> **Note:** The target layout below is the goal. As of M1 the `server/` tier is implemented as `router.ts` + `http-server.ts` + `registry-controller.ts` (no `server/handlers/` subfolder — the router holds the handlers), `search/` has `search-backend.ts` + `lexical-search-backend.ts`, and `catalog/` has `catalog-service.ts` + `resource-mapper.ts`. `skills/`, `mcp/`, and the other search backends arrive in later milestones.

```
src/
├── main.ts                           # Plugin entry point, exports ArdServerPlugin
├── styles.src.css                    # Tailwind styles
├── test-setup.ts                     # Bun test setup
└── app/
    ├── plugin.ts                     # ArdServerPlugin class (onload/onunload)
    ├── types/
    │   ├── ard.types.ts              # AiCatalog, CatalogEntry, registry API shapes
    │   ├── plugin-settings.intf.ts   # PluginSettings (Zod schema + inferred types)
    │   └── skill-frontmatter.types.ts # SkillFrontmatter interface
    ├── settings/
    │   ├── settings-tab.ts           # ArdServerSettingTab (5 sections)
    │   └── components/
    │       ├── folder-list.ts        # Reusable skill-folder list component
    │       ├── resource-list.ts      # Manual resource list component
    │       └── backend-selector.ts   # Search backend sub-form
    ├── catalog/
    │   ├── catalog-builder.ts        # AiCatalog assembly from entries
    │   ├── catalog-service.ts        # CatalogService: getEntry, listAll, toJSON, entryCount
    │   └── types.ts                  # InternalEntry, CatalogStore
    ├── skills/
    │   ├── skill-scanner.ts          # scanAll(), discoverSkillFolders(), chunked iteration
    │   ├── skill-parser.ts           # parseFrontmatter(), extractH1Title(), buildEntry()
    │   ├── skill-enricher.ts         # deriveTags(), deriveRepresentativeQueries(), toTitleCase()
    │   ├── skill-file-server.ts      # safeServeFile(), listBundleFiles(), contentTypeMap
    │   └── skill-watcher.ts          # vault event watchers + external fs.watch
    ├── search/
    │   ├── search-backend.ts         # SearchBackend interface, types
    │   ├── search-backend-factory.ts # createSearchBackend()
    │   ├── lexical-search-backend.ts # LexicalSearchBackend (MiniSearch BM25+)
    │   ├── local-model-backend.ts    # LocalModelSearchBackend (Transformers.js, opt-in)
    │   ├── qmd-sidecar-backend.ts    # QMDSidecarSearchBackend (opt-in)
    │   ├── hosted-api-backend.ts     # HostedEmbeddingSearchBackend (opt-in, BYOK)
    │   └── qmd-bridge.mjs            # Sidecar script (separate Bun.build entrypoint)
    ├── server/
    │   ├── http-server.ts            # ArdHttpServer (node:http, lifecycle)
    │   ├── router.ts                 # Route dispatch, auth middleware
    │   ├── auth.ts                   # validateBearerToken()
    │   ├── cors.ts                   # setCorsHeaders()
    │   └── handlers/
    │       ├── catalog-handler.ts    # GET /.well-known/ai-catalog.json
    │       ├── search-handler.ts     # POST /search
    │       ├── agents-handler.ts     # GET /agents
    │       ├── explore-handler.ts    # POST /explore → 501
    │       └── skill-file-handler.ts # GET /skills/<name>/...
    ├── mcp/
    │   ├── mcp-server.ts             # buildMcpServer() → McpServer
    │   ├── mcp-handler.ts            # handleMcpRequest() (HTTP bridge)
    │   ├── session-manager.ts        # sessions Map, cleanup
    │   ├── tools.ts                  # Zod schemas for all 3 tools
    │   ├── sandbox.ts                # CodeModeSandbox (quickjs-emscripten)
    │   ├── registry-shim.ts          # REGISTRY_SHIM_CODE (injected into QuickJS)
    │   └── registry-api-types.ts    # REGISTRY_API_TYPES (the .d.ts string for the MCP resource)
    ├── assets/
    │   └── buy-me-a-coffee.ts        # (from template)
    ├── commands/
    │   └── rebuild-catalog.ts        # "Rebuild catalog" command
    ├── domain/
    │   └── urn.ts                    # buildUrn(), validateUrn(), URN_PATTERN
    └── utils/
        ├── log.ts                    # (from template)
        ├── crypto.ts                 # generateApiKey() via node:crypto
        ├── text.ts                   # toTitleCase(), simplify(), extractFirstClause()
        └── path-safety.ts            # safeJoin() with traversal check
```

---

## 14. Phased Implementation Roadmap

### M0 — Template Adaptation and Scaffold (1–2 days)

> **Bootstrapping note.** This repo currently contains only `.git` — the template content is not yet copied in. The `origin` remote already points at `dsebastien/obsidian-agentic-resource-discovery-server` (a downstream plugin, not the template repo). So M0 starts by materializing the template, then running its init flow, per `obsidian-plugin-template/AGENTS.md`:
>
> 1. Copy the template working tree into this repo (everything except the template's `.git`).
> 2. `bun install && bun run init` — resets inherited template state (CHANGELOG, `versions.json`, `manifest.json`, `package.json`).
> 3. Complete the manual follow-ups in `TEMPLATE_USAGE.md` (class renames below, README rewrite, `docs/` user guide, `documentation/` technical docs, funding links).
> 4. **Remove the init tooling** once done: delete `TEMPLATE_USAGE.md`, `scripts/init-from-template.ts` (+ its `.spec.ts`), and the `"init"` entry in `package.json` `scripts`. Leaving them behind signals init is incomplete.
> 5. Preserve this `documentation/plans/implementation-plan.md` through the process.

**Deliverables:**

- Rename all template identifiers: `TemplatePlugin` → `ArdServerPlugin`, `TemplatePluginSettingTab` → `ArdServerSettingTab`.
- Update `manifest.json` (`id`, `name`, `description`, `isDesktopOnly: true`).
- Update `package.json` (`name`, `description`, `repository`, add `minisearch`, `gray-matter` to dependencies).
- Implement `PluginSettings` Zod schema and `DEFAULT_SETTINGS`.
- Implement `generateApiKey()` and bearer-token first-run generation.
- Implement the basic Settings UI skeleton (five section headings, port+token fields).
- Build passes (`bun run build`); plugin loads in Obsidian without errors.

**Acceptance criteria:** Plugin installs in Obsidian, settings tab opens, no console errors.

---

### M1 — HTTP Server + Static Catalog + Lexical Search (3–4 days)

**Status: ✅ Done (2026-06-23).** Implemented as a pure `router` + thin `http-server` adapter behind a `RegistryController` (see §1a). All acceptance criteria below met; 97 tests green. `closeAllConnections()` is used on stop; the EADDRINUSE retry loop is deferred to M6 (the plugin currently surfaces a Notice and asks the user to change the port).

**Deliverables:**

- `ArdHttpServer`: `start()`, `stop()`, `closeAllConnections()`, EADDRINUSE retry, module-level singleton.
- Router with all routes stubbed (404 or 501 except the ones implemented).
- Auth middleware and CORS headers.
- `CatalogService` and `CatalogBuilder` with a hand-built test catalog (3–5 hardcoded entries).
- `GET /.well-known/ai-catalog.json` serves the test catalog.
- `LexicalSearchBackend` (MiniSearch) with the field-boosted config.
- `POST /search` with Zod body validation, `query.text`, `filter`, `federation` param, ARD response shape, 0–100 score normalization.
- `GET /agents` with pagination.
- `POST /explore` → 501.
- `/health` endpoint.

**Acceptance criteria:**

- `curl http://127.0.0.1:27182/.well-known/ai-catalog.json` returns valid `AiCatalog` JSON.
- `curl -H "Authorization: Bearer <token>" -X POST .../search -d '{"query":{"text":"git"}}' ` returns ranked results with `score` field.
- `curl .../search` without auth returns 401.
- `bun test` passes all unit tests for score normalization and filter logic.

---

### M2 — Skill Scanning and Enrichment (3–4 days)

**Status: ✅ Done (2026-06-23).** `skill-parser` + `skill-enricher` + `skill-scanner` built test-first; plugin scans on `onLayoutReady` and via a "Rescan skills now" settings button. Frontmatter is parsed with js-yaml and coerced defensively (see §1a refinements 7–9). Verified end-to-end on the real 395-skill vault (395 scanned, 0 errors). The 4 KB partial-read optimization in §7.2 was **not** adopted — whole-file reads are simpler and fast enough for hundreds of small files; revisit only if scale demands it.

**Deliverables:**

- `SkillScanner.scanAll()` with `discoverSkillFolders()`, chunked scan, `window.setTimeout` yields.
- `SkillParser.parseFrontmatter()` (gray-matter, 4 KB read), `extractH1Title()` (8 KB read).
- `SkillEnricher.buildEntry()` with full mapping table (Section 7.3).
- `deriveTags()` algorithm.
- `deriveRepresentativeQueries()` algorithm with 2–5 constraint enforcement.
- `CatalogBuilder.rebuild(entries)` + `CatalogService.toJSON()` producing valid `AiCatalog`.
- `LexicalSearchBackend.index(entries)` called after scan.
- Settings UI: skill folder list with add/remove/autocomplete.
- `lastScanStats` updated after each scan.
- Scan triggered on `onLayoutReady`.

**Acceptance criteria:**

- Configuring the real skills folder (`/c/users/.../skills`) produces a catalog with 395 entries.
- `POST /search` with `"text": "analyze TypeScript"` returns relevant skills.
- No Obsidian UI freeze during scan (scan takes <300 ms in background; UI unblocked throughout).
- `bun test` passes unit tests for `deriveTags`, `deriveRepresentativeQueries`, `buildEntry`.

---

### M3 — Incremental Re-scan and Skill File Serving (2–3 days)

**Deliverables:**

- `SkillWatcher`: vault `modify`/`create`/`delete` events + external `fs.watch` + debounce.
- `debouncedRescanSkill(name)`: re-parse single skill, `catalog.upsertEntry()`, `searchBackend.upsertEntry()`.
- `SkillFileServer.safeServeFile()` with path-traversal check (Section 16.2).
- `GET /skills/<name>` → JSON bundle manifest.
- `GET /skills/<name>/<path>` → file content with correct Content-Type.
- Extension allowlist enforcement.
- "Rebuild catalog" command in Obsidian command palette.

**Acceptance criteria:**

- Modifying a SKILL.md updates the catalog and search index within 1 s.
- `curl .../skills/developassion-analytics/SKILL.md` returns the file content.
- `curl .../skills/../../etc/passwd` returns 403.
- Unknown extensions return 403.

---

### M4 — MCP Code Mode Endpoint (4–5 days)

**Status: ✅ Done (2026-06-23), with a deliberate simplification.** The MCP transport is a **hand-rolled JSON-RPC 2.0 handler** (`mcp/mcp-server.ts`) mounted at `POST /mcp`, not `@modelcontextprotocol/sdk` + its Streamable-HTTP/SSE transport — the SDK is large and its transport class is awkward to bridge to `node:http`, whereas the JSON-mode protocol surface an agent needs (`initialize`, `tools/list`, `tools/call`, the `initialized` notification, `ping`) is small and fully unit-testable. The Code Mode sandbox (`mcp/sandbox.ts`) uses `quickjs-emscripten` (singlefile CJS variant, WASM inlined into the bundle — no native addon, no separate `.wasm`). The async-bridge is solved by **pre-injecting catalog metadata** as a JSON global with a synchronous in-sandbox `registry` API (search/get/listAll); `get_skill` fetches bodies via the file service instead. If full SDK compatibility (SSE streaming, sampling) is ever needed, the handler can be swapped behind the same `POST /mcp` route. §10 below is the original design.

**Deliverables:**

- `handleMcpRequest()` with session management, `isInitializeRequest` check, Web API bridge.
- `buildMcpServer()` with `search`, `get_skill`, `execute` tools.
- `CodeModeSandbox` with `quickjs-emscripten`, 10 s timeout, 64 MB limit, `__catalog__` pre-injection.
- `REGISTRY_SHIM_CODE`: in-memory `registry.search()`, `registry.get()`, `registry.listAll()`.
- `REGISTRY_API_TYPES` constant exposed as MCP Resource at `ard://registry-api.d.ts`.
- `POST /mcp` route wired into the HTTP router.
- QuickJS singleton initialized once at plugin load (not per request).

**Acceptance criteria:**

- MCP client (e.g., `mcptools` CLI) can connect to `http://127.0.0.1:27182/mcp` with the bearer token.
- `search` tool returns ranked catalog entries.
- `get_skill` tool returns full entry + SKILL.md body.
- `execute` tool: `registry.search("git commit")` returns results in one call.
- `execute` tool with infinite loop (`while(true){}`) returns timeout error within 10 s.
- `execute` tool with memory bomb (`new Array(1e9)`) returns memory error.

---

### M5 — Optional Vector Search Backend (3–4 days)

**Status: ◐ Mostly done — hybrid search shipped, live e2e pending (2026-06-23).** The pluggable seam shipped first: `search-backend-factory.createSearchBackend(config)`, wired so a backend-config change restarts the registry. The **hybrid semantic search is now built and tested** (TDD, 28 new specs):

- `search/embedding/embedder.ts` — injectable `Embedder` seam (`load`/`embed`/`isReady`, L2-normalised vectors).
- `search/vector-store.ts` — pure brute-force cosine NN over unit vectors.
- `search/rrf.ts` — Reciprocal Rank Fusion + min-max → ARD 0–100 (best capped at 85, matching lexical headroom).
- `search/semantic-search-backend.ts` — `SemanticSearchBackend`: composes `LexicalSearchBackend` + `Embedder` + `VectorStore`. Two-phase indexing — lexical is ready synchronously (`isReady()` true at once); embeddings build in the **background** (generation-guarded so a rescan can't be clobbered by a stale embed). `search()` fuses both signals once `embeddingsReady`, else returns lexical. Degrades to lexical if the embedder fails to load.
- `search/embedding/http-embedder.ts` — real `Embedder` against a **local OpenAI-compatible `/v1/embeddings` server** the user already runs (Ollama, LM Studio, llama.cpp, LocalAI, vLLM). Calls go through Obsidian `requestUrl` (no CORS, passes the community lint rule); the HTTP client is injected so request/response handling is fully unit-tested. `load()` probes once to validate connectivity + learn the vector width; batches of 64; L2-normalises. The factory routes `local-model` → `SemanticSearchBackend(new HttpEmbedder({ url, model }))`.

**Why HTTP, not bundled Transformers.js:** the original §8.3 plan bundled `@huggingface/transformers` + ONNX-WASM and downloaded a ~23 MB model — exactly the bloat the v1 "zero mandatory downloads" non-goal forbids, plus a native-binary bundling minefield. Delegating to a server the user already runs gives *real* neural semantics with **zero bundle weight (still 1.65 MB) and zero managed download**, and the unreachable-server case degrades to lexical. Config: `embeddingServerUrl` (default `http://localhost:11434/v1`) + `embeddingModel` (default `nomic-embed-text`).

So `local-model` is wired end-to-end and safe today. Remaining: a **live smoke test against a running server** (none was up in the build env — see §1b). qmd/hosted backends are still deferred; `hosted-api` is now mostly a remote-URL + API-key variant of `HttpEmbedder`. The deliverables below are superseded by this HTTP approach (kept as historical rationale).

**Deliverables:**

- `LocalModelSearchBackend` with `@huggingface/transformers`, ONNX WASM, `all-MiniLM-L6-v2` int8.
- Inline Web Worker pattern (`esbuild-plugin-inline-worker`) for model inference.
- RRF score fusion of BM25 + cosine similarity → ARD 0–100.
- First-run download progress indicator in settings UI (`Notice`).
- `isReady()` returns `false` until model loaded; HTTP server falls back to lexical during loading.
- `QMDSidecarSearchBackend` (BM25 mode): spawn, stdio JSON-RPC, `searchLex`, score mapping.
- `HostedEmbeddingSearchBackend`: OpenAI/Voyage/Jina API wrapper, cached vectors.
- Backend selector in settings with per-backend sub-form (Section 6.2 Section 4).

**Acceptance criteria:**

- Switching to `local-model` backend in settings triggers a download progress notice.
- After download, `POST /search "help me write documentation"` returns semantically relevant results that differ from lexical results for query terms not in skill text.
- `qmd-sidecar` backend correctly detects qmd absence and shows error in settings.
- Switching backends does not require Obsidian restart.

---

### M6 — Hardening, Tests, and Documentation (3–4 days)

**Status: ✅ Core done (2026-06-23).** EADDRINUSE retry shipped; README, `docs/` user guide, `documentation/` technical docs, and the `AGENTS.md` project section written. ~160 tests across the suite. Post-v1 follow-ups (not blocking): MCP session TTL cleanup, automatic skill file-watching, and a manual end-to-end pass with a real MCP client (e.g. Claude Code).

**Deliverables:**

- Full `bun test` suite (see Section 15).
- Zod validation on all HTTP request bodies with detailed error messages.
- Rate-limit guard: 100 requests/minute per IP (token bucket, in-memory).
- Plugin unload: all timers cleared, server closed, watcher closed, sidecar killed, QuickJS disposed.
- `POST /explore` request body validation (even though response is 501).
- `GET /agents` filter by `type` query parameter.
- README with setup instructions: install plugin, configure skill folder, copy bearer token to Claude Code settings.
- `DEVELOPMENT.md` update with plugin-specific instructions.
- Manual end-to-end test: Claude Code uses the registry via MCP.

**Acceptance criteria:**

- `bun test` passes with >80% line coverage on core modules.
- Plugin survives 10 rapid reload cycles without EADDRINUSE errors.
- `bun run validate` (tsc + test + lint) passes with 0 warnings.

---

## 15. Testing Strategy

### 15.1 Unit Tests (`bun test`)

**`src/app/skills/skill-enricher.test.ts`**

- `deriveTags()`: cover all 10 tag sources; test kind/tier/effects/namespace/tool-family combinations.
- `deriveRepresentativeQueries()`: verify 2–5 output range; verify `undefined` returned when <2 queries; test polymorphic hint parsing (`{option1|option2}`); test skills with empty `when_to_use`.
- `toTitleCase()`: test `developassion-analytics` → `"DeveloPassion Analytics"`, `osk-wiki-create` → `"OSK Wiki Create"`.

**`src/app/skills/skill-parser.test.ts`**

- `parseFrontmatter()`: test with complete SKILL.md sample, malformed YAML, missing required fields.
- `buildEntry()`: test full mapping with a real sampled SKILL.md; verify `updatedAt` ISO format; verify `representativeQueries` is omitted when < 2 derived.

**`src/app/catalog/catalog-builder.test.ts`**

- `CatalogBuilder.rebuild()`: verify `specVersion: "1.0"`, `entries` array, `host` field.
- Verify `url | data` oneOf: each entry has exactly one.
- Verify `identifier` matches URN regex `^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$`.
- Verify `representativeQueries` when present has 2–5 items.

**`src/app/search/lexical-search-backend.test.ts`**

- `index()`: 100 synthetic entries, verify `isReady()`.
- `search()`: relevance ordering test ("git commit" should rank commit skills above analysis skills).
- Score normalization: top result ≤ 85, all scores 0–100.
- Filter: `type` filter excludes non-matching entries.
- Fuzzy: "analyce" matches "analyze".
- Prefix: "code gen" matches "code generation".

**`src/app/domain/urn.test.ts`**

- `buildUrn()`: valid output for typical inputs.
- `validateUrn()`: valid and invalid examples.

**`src/app/utils/path-safety.test.ts`**

- `safeJoin('/var/safe', '../etc/passwd')` throws or returns null.
- `safeJoin('/var/safe', 'sub/file.md')` returns correct path.
- Null byte in path rejected.

### 15.2 Integration Tests

**`src/app/server/server.integration.test.ts`**

- Start a real `ArdHttpServer` on an ephemeral port (e.g., 27199).
- `GET /.well-known/ai-catalog.json`: verify JSON structure, CORS headers, no auth required.
- `POST /search` without auth: verify 401.
- `POST /search` with auth + valid body: verify 200 + `results` array + `score` field.
- `POST /search` with invalid body: verify 400 + `errorCode`.
- `POST /explore`: verify 501 + `errorCode: "NOT_IMPLEMENTED"`.
- `GET /agents`: verify 200 + `items` array.
- `GET /health`: verify 200 + `{"status":"ok"}`.
- Stop server, verify port is released (attempt re-bind succeeds).

**`src/app/mcp/mcp.integration.test.ts`**

- Build `McpServer` with a synthetic `CatalogService`.
- Simulate MCP initialize request + session, then tool call.
- `search` tool: verify structured content shape.
- `execute` tool with `return registry.listAll().then(a => a.length)`: verify returns count.
- `execute` tool timeout: verify error returned within 12 s.

### 15.3 Non-Blocking Scan Test

**`src/app/skills/skill-scanner.test.ts`**

- Create 100 temporary SKILL.md files in a temp directory.
- Call `scanAll([tmpDir])`.
- Record Obsidian event loop availability during scan (via setImmediate / queueMicrotask polling).
- Verify scan completes without blocking for >50 ms contiguously.
- Verify all 100 entries emitted.

### 15.4 Test Utilities

- A `createSyntheticSkillFolder(name, overrides)` helper that writes a minimal SKILL.md with valid frontmatter to a temp directory.
- A `buildTestCatalog(n)` helper that generates `n` synthetic `CatalogEntry` objects for search tests.
- Mock for `node:fs` using `bun:test` module mocking for parser unit tests (avoids disk I/O).

---

## 16. Security and Privacy

### 16.1 Localhost-Only Binding

The server binds to `127.0.0.1` (not `0.0.0.0`). This is a hard-coded default that the settings UI does not expose as user-configurable (port is configurable; bind address is not). This ensures the registry is never reachable from the network by accident.

### 16.2 Path Traversal Prevention

All skill file serving goes through `safeJoin()`:

```typescript
// src/app/utils/path-safety.ts
import { resolve, join, normalize, sep } from 'node:path'

export function safeJoin(rootDir: string, userRelPath: string): string | null {
    // Reject null bytes
    if (userRelPath.includes('\0')) return null
    // Decode URL encoding, then normalize
    const decoded = decodeURIComponent(userRelPath)
    const requested = normalize(join(rootDir, decoded))
    // Must start with rootDir + separator (prevents prefix attacks)
    if (!requested.startsWith(normalize(rootDir) + sep)) return null
    return requested
}
```

Additionally:

- Extension allowlist: only `.md`, `.ts`, `.mjs`, `.js`, `.sh`, `.json`, `.py`, `.png`, `.jpg`, `.svg`, `.pdf` are served.
- Configured-roots check: the requested path must be under one of the user-configured skill root directories.
- All skill file routes require bearer token auth.

### 16.3 Bearer Token

Generated via `randomBytes(32).toString('hex')` → 64 hex characters, 256 bits of entropy. Generated once on first run; stored in Obsidian's plugin data (encrypted by Obsidian's vault encryption if enabled). The token is displayed in settings (masked by default, copyable) and never included in catalog entries or HTTP response bodies.

The `/.well-known/ai-catalog.json` endpoint is intentionally public (no auth) because the ARD spec requires crawlability and the catalog itself contains no secrets — only stable URLs that themselves require auth to access.

### 16.4 No Secrets in Catalog

The generated `AiCatalog` contains only what is in SKILL.md frontmatter (public skill metadata). It does not contain:

- The bearer token
- The API key for hosted embedding (stored separately, never serialized into catalog)
- File system paths (skill URLs are `http://127.0.0.1:<port>/skills/<name>/SKILL.md`, not FS paths)
- Contents of bundled skill scripts

`x-osk-dependencies` extension fields contain only skill folder names (public strings), not credentials or personal data.

### 16.5 Code Execution Sandbox

The `execute` MCP tool runs code in `quickjs-emscripten` with:

- 64 MB memory limit (WASM allocator enforced)
- 10 s wall-clock timeout (interrupt handler)
- 512 KB stack limit
- No network access (QuickJS has no built-in fetch; the registry shim is the only I/O surface)
- No file system access (no Node.js `fs` APIs injected)
- WASM process boundary: V8 bugs in Electron host do not translate to sandbox escapes

The injected `registry` global only exposes read-only catalog metadata (no writes, no Obsidian APIs).

### 16.6 Local-First Data Handling

All skill data stays on the local machine. No telemetry. No cloud sync. The catalog is only accessible from `127.0.0.1`. The optional hosted embedding backend sends entry metadata (displayName, description, tags) to the configured API provider at index time — this is documented in the settings UI with a clear warning.

---

## 17. Risks and Open Questions

| Risk / Open Question                                                              | Status                                    | Mitigation                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`urn:air:obsidian:...` is non-spec-compliant** (`obsidian` is not a valid FQDN) | Known, accepted deviation (user decision) | Keep `obsidian` as the default publisher segment per the project decision — fine for local-first, non-published use. Document `agent.localhost` (spec-endorsed for local dev) and a real FQDN (e.g. `dsebastien.net`) as alternatives selectable via the configurable `publisher` setting; a real FQDN is required only when publishing externally. |
| **`metadata.updated` lacks timezone** in real SKILL.md frontmatter                | OPEN                                      | Assume UTC; append `Z` suffix. Document in code. Investigate sample to confirm.                                                                                                                                                                                                                                                                     |
| **Linux `fs.watch` non-recursive**                                                | Known                                     | Fall back to `registerInterval` poll every 5 min on Linux. Document limitation.                                                                                                                                                                                                                                                                     |
| **Electron ABI for native addons**                                                | Known — no native addons used             | `quickjs-emscripten` is WASM, `gray-matter` and `minisearch` are pure JS. No native addons in the default stack.                                                                                                                                                                                                                                    |
| **QuickJS sync variant cannot bridge async host calls**                           | Known, accepted                           | Pre-inject full catalog metadata as JSON. `getSkillBody()` returns null in sandbox; model uses `get_skill` tool for bodies. Upgrade path: `@sebastianwessel/quickjs` ASYNCIFY variant.                                                                                                                                                              |
| **MCP `WebStandardStreamableHTTPServerTransport` API stability**                  | Low risk                                  | SDK v1.29.0 confirmed working in qmd reference implementation. Pin version.                                                                                                                                                                                                                                                                         |
| **TypeScript in `execute` tool**                                                  | OPEN                                      | QuickJS only runs JavaScript. Tool description instructs model to write plain JS. If TS becomes important, integrate `@sebastianwessel/quickjs` (has TS support) in v2.                                                                                                                                                                             |
| **`representativeQueries` heuristic quality for context/barrel skills**           | OPEN                                      | Context skills often lack `description` and `when_to_use`. The heuristic may produce <2 queries → field omitted. Acceptable; the ARD spec makes this field optional.                                                                                                                                                                                |
| **gray-matter YAML edge cases**                                                   | Low risk                                  | Skills with multi-line strings or special characters in frontmatter may fail parsing. Catch all errors, log, skip.                                                                                                                                                                                                                                  |
| **`gray-matter` bundle size**                                                     | Low risk                                  | `gray-matter` is ~15 kB gzipped. Acceptable. Alternative: manual YAML split + `bun:yaml` (native Bun YAML parser).                                                                                                                                                                                                                                  |
| **POST /explore implementation complexity**                                       | Deferred                                  | v1 returns 501. Implementation in v2 requires facet aggregation over in-memory entries — straightforward to add.                                                                                                                                                                                                                                    |
| **`GET /agents` EBNF filter parsing**                                             | Simplified                                | v1 supports only `type=<mediaType>` filter via query param. Full EBNF filter deferred to v2.                                                                                                                                                                                                                                                        |
| **Session map memory leak**                                                       | Low risk                                  | MCP sessions accumulate if clients disconnect without closing. Add session TTL (15 min idle) with cleanup via `setInterval`.                                                                                                                                                                                                                        |
| **First-run experience for users who have never used ARD**                        | UX risk                                   | Add a "Quick Start" section to the settings tab explaining what the plugin does and how to use the generated bearer token with Claude Code.                                                                                                                                                                                                         |

---

## 18. Future Work

### Trusted Conformance (v2)

Implement `TrustManifest` with:

- `identity`: SPIFFE ID, DID, or HTTPS FQDN (user-configured)
- `identityType`: `"did"` | `"https"` | `"spiffe"` | `"other"`
- `attestations[]`: links to SOC2/GDPR/HIPAA attestation documents with `mediaType` and `digest`
- `provenance[]`: derivation relationships to upstream skill sources
- `signature`: JWS (compact serialization) over the trustManifest object, signed with a user-controlled private key stored in OS keychain

This requires integrating a JWS library (e.g., `jose`) and a key management UI (generate/import private key, display public key for verification by downstream registries).

### Real-Domain Publishing (v2–v3)

When the user has a real FQDN:

- Deploy the catalog to `https://dsebastien.net/.well-known/ai-catalog.json` (static file upload or reverse proxy to the local server via ngrok/cloudflared).
- Add `robots.txt` `Agentmap:` directive and `<link rel="ai-catalog" ...>` to the user's website.
- Configure DNS SVCB records: `_catalog._agents.dsebastien.net` for static discovery, `_search._agents.dsebastien.net` for the dynamic registry.
- Update URN publisher segment to the real FQDN for full spec compliance.

### Federation (v3)

`POST /search?federation=auto` chaining: when the local registry cannot satisfy a search query above a configurable relevance threshold, forward the query to registered referral registries (HuggingFace Discover, other local instances) and merge results. Requires:

- `RegistryReferral[]` tracking in settings
- Async parallel fan-out with per-referral timeout
- Score normalization across heterogeneous registries (RRF is ideal here)

### HuggingFace Discover Interop

Register the plugin's catalog with HuggingFace Discover (`https://huggingface-hf-discover.hf.space`) by submitting the catalog URL. Requires real-domain publishing first (HF Discover does not index localhost). Once indexed, skills become discoverable via `POST /search` on HF's registry — enabling cross-user skill sharing.

### POST /explore Facets (v2)

Implement faceted search over the in-memory catalog:

- Supported facet fields: `type`, `metadata.kind` (`x-osk-kind`), `metadata.tier`, `metadata.effects`, namespace (first segment of `identifier`)
- Implementation: group `allEntries` by facet field, count, sort by count descending, apply `limit`/`minCount`
- Response time: O(n) over entries, well within acceptable range for 395–1000 entries

### `registry.getSkillBody()` in Sandbox (v2)

Switch `execute` tool to `@sebastianwessel/quickjs` (ASYNCIFY-based WASM, ~2.6 MB) to enable true async host bridging. This allows `registry.getSkillBody(identifier)` to actually fetch and return file contents from the FS inside sandbox code, enabling the model to do semantic skill comparison, template extraction, or multi-skill analysis in a single `execute` call.

---

## Appendix A: Key External References

| Resource                     | URL / Path                                                              |
| ---------------------------- | ----------------------------------------------------------------------- |
| ARD Spec v0.9                | `github.com/ards-project/ard-spec` — `spec/ard.md`                      |
| ARD JSON Schema              | `spec/schemas/ai-catalog.schema.json`                                   |
| ARD OpenAPI                  | `spec/schemas/ard.openapi.yaml`                                         |
| ARD URN guide                | `spec/urn-naming-guide.md`                                              |
| Live ARD catalog             | `https://huggingface.co/.well-known/ai-catalog.json`                    |
| Plugin template              | `/home/sebastien/wks/obsidian-plugin-template`                          |
| HTTP server prior art        | `/home/sebastien/wks/obsidian-cli-rest/src/app/services/http-server.ts` |
| qmd SDK types                | `~/.bun/install/global/node_modules/@tobilu/qmd/dist/index.d.ts`        |
| MCP SDK                      | `~/.bun/install/global/node_modules/@modelcontextprotocol/sdk`          |
| MCP server reference         | `~/.bun/install/global/node_modules/@tobilu/qmd/dist/mcp/server.js`     |
| Skills vault                 | `/c/users/trankill/My Drive/Notes/Seb/.claude/skills/`                  |
| Inline worker pattern        | `github.com/RyotaUshio/obsidian-web-worker-example`                     |
| MiniSearch                   | `github.com/lucaong/minisearch` (v7.x, BM25+)                           |
| Omnisearch (MiniSearch ref)  | `github.com/scambier/obsidian-omnisearch`                               |
| Smart Connections (ONNX ref) | `github.com/brianpetro/obsidian-smart-connections`                      |
| quickjs-emscripten           | `github.com/justjake/quickjs-emscripten`                                |
| Code Mode pattern            | `blog.cloudflare.com/code-mode-mcp/`                                    |
| AGENTS.md (lint rules)       | `/home/sebastien/wks/obsidian-plugin-template/AGENTS.md`                |
