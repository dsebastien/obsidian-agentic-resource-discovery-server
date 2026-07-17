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

| Backend                 | Status                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| BM25 lexical (built-in) | **Default.** In-process, zero download.                                                            |
| Local embedding server  | Hybrid (lexical + semantic). Uses a local embedding server you run; falls back to lexical if down. |
| Hosted embedding API    | Hybrid (lexical + semantic) via a remote provider (OpenAI/Voyage/Jina/custom); bring your own key. |

The default needs no model and no network. The semantic backends add ranking quality — lexical BM25 fused (via Reciprocal Rank Fusion) with dense embeddings from an **OpenAI-compatible `/v1/embeddings`** endpoint. Nothing is bundled or downloaded by the plugin.

**Local embedding server** — embeddings from a server you already run (Ollama, LM Studio, llama.cpp, LocalAI, …). Configure:

- **Embedding server URL** — e.g. `http://localhost:11434/v1` (Ollama) or `http://localhost:1234/v1` (LM Studio). Either the base `/v1` or the full `/v1/embeddings` URL works.
- **Embedding model** — e.g. `nomic-embed-text`.

With Ollama, a typical setup is `ollama pull nomic-embed-text` and leaving the defaults.

**Hosted embedding API** — embeddings from a remote provider. Configure:

- **Provider** — `openai`, `voyage`, `jina`, or `custom`. For `custom`, also set an **API base URL** (any OpenAI-compatible gateway — Azure OpenAI, OpenRouter, a self-hosted proxy, …).
- **Model** — leave blank to use the provider default (e.g. `text-embedding-3-small` for OpenAI).
- **API key** — sent as a Bearer token; stored in plugin data, so treat it as a secret. **Privacy note:** your search queries and skill metadata (names, descriptions, tags) are sent to the provider to be embedded. Skill _bodies_ are never sent.

If the embedding endpoint is unreachable, slow to start, or rejects the key, searches **fall back to lexical automatically** — search never breaks. Changing any backend field restarts the registry. This honors the plugin's zero-mandatory-download principle: lexical stays the default.

Embeddings build in the background after each scan, so semantic ranking turns on a little after startup; until it's ready, you get lexical results. On a CPU-only embedding server a large catalog (hundreds of skills) can take roughly a minute to embed the first time — a GPU-backed server, a hosted API, or a smaller model is much faster. If the embedding server starts _after_ the plugin (or recovers from an outage), the plugin retries automatically about every 30 seconds; you can also press **Reindex** to pick it up immediately.

**Reindex** rebuilds the search index over the current catalog without rescanning your folders — useful after switching backend or to refresh a stale index. A full **Rescan skills now** also reindexes, so you only need Reindex when the catalog hasn't changed.

## Where settings are stored

Settings persist in the vault's plugin data (`.obsidian/plugins/agentic-resource-discovery-server/data.json`). The bearer token and any API keys are stored there — treat that file as sensitive. Settings are validated on load, so a corrupt or partial file falls back to safe defaults rather than failing.
