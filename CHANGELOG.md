# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/compare/0.2.0...1.0.0) (2026-09-01)

### ⚠ BREAKING CHANGES

* **plugin:** minAppVersion moves 1.8.7 -> 1.13.0.

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

* **build:** fail the build on a lockfile the catalog review cannot parse ([1f055ab](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/1f055ab01311b6d853831e15ba6bb661e8315e1e))
* **build:** make the rule floor check that it is still wired in ([c9808f5](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/c9808f5bd230aff12830cdd69ed36433cf44ab92))
* **build:** refuse commits that loosen the rules instead of fixing the finding ([8d93600](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/8d936002a12be3eaefa6335c9c944b07fee088c1))
* **plugin:** declare settings via getSettingDefinitions (Obsidian 1.13) ([c5ee56e](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/c5ee56e799925af2c907167479bad34ec9a3c0e3))
* **plugin:** publish subagent definitions as a second catalog family ([de97f83](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/de97f8370aad1188776888619ff326f0b6011466))
* **plugin:** show what's new in a tab instead of a modal dialog ([c0f64a3](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/c0f64a38b66c25249eaafdbf0402d553580bf787))
* **plugin:** surface support CTAs everywhere users can see them ([8ddd0f7](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/8ddd0f71a76fc361df047ec92cb8bc4d0538ca2b))

### Bug Fixes

* **build:** inline the changelog via a define, stop shrinking the brand list ([0bcbf84](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/0bcbf84b1e5f19fbab1227c354d76740fb21e968))
* **build:** port template catalog-reviewer + toolchain fixes (2.8.0+) ([9d25aeb](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/9d25aebb5520212e0037ea7c0bea88d09e3659bd))
* **plugin:** harden the declarative settings port per external review ([88eb550](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/88eb550cc2e672757c76f07622f5c28479758405))
* **plugin:** honour limit on POST /search and expose readiness via GET /status ([9705b18](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/9705b189f739bd1e85de852d4c333b449bf8fe13))
* **plugin:** make /status report readiness and align the search limit contract ([5265c57](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/5265c57cf5577285bb2dd8410d7aee5d36ed63ec))
* **plugin:** persist settings before committing them to memory ([c9e9a68](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/c9e9a6869ba481c00a34fe8691bea8d6c51bff0c))
* **plugin:** resources could not be removed — pages get no onDelete button ([c96ede3](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/c96ede30ea982acefe5201c7d4682b9f1db0d463))
* **plugin:** serialize settings writes — overlapping edits lost data ([0f86267](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/0f86267d83ed256b03062373e14d2954f0ee4c9b))

## [0.2.0](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/compare/0.1.0...0.2.0) (2026-07-29)

### Features

* **plugin:** add a status panel with copy-ready client config ([858ea46](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/858ea4697a268069315df24825bd2b0eefa72796)), closes [#6](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/issues/6) [#7](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/issues/7)
* **plugin:** add POST /explore faceting and richer GET /agents filtering ([4338e65](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/4338e6552dead5dfef725c3c3c1433f431af879b)), closes [#4](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/issues/4) [#5](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/issues/5)
* **plugin:** rank sandbox registry.search like the lexical backend ([6c06359](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/6c06359d49507346f8aa1232d3cf9e59ce7c10d2))

### Performance Improvements

* **plugin:** cache embedding vectors across reloads ([eb8c60c](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/eb8c60ca38b1b8713539bec6e83548ef1e5c8c5d))
* **plugin:** make skill rescans incremental ([5677815](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/5677815d2df69965376a4d7d1d041f9fcbab4a8f))

## [0.1.0](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/compare/0.0.2...0.1.0) (2026-07-27)

### Features

* **plugin:** show a what's new dialog once after plugin updates ([0d3b2d4](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/0d3b2d4e5ce97512fd5dfdf0553f96c18023c823))

### Bug Fixes

* **plugin:** compile against public Obsidian typings (1.12.0) ([c46e132](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/c46e13294a44e6ce9b5032b91bacd3ef04981d9e))

## [0.0.2](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/compare/0.0.1...0.0.2) (2026-07-17)

### Bug Fixes

* **docs:** correct Pages config and complete docs site ([bad4826](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/bad482618645fd3d2c4da916f36ff01ba15f01aa))

## 0.0.1 (2026-06-24)

### Features

* **plugin:** add Reindex button to rebuild the search index in place ([a4f9377](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/a4f9377a12f9ea497c5c1f49224ebf09ddf922a2))
* **plugin:** embedding auto-retry + hosted-api embedding backend ([4286c7f](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/4286c7f0835bedfecb8eb2b359619de4c3f47d87))
* **plugin:** hybrid semantic search core (lexical + dense vectors, RRF) ([5da3fb3](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/5da3fb32e8288b1326a3cfaccdbb7413367261f7))
* **plugin:** implement M1 registry server with catalog + lexical search ([c0db2c0](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/c0db2c0543c603f1fa9db865478b9919f8a4975a))
* **plugin:** implement M2 skill scanning and enrichment ([8eb514a](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/8eb514a0b1f4347375f7efdf2f9ee965f6a8f97f))
* **plugin:** implement M3 skill file serving ([c771ccf](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/c771ccf749c6e5fc4d3b761035ceaf4c3b058a25))
* **plugin:** implement M4 MCP endpoint with Code Mode ([215f5c8](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/215f5c8c32af2568148a5af67ba704c278bb14f2))
* **plugin:** M5 search-backend factory + M6 EADDRINUSE retry ([ef2dad8](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/ef2dad8a8540ac46ce709e0cdf9212a090b73280))
* **plugin:** opt-in skill-folder watching + verified MCP client e2e ([2722036](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/2722036a4a80cda6d52b953718924881749404d4))
* **plugin:** reuse shared FolderSuggest for skill folder inputs ([c1811d8](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/c1811d88015239bed3ddcdde2beab65d6a19ea45))
* **plugin:** scaffold ARD server plugin with settings skeleton ([a8fe93b](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/a8fe93bfa51d7f02f2a1562e211e11342a2e6044))
* **plugin:** semantic search via a local embedding server (no bundle, no download) ([8a3676d](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/8a3676de70be4ac6bd960504b9bd4a19f76ce7d9))

### Bug Fixes

* **plugin:** guard against the registry resurrecting after unload ([ccfa366](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/ccfa366ffb5adf8d194b371ab1ac3f0d79bd3769))
* **plugin:** skip embedder for empty catalog in SemanticSearchBackend ([3a472e4](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/commit/3a472e4fbdc3472fbfab8ad55ec7851e15935db5))




