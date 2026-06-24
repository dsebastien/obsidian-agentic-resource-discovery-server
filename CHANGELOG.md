# Changelog

All notable changes to this project will be documented in this file.

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
