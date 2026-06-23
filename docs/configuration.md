---
title: Configuration
nav_order: 3
---

# Configuration

All settings live in the plugin's settings tab, grouped into five sections.

## Server

| Setting      | Type             | Default                                       | Description                                                                                                             |
| ------------ | ---------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Port         | number           | `27182`                                       | The registry listens on `127.0.0.1` at this port (1024–65535).                                                          |
| Bearer token | text (read-only) | generated on first run                        | Required on every request except the public catalog. Use **Copy** / **Regenerate**.                                     |
| Publisher    | text             | `obsidian`                                    | The publisher segment of every URN (`urn:air:<publisher>:…`). Set a real domain you own if you ever publish externally. |
| Catalog name | text             | `Personal Obsidian Agentic Resource Registry` | Display name in the catalog's `host` block.                                                                             |

The **bind address is always `127.0.0.1`** and is not user-configurable — the registry is never exposed to the network.

## Skill folders

A list of folders to scan for `SKILL.md` files. Folders may be outside the vault. The status line shows the result of the last scan. **Add folder** appends a row; **Rescan skills now** re-scans and rebuilds the catalog.

## Additional resources

Manually add resources that aren't skills — MCP server cards, A2A agent cards, nested catalogs, registries. Each needs a display name, a slug (the URN's terminal segment), and either a URL or inline data.

## Search backend

| Backend                                          | Status                                                     |
| ------------------------------------------------ | ---------------------------------------------------------- |
| BM25 lexical (built-in)                          | **Default.** In-process, zero download.                    |
| Local embedding model / qmd sidecar / hosted API | Selectable but deferred — currently falls back to lexical. |

The default needs no model and no network. Semantic backends are an opt-in future enhancement; selecting one today degrades gracefully to lexical search.

## Where settings are stored

Settings persist in the vault's plugin data (`.obsidian/plugins/agentic-resource-discovery-server/data.json`). The bearer token and any API keys are stored there — treat that file as sensitive. Settings are validated on load, so a corrupt or partial file falls back to safe defaults rather than failing.
