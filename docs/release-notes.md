# Release Notes

## 1.0.0 (2026-09-01)

### ⚠ BREAKING CHANGES

- **plugin:** minAppVersion moves 1.8.7 -> 1.13.0.

Ports the 598-line imperative settings tab to the declarative API
following the template (2575a89) and the AI Editor port's structure:

- Scalars are `control` definitions bridged by key through
  getControlValue/setControlValue; every write still goes through
  plugin.updateSettings, the single persistence path. setControlValue
  rejects on failure so the pane rolls back to the stored truth.
- Skill folders and manual resources are SettingDefinitionLists with
  native add/delete. Deletion uses the LIVE index per the framework
  contract; resource VALUE keys use the stable resource id
  (resource.<id>.<field>), never an index, so a drag/delete can not
  reroute a write.
- Each manual resource is a navigable sub-page (type/name/slug/URL),
  with displayValue mirroring the resource type on the entry.
- Search backend sections switch via visible() predicates instead of
  conditional re-renders; the missing-base-URL warning is its own
  conditionally-visible row.
- Bearer token, API key (no password control type exists), status grid,
  client-setup buttons, rescan and reindex stay imperative render/action
  rows — each writing only inside its own settingEl.
- Port slider replaced by a number control with min/max/step + validate
  and deliberately NO defaultValue (a cleared field is refused inline,
  not silently reset).
- plugin.ts: settings field carries `override` (1.13 typings declare it),
  and the background-rescan refresh calls settingTab.update() instead of
  display() — display() is never called under the declarative API.
- Guard spec + AGENTS.md "Declarative settings" section ported from the
  template. obsidian typings 1.12.0 -> 1.13.1.

Verified in the live vault via the obsidian CLI: plugin reloads clean,
registry running, catalog rebuilt (410 skills), getSettingDefinitions
returns the full tree, control-value bridge reads live data correctly,
and data.json is byte-identical apart from the plugin's own
lastScanStats bookkeeping — no setting lost. Settings pane rendering
still needs eyes-on verification in Obsidian (nothing in CI renders it).

### Features

- **build:** fail the build on a lockfile the catalog review cannot parse
- **build:** make the rule floor check that it is still wired in
- **build:** refuse commits that loosen the rules instead of fixing the finding
- **plugin:** declare settings via getSettingDefinitions (Obsidian 1.13)
- **plugin:** publish subagent definitions as a second catalog family
- **plugin:** show what's new in a tab instead of a modal dialog
- **plugin:** surface support CTAs everywhere users can see them

### Bug Fixes

- **build:** inline the changelog via a define, stop shrinking the brand list
- **build:** port template catalog-reviewer + toolchain fixes (2.8.0+)
- **plugin:** harden the declarative settings port per external review
- **plugin:** honour limit on POST /search and expose readiness via GET /status
- **plugin:** make /status report readiness and align the search limit contract
- **plugin:** persist settings before committing them to memory
- **plugin:** resources could not be removed — pages get no onDelete button
- **plugin:** serialize settings writes — overlapping edits lost data

## 0.2.0 (2026-07-29)

### Features

- **plugin:** add a status panel with copy-ready client config [#7](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/issues/7)
- **plugin:** add POST /explore faceting and richer GET /agents filtering [#5](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/issues/5)
- **plugin:** rank sandbox registry.search like the lexical backend

### Performance Improvements

- **plugin:** cache embedding vectors across reloads
- **plugin:** make skill rescans incremental

## 0.1.0 (2026-07-27)

### Features

- **plugin:** show a what's new dialog once after plugin updates

### Bug Fixes

- **plugin:** compile against public Obsidian typings (1.12.0)

## 0.0.2 (2026-07-17)

### Bug Fixes

- **docs:** correct Pages config and complete docs site

## 0.0.1 (2026-06-24)

### Features

- **plugin:** add Reindex button to rebuild the search index in place
- **plugin:** embedding auto-retry + hosted-api embedding backend
- **plugin:** hybrid semantic search core (lexical + dense vectors, RRF)
- **plugin:** implement M1 registry server with catalog + lexical search
- **plugin:** implement M2 skill scanning and enrichment
- **plugin:** implement M3 skill file serving
- **plugin:** implement M4 MCP endpoint with Code Mode
- **plugin:** M5 search-backend factory + M6 EADDRINUSE retry
- **plugin:** opt-in skill-folder watching + verified MCP client e2e
- **plugin:** reuse shared FolderSuggest for skill folder inputs
- **plugin:** scaffold ARD server plugin with settings skeleton
- **plugin:** semantic search via a local embedding server (no bundle, no download)

### Bug Fixes

- **plugin:** guard against the registry resurrecting after unload
- **plugin:** skip embedder for empty catalog in SemanticSearchBackend
