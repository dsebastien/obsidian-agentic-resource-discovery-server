---
title: Usage
nav_order: 2
---

# Usage

The Agentic Resource Discovery Server publishes your AI Skills (and other agentic resources) as a searchable [ARD](https://agenticresourcediscovery.org) catalog served on your local machine, so AI agents can find and fetch exactly what they need.

## Getting started

1. **Enable the plugin** (Settings → Community plugins).
2. Open its settings and add one or more **skill folders**. A skill folder contains skill subfolders, each with a `SKILL.md` file (Anthropic Agent Skill format). Use the autocomplete to pick a vault folder (e.g. `.claude/skills`), or paste an absolute path for folders outside the vault.
3. Click **Rescan skills now**. The **Status** panel reports how many skills were indexed and how many failed to parse.
4. Copy the **bearer token** from the **Server** section — agents need it for every request except the public catalog.

The server starts automatically when the plugin loads and binds to `http://127.0.0.1:<port>` (default port **27182**). To stop it, disable the plugin in **Settings → Community plugins**.

## The status panel

The **Status** section at the top of the settings shows what the registry is doing right now, refreshed each time you open the tab (and after every rescan):

- **Server** — running with its URL, or stopped.
- **Catalog** — how many entries are being served.
- **Last scan** — skills indexed, parse errors, and when.
- **Search backend** and **Embeddings** — `idle`, `building…`, `ready`, or `failed` (a failed build keeps serving lexical results and is retried automatically).
- **MCP endpoint** and the tools it exposes.

Two buttons there save you assembling anything by hand:

- **Copy MCP config** — a ready-to-paste MCP server entry with the live URL and your bearer token:

    ```json
    {
        "mcpServers": {
            "obsidian-ard": {
                "url": "http://127.0.0.1:27182/mcp",
                "headers": { "Authorization": "Bearer <your-token>" }
            }
        }
    }
    ```

- **Copy curl example** — a `POST /search` call you can paste into a terminal to check everything works.

## The endpoints

| Method & path                      | Auth   | Purpose                                                                                                                                                       |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /.well-known/ai-catalog.json` | none   | The full ARD catalog (`ai-catalog.json`).                                                                                                                     |
| `GET /health`                      | none   | Liveness check (`{"status":"ok"}`).                                                                                                                           |
| `GET /status`                      | bearer | Readiness: catalog size, search backend, and whether semantic embeddings are built yet.                                                                       |
| `POST /search`                     | bearer | Natural-language search; ranked results with a `score` (0–100, relevance only). `pageSize` (or its alias `limit`, max 100, default 10) caps the result count. |
| `POST /explore`                    | bearer | Facet counts (`type`, `tags`, `capabilities`) over the catalog.                                                                                               |
| `GET /agents`                      | bearer | Deterministic, paginated listing (`?pageSize=`, `?pageToken=`, `?type=`, `?tags=`, `?capabilities=`).                                                         |
| `GET /skills/<name>`               | bearer | Manifest of a skill's servable files.                                                                                                                         |
| `GET /skills/<name>/<path>`        | bearer | A skill's `SKILL.md` or a bundled asset.                                                                                                                      |
| `POST /mcp`                        | bearer | MCP endpoint (JSON-RPC 2.0).                                                                                                                                  |

### Is search ready?

Semantic backends answer with lexical-only results while their embeddings are still being built (a full pass over a few hundred skills takes about a minute on a local Ollama). Ask the registry instead of guessing:

```bash
curl http://127.0.0.1:27182/status -H "Authorization: Bearer <token>"
# {"status":"ok","catalog":{"entries":415},"search":{"backend":"semantic","embeddings":{"state":"building","ready":false}}}
```

`embeddings` is `null` for the lexical backend (no dense signal to wait for); otherwise `state` is `idle`, `building`, `ready` or `failed`.

### Searching

```bash
curl -X POST http://127.0.0.1:27182/search \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"query":{"text":"write a conventional commit","filter":{"type":"application/ai-skill"}},"pageSize":5}'
```

`pageSize` is the ARD spec name; `limit` is accepted as an alias because the MCP `search` tool and `/explore` use that word.

Response:

```json
{
    "results": [
        {
            "identifier": "urn:air:obsidian:skills:git-commit-helper",
            "displayName": "Git Commit Helper",
            "type": "application/ai-skill",
            "url": "http://127.0.0.1:27182/skills/git-commit-helper/SKILL.md",
            "score": 87,
            "source": "http://127.0.0.1:27182"
        }
    ]
}
```

Each result's `url` points back at the registry, so an agent can `GET` the skill body next.

### Exploring what's available

`POST /explore` answers "what kinds of things are in here?" without listing everything:

```bash
curl -X POST http://127.0.0.1:27182/explore \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{}'
```

```json
{
    "total": 42,
    "facets": {
        "type": [{ "value": "application/ai-skill", "count": 39 }],
        "tags": [{ "value": "kind:analyzer", "count": 12 }],
        "capabilities": [{ "value": "git.commit.write", "count": 3 }]
    }
}
```

Narrow the faceted set with the same query and filter as `/search` (`{"query":{"text":"git","filter":{"tags":["kind:effect"]}}}`), pick specific facets with `{"facets":["tags"]}`, and cap values per facet with `{"limit":10}`.

### Listing and filtering

`GET /agents` lists entries deterministically, filtered by `type`, `tags`, and `capabilities` (repeat a parameter or comma-separate its values; an entry matches if it has **any** of the given values):

```bash
curl "http://127.0.0.1:27182/agents?tags=git,notes&type=application/ai-skill&pageSize=20" \
  -H "Authorization: Bearer <token>"
```

### Using it as an MCP server

Point an MCP client at `http://127.0.0.1:27182/mcp` with header `Authorization: Bearer <token>` — or just use **Copy MCP config** in the settings **Status** panel. Three tools are exposed:

- **`search`** — natural-language search, returns ranked metadata (no bodies).
- **`get_skill`** — fetch one entry by URN, optionally with its `SKILL.md` body.
- **`execute`** — Code Mode: write JavaScript that calls a pre-injected `registry` API (`registry.search(query, { limit, filter })`, `registry.get(id)`, `registry.listAll(filter)`) and return a result. Runs in a sandbox with no network/filesystem access, a time limit, and a memory cap — so an agent can filter and aggregate across the whole catalog in one call. `registry.search` ranks identically to `POST /search`, so the answer doesn't depend on which door the agent walks through.

## Commands

| Command                                          | Description                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Open the plugin settings → **Rescan skills now** | Re-scan the configured folders and rebuild the catalog.                       |
| Open the plugin settings → **Reindex**           | Rebuild the search index over the current catalog without rescanning folders. |

After editing a skill, click **Rescan skills now** to pick up the change, or enable **Watch folders for changes** (Skill folders section, off by default) to rescan automatically when a `SKILL.md` changes. Rescans are incremental — only files whose modification time changed are re-read — so they stay fast even with hundreds of skills. Use **Reindex** (Search backend section) only when the catalog is unchanged but you want to refresh the index — e.g. after switching backend.
