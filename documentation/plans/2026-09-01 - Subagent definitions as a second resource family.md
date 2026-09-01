# Subagent definitions as a second resource family

**Status:** proposed · 2026-09-01 · revised the same day after an adversarial review (Codex gpt-5.6-sol, xhigh) — see §8 for what changed and why.
**Motivation:** a Claude Code session started with `--disable-slash-commands` and only the ARD MCP server boots at ~48K tokens instead of ~98K (measured on a 415-skill / 63-agent vault). Skills are already discoverable through ARD; the 63 agent definitions in `.claude/agents/` are not, so a no-registry session still can't find "the editor" or "the hater". This plan makes agent definitions a catalog family next to skills — **strictly additive**: nothing that exists today changes shape.

## 1. What the spec allows (ARD v0.91)

- `type` is an open IANA-style media type; the spec **does not define a registry** of allowed types and explicitly leaves the artifact's internal schema alone. Cited examples: `application/ai-skill+md`, `application/mcp-server-card+json`, `application/a2a-agent-card+json`.
- There is **no existing type for a persona / prompt / subagent definition**. The A2A agent card is the closest name but describes a remotely invocable agent, not a markdown file — wrong semantics.
- URN: `urn:air:<publisher>:<namespace>:<name>`, regex `^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$`. Nothing constrains the namespace segment; a second family is simply a second segment.
- `url` must point at **the artifact itself** (the file a client reads), not at an ARD wrapper. `data` is an object, so a markdown body can't be inlined without wrapping — use `url`.
- Filters are OR-within-key / AND-across-keys, so `filter.type` with two values browses both families in one call; `/explore` already buckets by `type`.
- `additionalProperties: true`; `x-*` keys are tolerated, `@context`-declared terms are the spec-blessed filterable extension. We keep `x-osk-*` for now (consistent with skills) and note the `@context` upgrade as a later step for both families.

## 2. Decisions

