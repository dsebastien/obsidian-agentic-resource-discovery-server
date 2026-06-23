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

A list of folders to scan for `SKILL.md` files. Each input has folder autocomplete: start typing to pick a **vault** folder (e.g. `.claude/skills`), or paste an **absolute** path for folders outside the vault. Vault-relative picks are resolved against your vault location automatically.

- **Add folder** appends a row; the trash icon removes one.
- **Watch folders for changes** (off by default) auto-rescans when a `SKILL.md` changes — best-effort; may not fire on cloud-synced/network folders.
- **Rescan skills now** re-scans the folders and rebuilds the catalog. The status line shows the last scan's skill/error counts.

## Additional resources

Manually add resources that aren't skills — MCP server cards, A2A agent cards, nested catalogs, registries. Each needs a display name, a slug (the URN's terminal segment), and either a URL or inline data.

## Search backend

| Backend                       | Status                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| BM25 lexical (built-in)       | **Default.** In-process, zero download.                                                             |
| Local embedding model         | Hybrid (lexical + on-device semantic) — experimental; falls back to lexical until the model ships.  |
| qmd sidecar / hosted API      | Selectable but deferred — currently falls back to lexical.                                          |

The default needs no model and no network. The **local embedding model** backend adds semantic ranking (lexical BM25 fused with on-device sentence embeddings); it loads its model lazily and **degrades to lexical automatically** while the model is loading or if it can't load — so search never breaks. The embedding runtime isn't bundled in the current build yet, so this option behaves as lexical for now. Semantic backends honor the plugin's zero-mandatory-download principle: lexical stays the default.

**Reindex** rebuilds the search index over the current catalog without rescanning your folders — useful after switching backend or to refresh a stale index. A full **Rescan skills now** also reindexes, so you only need Reindex when the catalog hasn't changed.

## Where settings are stored

Settings persist in the vault's plugin data (`.obsidian/plugins/agentic-resource-discovery-server/data.json`). The bearer token and any API keys are stored there — treat that file as sensitive. Settings are validated on load, so a corrupt or partial file falls back to safe defaults rather than failing.
