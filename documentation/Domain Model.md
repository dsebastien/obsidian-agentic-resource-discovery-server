# Domain Model

The ubiquitous language of this plugin. Use these terms exactly in code, tests, and docs.

## ARD concepts (from the spec)

- **Agentic resource** — anything an agent can discover and use: an AI Skill, MCP server, A2A agent, nested catalog, or registry. Identified by media `type`.
- **AI Catalog (`ai-catalog.json`)** — the static manifest a publisher hosts: `{ specVersion: "1.0", host?, entries: CatalogEntry[] }`. Served at `/.well-known/ai-catalog.json`.
- **Catalog entry** — one resource in the catalog. Required: `identifier` (URN), `displayName`, `type`. Exactly one of `url | data`. Optional: `description`, `tags`, `capabilities`, `representativeQueries` (2–5), `version`, `updatedAt`, plus `x-*` extension fields.
- **URN (`urn:air:<publisher>:<segments>`)** — a stable, domain-anchored identifier. This plugin uses publisher `obsidian` by default; skills are `urn:air:obsidian:skills:<name>`.
- **Agent Registry** — the dynamic search layer over a catalog. Mandatory `POST /search`; optional `POST /explore`, `GET /agents`.
- **Relevance score** — `0–100` on each search result. **Relevance only — never a trust or safety rating** (a hard rule from the spec).
- **Representative queries** — 2–5 natural-language example queries per entry that a registry turns into search signal.

## Plugin concepts

- **AI Skill** — an Anthropic Agent Skill: a folder with a `SKILL.md` (YAML frontmatter + body) and optional bundled assets.
- **Skill frontmatter** — `name`, `description`, `when_to_use`, `argument-hint`, `allowed-tools`, `model`, `effort`, `metadata.{kind, capability, effects, tier, note-types, dependencies, updated}`, `user-invocable`, `disable-model-invocation`, `context`.
- **Enrichment** — deterministic mapping from frontmatter to a rich catalog entry (no LLM): derives `tags`, `capabilities`, `representativeQueries`, and `x-osk-*` extension fields.
- **`x-osk-*` fields** — non-standard extension fields on an entry carrying skill internals (`x-osk-kind`, `x-osk-tier`, `x-osk-effects`, `x-osk-dependencies`, `x-osk-user-invocable`, …) for filtering and Code Mode.
- **Manual resource** — a user-configured non-skill entry (MCP/A2A/catalog/registry) from settings.
- **Search backend** — the relevance-ranking engine behind `POST /search` (interface `SearchBackend`; default lexical BM25).
- **Code Mode** — the MCP `execute` tool: the model writes JavaScript that calls an injected `registry` API inside a sandbox, returning only the result (avoids streaming the whole catalog through context).
- **Registry** (in code) — the running unit owned by `RegistryController`: catalog + search backend + skill file service + HTTP server.

## Relationships

- A **skill folder** contains many **skills**; each skill → one **catalog entry** (`type: application/ai-skill`).
- A **catalog** = scanned skill entries **+** manual-resource entries, keyed by URN `identifier` (collisions dropped).
- A **registry** serves one **catalog**; a **search backend** indexes that catalog's entries.
- An entry's `url` for a skill points back at the registry's `GET /skills/<name>/SKILL.md`.

## Architecture Decision Records

Notable design decisions: pure-router/thin-adapter split; `js-yaml` over `gray-matter` (pinned-version conflict); coerce all untrusted YAML values; hand-rolled MCP JSON-RPC over the heavy SDK; QuickJS WASM sandbox over `vm2`/`isolated-vm`; semantic search via an OpenAI-compatible embedding server (local or hosted) rather than a bundled model, to avoid mandatory downloads.