| #   | Decision             | Choice                                                                                                                                                                                                      | Why                                                                                                                                                                                                                                                                                                   |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Media type           | `application/ai-agent+md`                                                                                                                                                                                   | Mirrors the spec's `+md` convention. Vendor-neutral: Codex/Gemini/Copilot agent files share the frontmatter-plus-prompt shape. Not `claude-*` — the plugin's skill type isn't Anthropic-branded either.                                                                                               |
| D2  | Skill media type     | **Unchanged** (`application/ai-skill`)                                                                                                                                                                      | Aligning it to the spec's `+md` spelling is a break for every client filtering on the current string, and a host-side filter shim would not cover Code Mode's own exact matcher (`registry-shim.ts:30`), `/explore` facets, or anyone reading the raw catalog. Separate decision, separate release.   |
| D3  | URN namespace        | `subagents` → `urn:air:<publisher>:subagents:<name>`                                                                                                                                                        | `agents` is taken twice: the ARD `GET /agents` listing endpoint and the A2A manual-resource namespace (`resource-mapper.ts:8`). "Subagent" is also Claude Code's own term for these files.                                                                                                            |
| D4  | Serving route        | `GET /subagents/<name>.md` — one flat file, no manifest                                                                                                                                                     | Agents are single files; a manifest of one entry and a two-level path are ceremony. Served by the artifact store (D5), not a second file service.                                                                                                                                                     |
| D5  | Body resolution      | A **`LocalArtifactStore`** keyed by URN: `urn → { path, contentType, route }`, populated atomically with the catalog. Both `/skills/*` and `/subagents/*` routes and the MCP body fetch resolve through it. | Today's MCP `fetchSkillBody` dispatches on URL text (`/\/skills\/([^/]+)\/(.+)$/`, `mcp-server.ts:205`) — origin-blind, so a manual resource whose URL merely _looks_ local could be served a local file. Resolving by URN closes that for skills too and is the only seam a third family would need. |
| D6  | MCP tools            | Add `get_resource` (any URN); keep `get_skill` as a deprecated alias with the same handler. `search` gains no new args — `filter.type` already selects a family.                                            | `get_skill` already resolves any URN; only the body fetch is skill-shaped.                                                                                                                                                                                                                            |
| D7  | Scan source          | New setting `agentFolders: string[]`, **default `[]` (opt-in)**                                                                                                                                             | `skillFolders` is opt-in today; a non-empty default would publish names, descriptions, models and tool lists of every agent through the **unauthenticated** catalog on the next upgrade. The settings tab shows the count that will become public before the first scan.                              |
| D8  | Atomicity            | One scan produces one `ScanSnapshot { skills, subagents }`; one `setScannedEntries(snapshot)` on the controller; one `search.index()`.                                                                      | Two setters (`setSkillEntries` + `setAgentEntries`) would rebuild and re-embed twice per rescan and let a client observe fresh skills with stale agents; a failure between the two leaves partial state.                                                                                              |
| D9  | Identity             | Canonical name = sanitised **file stem** (URN charset `[A-Za-z0-9._-]`, lower-cased). Frontmatter `name` is metadata; if it disagrees with the stem, log and keep the stem.                                 | One rule, derivable from the path alone, no second map to drift. Within a family the first root in settings order wins a stem collision; the loser is logged and skipped (same as skills' URN dedup).                                                                                                 |
| D10 | Family discriminator | `type` only. No `family:` tag.                                                                                                                                                                              | The tag would have to be retrofitted onto the skill enricher and its tests to mean anything; `type` already does the job in `/search`, `/explore`, `GET /agents` and Code Mode.                                                                                                                       |
| D11 | Enrichment           | Deterministic (BR-14), see §4.                                                                                                                                                                              | No LLM.                                                                                                                                                                                                                                                                                               |

## 3. Data model

```ts
// ard.types.ts — one new member, nothing renamed
export enum ArdMediaType {
    AiSkill = 'application/ai-skill',
    AiAgent = 'application/ai-agent+md'
    /* McpServerCard, A2aAgentCard, AiCatalog, AiRegistry unchanged */
}

// domain/urn.ts
export const SUBAGENTS_NAMESPACE = 'subagents'
export const buildSubagentUrn = (publisher, name) =>
    buildUrn(publisher, [SUBAGENTS_NAMESPACE, name])

// artifacts/local-artifact-store.ts
export interface LocalArtifact {
    urn: string
    /** Absolute, realpath-resolved at scan time. */
    path: string
    contentType: string
    /** Route the artifact is served at, relative to baseUrl. */
    route: string // '/skills/<name>/SKILL.md' | '/subagents/<name>.md'
}
```

A scanned agent definition is one file `<dir>/<stem>.md` with frontmatter. Observed on the real vault (62 files, 100 % coverage): `name`, `description`, `model`, `allowed-tools`; 59/62 also carry `created`/`updated`. Claude Code's documented keys are `name`, `description`, `tools`, `model`, `color`; accept both `tools` and `allowed-tools` (`tools` wins if both are present; scalar or array, comma-split, trimmed, de-duplicated).

Catalog entry produced:

```jsonc
{
    "identifier": "urn:air:developassion:subagents:agent-osk-editor",
    "displayName": "Osk Editor", // humanised from the stem; a leading "agent-" segment is dropped
    "type": "application/ai-agent+md",
    "url": "http://127.0.0.1:27182/subagents/agent-osk-editor.md",
    "description": "Sharp-eyed editor. Reviews for structure, clarity, flow, grammar. Constructive but direct.",
    "tags": ["ns:agent", "category:osk", "model:sonnet", "uses-skills"],
    "representativeQueries": [
        "review this as an editor",
        "act as osk editor",
        "check structure, clarity, flow, grammar"
    ],
    "version": "2026-04-15", // from `updated` when it parses as a date
    "x-osk-model": "sonnet",
    "x-osk-tools": ["Read", "Glob", "Grep", "Skill"]
}
```

`capabilities` is emitted only when the frontmatter carries `metadata.capability` (none of the 62 do today).

## 4. Modules

### New

- `src/app/scan/frontmatter.ts` — the untrusted-frontmatter normaliser extracted from `skill-enricher.ts` (`asString`, `asStringArray`, date coercion, the tool→tag rules that are inline regexes at `skill-enricher.ts:99` today). Skills switch to it in the same commit; behaviour-preserving, covered by the existing skill enricher specs.
- `src/app/agents/agent-scanner.ts` — `scanAgents(roots, ctx) → AgentScanResult[]`. Non-recursive `*.md` per root; **per-file size cap** (256 KB, above it: skip + log — an agent prompt is not a book); read with bounded concurrency (same chunk-of-20 + yield as skills, BR-12); skip files with no `description` (BR-13). mtime cache keyed `(publisher, baseUrl, realpath)`.
- `src/app/agents/agent-enricher.ts` — `buildAgentEntry(scan, ctx) → CatalogEntry`. Tags: `ns:`/`category:` from the hyphenated stem (skill splitter), `model:<x>`, tool tags from the shared rules (`uses-bash`, `uses-web`, `writes-files`, plus `uses-skills` when `Skill` is listed). `representativeQueries`: first sentence of the description lower-cased, `act as <displayName>`, `<displayName> review` — 2–5 or omitted (BR-10).
- `src/app/artifacts/local-artifact-store.ts` — `Map<urn, LocalArtifact>` plus `serve(urn): Promise<{contentType, body} | 'not-found'>`. On serve: `realpath(path)` must still start with the root it was scanned under (a symlink swapped in after the scan is refused), size re-checked, then read. Also `byRoute(route)` for the HTTP routes. Replaces `FsSkillFileService` for the body path; the skill **manifest** endpoint keeps its service (bundled assets are still folder-scoped and confined by `safeJoin`, BR-4).

### Changed

- `registry-controller.ts` — `setScannedEntries(snapshot: ScanSnapshot)` replaces `setSkillEntries` (kept as a one-line adapter for one release); `buildCatalog()` = manual ++ snapshot.skills ++ snapshot.subagents; builds the `LocalArtifactStore` from the same snapshot; `RouterDeps` gains `artifacts`.
- `registry-coordinator.ts` — `doRescan()` runs both scans (skills + agents) into one snapshot and calls the one setter. The early return at `registry-coordinator.ts:180` (`skillFolders.length === 0`) becomes "no folders of either kind". Watcher reconcile keys on `skillFolders ∪ agentFolders`.
- `skill-watcher.ts:81` — the `endsWith('SKILL.md')` gate becomes "SKILL.md under a skill root, or `*.md` at depth 1 under an agent root". Renames and deletes included (watcher tests: create / edit / delete / rename for agents).
- `plugin.ts:53` — inject the agent scanner alongside the skill scanner.
- `router.ts` — `GET /subagents/<name>.md` → `artifacts.byRoute(...)`; `GET /skills/<name>/<file>` keeps its manifest/asset path but resolves `SKILL.md` through the store too. `/status.catalog` becomes `{ entries, skills, subagents, manual }`.
- `mcp/mcp-server.ts` — `get_resource` tool; body fetch = `artifacts.serve(urn)` (URN-bound, no URL parsing). `get_skill` stays registered as an alias. `search` tool description names both families.
- `types/plugin-settings.intf.ts` — `agentFolders: string[]` (default `[]`), `lastScanStats.agentCount`.
- `settings-tab.ts` — "Agent folders" list under "Skill folders", with the "these N definitions will be listed in the public catalog" line; status "415 skills · 62 subagents".

### Docs (same change, repo convention)

`Domain Model.md` (family, subagent definition, artifact store; "each skill → one entry" becomes "each skill / subagent → one entry"), `Business Rules.md` (**BR-16** — subagent family: one file → one entry, only that file is servable, URN namespace `subagents`, opt-in folders; **BR-4** gains "artifact bodies resolve by URN, never by URL text"), `Architecture.md` route list, `docs/usage.md`, README feature list.

## 5. Consumer story

In a `claude-ard` session: `search("review this draft for structure and clarity")` → top hit `type: application/ai-agent+md` → `get_resource(urn, include_body: true)` → the agent's system prompt. That is **prompt reuse, not agent execution**: the session gets the persona text (~2K tokens instead of the ~8K the 63-agent list costs every session) and can hand it to a general-purpose subagent, but the definition's `model`, tool allow-list, hooks, and isolation are not enforced by anything — the consumer must apply `x-osk-model` / `x-osk-tools` itself if it cares. Spawning by name still needs the definition registered in the harness. The vault's `AGENTS.md` "Skill discovery via ARD" section gets a paragraph saying exactly that once this ships.

## 6. Acceptance (beyond the unit specs)

Security and robustness, each as a spec:

- Every new route form requires the bearer token; the public catalog never carries `path`, roots, or the token (BR-2, BR-6).
- Traversal: `../`, URL-encoded `%2e%2e`, mixed-case, trailing dot/space segments, NUL → not-found/403, never a read outside the root.
- Symlink swapped in after the scan → refused (realpath re-check at serve time).
- Special-character file stems (spaces, unicode, `.`) → sanitised stem in the URN, original path in the store, served correctly or skipped deterministically.
- Manual resource with a URL that _looks_ like `/subagents/x.md` → `get_resource` returns no body (URN not in the store), never a local file.
- Duplicate stems across two roots → first root wins, logged once.
- File over the size cap → skipped, logged, the rest of the scan unaffected.
- Snapshot atomicity: a failing agent scan leaves the previous catalog (skills _and_ agents) fully in place; a successful one replaces both in a single index.
- Real-data smoke on the vault's 62 definitions: count, no errors, spot-check three entries' tags and queries.

## 7. Milestones

| M   | Scope                                                                                                                                                        | Done when                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `frontmatter.ts` extraction (skills switch over, no behaviour change) + `LocalArtifactStore` used by the **existing** skill body path + MCP `get_resource`   | All existing specs green; `get_skill`/`get_resource` bodies resolve by URN; the "manual URL that looks local" spec passes                                  |
| M2  | Types, URN, agent scanner + enricher, snapshot + `setScannedEntries`, coordinator/plugin wiring, `/subagents/<name>.md` route, settings field (default `[]`) | With `agentFolders` set, 62 real agents appear in the catalog, are filterable by type, and `get_resource(include_body)` returns the prompt; §6 specs green |
| M3  | Watcher gate for agent files, settings UI + public-exposure line, `/status` counts                                                                           | Adding/renaming/deleting a file under an agent root updates the catalog via Rescan and via the watcher                                                     |
| M4  | Docs, README, BR-16, history entry                                                                                                                           | validate + build green; real-data smoke recorded                                                                                                           |

M1 first because it is the change that makes today's skill body path correct and gives M2 its seam; nothing in M1 publishes a new URL. Each milestone is one conventional commit (`feat(plugin): …`); no milestone changes an existing catalog field.

## 8. Review log

Adversarial review (Codex gpt-5.6-sol, xhigh, 2026-09-01) verdict on the first draft: **rethink**. Verified against the code and acted on: D2 dropped (skill type unchanged; the shim couldn't have covered Code Mode or raw catalog readers); `agentFolders` default `[]` (the first draft would have auto-published agent inventory on upgrade); one atomic snapshot instead of two setters; URN-bound artifact store instead of URL-prefix dispatch (also fixes the existing origin-blind skill body fetch); watcher / plugin / coordinator gaps that would have made the original M1–M3 unachievable (`skill-watcher.ts:81`, `plugin.ts:53`, `registry-coordinator.ts:180`); the "same outcome" overclaim in §5; the phantom shared helpers (`asString` & co. are private — now an explicit extraction); D9 dropped; §6 acceptance list added. Not acted on: the suggestion to keep serving through a fake one-file skill manifest — a flat route is simpler than pretending a file is a folder.

## 9. Out of scope / later

- Aligning the skill media type to the spec's `application/ai-skill+md` — its own plan, with a pinned upstream schema revision and a conformance test, if at all.
- Indexing other agent formats (Codex, Gemini extensions) — same family, different scanner; add when a real source exists.
- Replacing `x-osk-*` with an `@context` vocabulary so those fields become spec-filterable — both families at once, separate plan.
- A `panels`/`teams` family (the vault's panel definitions are agents-of-agents) — wait for the subagent family to prove out.
