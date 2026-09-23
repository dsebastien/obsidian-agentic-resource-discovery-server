---
title: Tips & best practices
nav_order: 90
---

# Tips and best practices

## Get the most out of search

Search quality comes straight from your skill frontmatter. To make a skill easy to find:

- Write a clear **`description`** — its opening clause becomes an example query.
- Fill in **`when_to_use`** with the phrasings a user might say, **in quotes**: `Use when the user says "check links", "find broken links", or "dead links".` Each quoted phrase becomes an example query verbatim, which is what the default lexical search matches best. Without quotes, a `Triggers: a, b, c` list works too.
- Set **`metadata.capability`** (e.g. `vault.links.check`) and **`metadata.kind`/`tier`/`effects`** — these become tags and search signals. The capability also becomes a query (`check links`) when it adds words the others don't have.
- A skill gets at most five example queries. If fewer than two can be derived, it gets none, and search relies on the name and description alone — so give every skill at least one quoted trigger phrase.
- Use a descriptive folder name (`developassion-analytics`, not `skill1`) — it seeds the URN and a fallback display name.

## Common use cases

- **Personal skill library for Claude / agents.** Keep hundreds of skills out of the context window; let the agent search the registry and pull only what it needs.
- **Code Mode discovery.** From an MCP client, call the `execute` tool with JavaScript that searches, filters by tag, and returns a short list — one round-trip instead of many.
- **Browsing.** `GET /agents?type=application/ai-skill` for a deterministic, paginated list.

## Troubleshooting

### The server didn't start / "port already in use"

Another process (or a stale instance) holds the port. Change the **Port** in settings, or quit whatever is using it. The server retries a few times on reload to handle the brief port-release lag.

### A skill isn't showing up

- Confirm its folder contains a file named exactly `SKILL.md`.
- Click **Rescan skills now** and check the status line for parse errors.
- If two skills share the same `name` in their frontmatter, only the first is kept (URN collision).

### `401 Unauthorized`

Every endpoint except `/.well-known/ai-catalog.json` and `/health` needs `Authorization: Bearer <token>`. Copy the current token from settings (it changes if you regenerate it).

### Changes to a skill aren't reflected

Catalog rebuilds happen on startup and when you click **Rescan skills now**. You can also enable **Watch folders for changes** (off by default) to auto-rescan when a `SKILL.md` changes — but it's best-effort and may not fire on cloud-synced/network folders, so the manual rescan stays the dependable path.
