---
title: Usage
nav_order: 2
---

# Usage

The Agentic Resource Discovery Server publishes your AI Skills (and other agentic resources) as a searchable [ARD](https://agenticresourcediscovery.org) catalog served on your local machine, so AI agents can find and fetch exactly what they need.

## Getting started

1. **Enable the plugin** (Settings → Community plugins).
2. Open its settings and add one or more **skill folders**. A skill folder contains skill subfolders, each with a `SKILL.md` file (Anthropic Agent Skill format). Folders may be anywhere on disk — they don't have to be inside the vault.
3. Click **Rescan skills now**. The status line reports how many skills were indexed and how many failed to parse.
4. Copy the **bearer token** from the **Server** section — agents need it for every request except the public catalog.

The server starts automatically when the plugin loads (if enabled) and binds to `http://127.0.0.1:<port>` (default port **27182**).

## The endpoints

| Method & path                      | Auth   | Purpose                                                                         |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `GET /.well-known/ai-catalog.json` | none   | The full ARD catalog (`ai-catalog.json`).                                       |
| `GET /health`                      | none   | Liveness check (`{"status":"ok"}`).                                             |
| `POST /search`                     | bearer | Natural-language search; ranked results with a `score` (0–100, relevance only). |
| `GET /agents`                      | bearer | Deterministic, paginated listing (`?pageSize=`, `?pageToken=`, `?type=`).       |
| `GET /skills/<name>`               | bearer | Manifest of a skill's servable files.                                           |
| `GET /skills/<name>/<path>`        | bearer | A skill's `SKILL.md` or a bundled asset.                                        |
| `POST /mcp`                        | bearer | MCP endpoint (JSON-RPC 2.0).                                                    |

### Searching

```bash
curl -X POST http://127.0.0.1:27182/search \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"query":{"text":"write a conventional commit","filter":{"type":"application/ai-skill"}}}'
```

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

### Using it as an MCP server

Point an MCP client at `http://127.0.0.1:27182/mcp` with header `Authorization: Bearer <token>`. Three tools are exposed:

- **`search`** — natural-language search, returns ranked metadata (no bodies).
- **`get_skill`** — fetch one entry by URN, optionally with its `SKILL.md` body.
- **`execute`** — Code Mode: write JavaScript that calls a pre-injected `registry` API (`registry.search(q)`, `registry.get(id)`, `registry.listAll(filter)`) and return a result. Runs in a sandbox with no network/filesystem access, a time limit, and a memory cap — so an agent can filter and aggregate across the whole catalog in one call.

## Commands

| Command                                          | Description                                             |
| ------------------------------------------------ | ------------------------------------------------------- |
| Open the plugin settings → **Rescan skills now** | Re-scan the configured folders and rebuild the catalog. |

After editing a skill, click **Rescan skills now** to pick up the change (automatic file-watching is planned).
