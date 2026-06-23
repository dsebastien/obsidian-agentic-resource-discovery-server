# Agentic Resource Discovery Server

Turn your Obsidian vault into a **local-first [Agentic Resource Discovery (ARD)](https://agenticresourcediscovery.org) publisher and Agent Registry**. The plugin scans your AI Skills, builds a rich `ai-catalog.json`, and runs a localhost server so AI agents on your machine can **discover and fetch exactly the skill they need** — by natural-language search — without those skills ever leaving your computer.

> Built for people who have accumulated dozens or hundreds of AI Skills and MCP servers and don't want to load them all into every agent's context window. Instead of registering everything everywhere, publish them to a local catalog and let agents search it.

## What it does

- **Scans your skill folders** (Anthropic Agent Skill format — `SKILL.md` + frontmatter) at startup, without blocking Obsidian, and turns each skill into a rich catalog entry: description, tags, capabilities, and synthesized example queries.
- **Serves an ARD registry over `http://127.0.0.1`** with a required bearer token:
    - `GET /.well-known/ai-catalog.json` — the public catalog
    - `POST /search` — natural-language search, results ranked 0–100 by relevance
    - `GET /agents` — deterministic, paginated listing
    - `GET /skills/<name>/SKILL.md` (and bundled assets) — so an agent can fetch a skill's body and resources directly
- **Exposes an MCP endpoint** (`POST /mcp`) using the **Code Mode** pattern: `search`, `get_skill`, and `execute` tools, where `execute` runs sandboxed JavaScript against the catalog so an agent can filter and aggregate in a single call.
- **Adds zero mandatory downloads.** The default search backend is an in-process BM25 index (MiniSearch) — no model, no network. Optionally, point it at a local embedding server you already run (Ollama, LM Studio, …) for hybrid semantic search; nothing is bundled or downloaded by the plugin, and it falls back to lexical if the server is down.

## Status

Early but functional. The REST registry, skill scanning/enrichment, skill file serving, and the MCP Code Mode endpoint all work and are covered by ~160 tests. See [`documentation/plans/implementation-plan.md`](documentation/plans/implementation-plan.md) for the full design and milestone status.

`isDesktopOnly` — the plugin needs Node's HTTP server and filesystem access.

## Install (manual / pre-release)

This plugin isn't in the community catalog yet. To try it:

1. Build it: `bun install && bun run build` (see [DEVELOPMENT.md](DEVELOPMENT.md)).
2. Copy `manifest.json`, `main.js`, and `styles.css` into `<vault>/.obsidian/plugins/agentic-resource-discovery-server/`.
3. Enable **Agentic Resource Discovery Server** in Obsidian → Settings → Community plugins.

## Quick start

1. Open the plugin settings.
2. Under **Skill folders**, add one or more folders that contain skills (each skill is a subfolder with a `SKILL.md`). Folders may live outside the vault.
3. Click **Rescan skills now**. The status line shows how many skills were indexed.
4. Copy the **bearer token** from the **Server** section.
5. Point an agent at the registry:

```bash
# The public catalog needs no auth:
curl http://127.0.0.1:27182/.well-known/ai-catalog.json

# Search needs the bearer token:
curl -X POST http://127.0.0.1:27182/search \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"query":{"text":"summarize a long note"}}'
```

To use it as an MCP server, point your MCP client at `http://127.0.0.1:27182/mcp` with the bearer token. See the [user guide](docs/usage.md) for details.

## Documentation

- **[User guide](docs/usage.md)** — usage, [configuration](docs/configuration.md), [tips](docs/tips.md).
- **[Technical docs](documentation/)** — [architecture](documentation/Architecture.md), [domain model](<documentation/Domain Model.md>), [business rules](<documentation/Business Rules.md>), and the [implementation plan](documentation/plans/implementation-plan.md).
- **[Contributing](CONTRIBUTING.md)** · **[Development](DEVELOPMENT.md)**

## Privacy & security

Everything stays on your machine: the server binds to `127.0.0.1` only, every endpoint except the public catalog requires a bearer token, skill file serving is confined to your configured folders (path-traversal-safe), and the `execute` sandbox has no network or filesystem access. No telemetry, no cloud.

## License

[MIT](LICENSE) — by [Sébastien Dubois](https://dsebastien.net). If this is useful, you can [buy me a coffee](https://www.buymeacoffee.com/dsebastien) ☕.
