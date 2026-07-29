# Release Notes

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
