# Release Notes

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
