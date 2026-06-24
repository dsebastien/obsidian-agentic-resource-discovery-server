---
title: Overview
nav_order: 1
permalink: /
---

# Agentic Resource Discovery Server

Turn your Obsidian vault into a **local-first [Agentic Resource Discovery (ARD)](https://agenticresourcediscovery.org) publisher and Agent Registry**. The plugin scans your AI Skills, builds a rich `ai-catalog.json`, and runs a localhost server so AI agents on your machine can **discover and fetch exactly the skill they need** — by natural-language search — without those skills ever leaving your computer.

Built for people who have accumulated dozens or hundreds of AI Skills and MCP servers and don't want to load them all into every agent's context window. Instead of registering everything everywhere, publish them to a local catalog and let agents search it.

## Key features

- **Scans your skill folders** (Anthropic Agent Skill format — `SKILL.md` + frontmatter) at startup, without blocking Obsidian, and turns each skill into a rich catalog entry: description, tags, capabilities, and synthesized example queries.
- **Serves an ARD registry over `http://127.0.0.1`** with a required bearer token: a public catalog, natural-language search ranked 0–100 by relevance, a deterministic paginated listing, and direct file serving for each skill's body and bundled assets.
- **Exposes an MCP endpoint** using the **Code Mode** pattern: `search`, `get_skill`, and `execute` tools, where `execute` runs sandboxed JavaScript against the catalog so an agent can filter and aggregate in a single call.
- **Adds zero mandatory downloads.** The default search backend is an in-process BM25 index — no model, no network. Optionally, point it at a local or hosted embedding server for hybrid semantic search; nothing is bundled or downloaded by the plugin, and it falls back to lexical if the server is down.
- **Keeps everything on your machine.** The server binds to `127.0.0.1` only, every endpoint except the public catalog requires a bearer token, file serving is path-traversal-safe, and the `execute` sandbox has no network or filesystem access. No telemetry, no cloud.

## Quick start

1. Enable the plugin (**Settings → Community plugins**).
2. Open its settings and add one or more **skill folders** (each skill is a subfolder with a `SKILL.md`; folders may live outside the vault).
3. Click **Rescan skills now** — the status line shows how many skills were indexed.
4. Copy the **bearer token** from the **Server** section.
5. Point an agent at the registry, or connect an MCP client to `http://127.0.0.1:27182/mcp`.

See the [Usage](usage.md) guide for endpoints and examples, [Configuration](configuration.md) for every setting, and [Tips & best practices](tips.md) to get the most out of search.

## About

Created by [Sébastien Dubois](https://dsebastien.net).

If this plugin is useful to you, you can [buy me a coffee](https://www.buymeacoffee.com/dsebastien) ☕. Source and issues live on [GitHub](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server).
</content>
</invoke>
