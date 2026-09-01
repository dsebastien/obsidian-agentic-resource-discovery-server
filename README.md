# Agentic Resource Discovery Server

Turn your Obsidian vault into a **local-first [Agentic Resource Discovery (ARD)](https://agenticresourcediscovery.org) publisher and Agent Registry**. The plugin scans your AI Skills, builds a rich `ai-catalog.json`, and runs a localhost server so AI agents on your machine can **discover and fetch exactly the skill they need** — by natural-language search — without those skills ever leaving your computer.

> Built for people who have accumulated dozens or hundreds of AI Skills and MCP servers and don't want to load them all into every agent's context window. Instead of registering everything everywhere, publish them to a local catalog and let agents search it.

## What it does

- **Scans your skill folders** (Anthropic Agent Skill format — `SKILL.md` + frontmatter) at startup, without blocking Obsidian, and turns each skill into a rich catalog entry: description, tags, capabilities, and synthesized example queries.
- **Scans your subagent folders too** (opt-in): each `<name>.md` definition with frontmatter (`name`, `description`, `tools`, `model`) and a system-prompt body — the Claude Code `.claude/agents/` shape — becomes an entry of type `application/ai-agent+md`, so an agent can find "the editor" the same way it finds a skill.
- **Serves an ARD registry over `http://127.0.0.1`** with a required bearer token:
    - `GET /.well-known/ai-catalog.json` — the public catalog
    - `POST /search` — natural-language search, results ranked 0–100 by relevance
    - `POST /explore` — facet counts (types, tags, capabilities) so an agent can see what's available before searching
    - `GET /agents` — deterministic, paginated listing, filterable by `type`, `tags`, and `capabilities`
    - `GET /skills/<name>/SKILL.md` (and bundled assets) — so an agent can fetch a skill's body and resources directly
    - `GET /subagents/<name>.md` — a subagent definition's body
    - `GET /status` — catalog counts per family, active search backend, and whether semantic embeddings are built yet
- **Exposes an MCP endpoint** (`POST /mcp`) using the **Code Mode** pattern: `search`, `get_resource` (`get_skill` remains as an alias), and `execute` tools, where `execute` runs sandboxed JavaScript against the catalog so an agent can filter and aggregate in a single call — with the same ranking as `POST /search`.
- **Shows what's running.** The settings **Status** panel reports the server URL, catalog size, last scan, embedding state, and the MCP endpoint — with one-click **Copy MCP config** and **Copy curl example** buttons.
- **Stays fast on repeat use.** Rescans only re-parse `SKILL.md` files that actually changed, and embedding vectors are cached across reloads, so a warm restart with a semantic backend is ready immediately.
- **Adds zero mandatory downloads.** The default search backend is an in-process BM25 index (MiniSearch) — no model, no network. Optionally, point it at a local embedding server you already run (Ollama, LM Studio, …) for hybrid semantic search; nothing is bundled or downloaded by the plugin, and it falls back to lexical if the server is down.

## Status

Early but functional. The REST registry, skill scanning/enrichment, skill file serving, the MCP Code Mode endpoint, and optional semantic search (local or hosted embedding server) all work and are covered by 200+ tests. See the [technical docs](documentation/) for the architecture and design.

`isDesktopOnly` — the plugin needs Node's HTTP server and filesystem access.

## Install (manual / pre-release)

This plugin isn't in the community catalog yet. To try it:

1. Build it: `bun install && bun run build` (see [DEVELOPMENT.md](DEVELOPMENT.md)).
2. Copy `manifest.json`, `main.js`, and `styles.css` into `<vault>/.obsidian/plugins/agentic-resource-discovery-server/`.
3. Enable **Agentic Resource Discovery Server** in Obsidian → Settings → Community plugins.

## Quick start

1. Open the plugin settings.
2. Under **Skill folders**, add one or more folders that contain skills (each skill is a subfolder with a `SKILL.md`). Folders may live outside the vault.
3. Optionally, under **Subagent folders**, add a folder of agent definitions (e.g. `.claude/agents`). Everything listed becomes part of the public catalog, so it is off until you add one.
4. Click **Rescan now**. The **Status** panel shows how many skills and subagents were indexed.
5. Copy the **bearer token** from the **Server** section (or use **Copy MCP config** in **Status** to get a ready-to-paste client config).
6. Point an agent at the registry:

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
- **[Technical docs](documentation/)** — [architecture](documentation/Architecture.md), [domain model](<documentation/Domain Model.md>), and [business rules](<documentation/Business Rules.md>).
- **[Contributing](CONTRIBUTING.md)** · **[Development](DEVELOPMENT.md)**
- **What's new after updates.** After a plugin update, a one-time dialog shows the release notes you just received (including skipped versions) with ways to support development. Never shown on fresh installs or regular restarts.

## Privacy & security

Everything stays on your machine: the server binds to `127.0.0.1` only, every endpoint except the public catalog requires a bearer token, skill file serving is confined to your configured folders (path-traversal-safe), and the `execute` sandbox has no network or filesystem access. No telemetry, no cloud.

## License

[MIT](LICENSE) — by [Sébastien Dubois](https://dsebastien.net). If this is useful, you can [buy me a coffee](https://www.buymeacoffee.com/dsebastien) ☕.

<!-- other-plugins:start -->

## My other Obsidian plugins

| Plugin                                                                                      | What it does                                                                                                                       |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [Book Exporter](https://github.com/dsebastien/obsidian-book-exporter)                       | Export books (one manifest note + linked chapter notes) to EPUB and PDF via Pandoc                                                 |
| [Bookshelf Base](https://github.com/dsebastien/obsidian-bookshelf)                          | Display your notes as a visual bookshelf via a custom Bases view                                                                   |
| [Dataview Serializer](https://github.com/dsebastien/obsidian-dataview-serializer)           | Serialize Dataview queries to Markdown, and keep the Markdown representation up to date                                            |
| [Expander](https://github.com/dsebastien/obsidian-expander)                                 | Replace variables across your vault using HTML comment markers. Supports static values and dynamic functions                       |
| [Ghost Publish](https://github.com/dsebastien/obsidian-ghost-publish)                       | Publish your vault notes to a Ghost blog with configurable presets for tags, newsletters, and frontmatter conventions              |
| [Graph Explorer Base View](https://github.com/dsebastien/obsidian-graph-explorer-base-view) | A custom Bases view that renders notes as an interactive force-directed graph with explored/unexplored tracking                    |
| [Hidden Folders Access](https://github.com/dsebastien/obsidian-hidden-folders-access)       | Index hidden root-level folders (e.g. .claude) so they appear in the file tree, metadata cache, and Bases                          |
| [Journal Bases](https://github.com/dsebastien/obsidian-journal-base)                        | Custom Base views for journaling and periodic reviews                                                                              |
| [Kanban Action Planner](https://github.com/dsebastien/obsidian-kanban-action-planner)       | Render your notes as configurable Kanban boards and calendars inside Bases, with statuses, ordering, relationships, and scheduling |
| [Life Tracker](https://github.com/dsebastien/obsidian-life-tracker-base-view)               | Capture and visualize the data that matters in your life                                                                           |
| [Note Village](https://github.com/dsebastien/obsidian-note-village)                         | A 2D pixel art village where your notes become villagers you can explore and chat with using AI                                    |
| [Obsidian Starter Kit](https://github.com/DeveloPassion/obsidian-starter-kit-plugin)        | Adds strong typing support and powerful automation support for notes                                                               |
| [Remarkable Synchronizer](https://github.com/dsebastien/obsidian-remarkable-sync)           | Connect to the reMarkable cloud, list, download, and sync notebook pages as images                                                 |
| [Replicate](https://github.com/dsebastien/obsidian-replicate)                               | Use AI models with ease via the Replicate.com integration                                                                          |
| [REST and MCP server](https://github.com/dsebastien/obsidian-cli-rest)                      | Exposes CLI commands as RESTful API endpoints and an MCP server for AI tool integration                                            |
| [Time Machine](https://github.com/dsebastien/obsidian-time-machine)                         | Browse, compare, and restore previous versions of your notes using built-in file-recovery snapshots                                |
| [Transcriber](https://github.com/dsebastien/obsidian-transcriber)                           | Transcribe images to markdown using Ollama vision models                                                                           |
| [Typefully](https://github.com/dsebastien/obsidian-typefully)                               | Publish social media posts with ease using the Typefully integration                                                               |
| [Update Time](https://github.com/dsebastien/obsidian-update-time)                           | Automatically update front matter to include creation and last update times                                                        |

Everything I build is documented in [my newsletter](https://dsebastien.net/newsletter) and on [my YouTube channel](https://youtube.com/@dsebastien).

<!-- other-plugins:end -->

<!-- support-cta -->

## News & support

To stay up to date about this plugin, Obsidian in general, Personal Knowledge Management and note-taking:

- Subscribe to [my newsletter](https://dsebastien.net/newsletter)
- Subscribe to [my YouTube channel](https://youtube.com/@dsebastien)
- Join the [Knowii community](https://www.store.dsebastien.net/product/knowii-community/) and learn to organize your notes and put your knowledge to work, together with fellow knowledge workers

If this plugin is useful to you, here are the best ways to support my work ❤️:

- [Join the Knowii community](https://www.store.dsebastien.net/product/knowii-community/)
- [Become a GitHub Sponsor](https://github.com/sponsors/dsebastien)
- [Buy me a coffee](https://www.buymeacoffee.com/dsebastien)
- [Subscribe to my YouTube channel](https://youtube.com/@dsebastien)
- [Check out my products](https://store.dsebastien.net)

Found a bug or have an idea? [Open an issue](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server/issues).
