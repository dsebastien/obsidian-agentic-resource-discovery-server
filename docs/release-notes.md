---
title: Release notes
nav_order: 95
---

# Release notes

## Unreleased

First working version. Not yet published to the community catalog.

- Local-first ARD registry served on `127.0.0.1` with bearer-token auth.
- Skill scanning + enrichment: turns `SKILL.md` files into rich catalog entries (description, tags, capabilities, example queries).
- REST endpoints: `/.well-known/ai-catalog.json`, `POST /search`, `GET /agents`, skill file serving, `/health`.
- MCP endpoint (`POST /mcp`) with the Code Mode pattern (`search`, `get_skill`, `execute` tools + sandbox).
- BM25 lexical search by default (no model download); pluggable backend seam for future semantic search.

User-facing changelog highlights live here; the commit-level changelog is generated in `CHANGELOG.md`.
