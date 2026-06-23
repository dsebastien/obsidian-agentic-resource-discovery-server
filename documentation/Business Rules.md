# Business Rules

This document defines the core business rules. These rules MUST be respected in all implementations unless explicitly approved otherwise.

---

## Security & privacy

- **BR-1 — Loopback only.** The HTTP server binds to `127.0.0.1` exclusively. The bind address is a literal in the settings schema and resets to loopback if tampered with. It is never user-configurable to `0.0.0.0`.
- **BR-2 — Auth on everything but the public catalog.** Every endpoint requires `Authorization: Bearer <token>` except `GET /.well-known/ai-catalog.json` and `GET /health`. The catalog is public because ARD expects it to be crawlable and it contains no secrets.
- **BR-3 — Token entropy.** The bearer token is 32 random bytes (256-bit), generated once on first run, regenerable from settings.
- **BR-4 — Confined file serving.** Skill files are served only from configured skill roots, only for allowlisted extensions, and only via `safeJoin` (rejects `..`, URL-encoded traversal, and null bytes).
- **BR-5 — Sandbox isolation.** The MCP `execute` tool runs in a QuickJS WASM isolate with no network, no filesystem, no host globals (`fetch`/`require`/`process`), a wall-clock timeout, and a memory cap.
- **BR-6 — No secrets in the catalog.** The bearer token, API keys, and absolute filesystem paths never appear in `ai-catalog.json` or any response body.

## ARD conformance

- **BR-7 — Catalog shape.** `ai-catalog.json` is `{ specVersion: "1.0", host?, entries }`, served as `Content-Type: application/json` with `Access-Control-Allow-Origin: *`.
- **BR-8 — Exactly one of `url | data`** per catalog entry. Entries that can satisfy neither are skipped.
- **BR-9 — Score is relevance only.** The `0–100` search score is relevance, explicitly NOT a trust/safety/compliance signal.
- **BR-10 — `representativeQueries` is 2–5 or absent.** If fewer than two can be derived, the field is omitted rather than emitted invalid.
- **BR-11 — URN format.** Identifiers match `urn:air:<publisher>(:<segment>)+`; the default publisher is `obsidian` (configurable to a real FQDN for external publishing).

## Robustness

- **BR-12 — Non-blocking startup.** Skill scanning runs after `onLayoutReady` and yields between chunks; it must never freeze the Obsidian UI.
- **BR-13 — Tolerate bad input.** One malformed `SKILL.md`, a corrupt settings file, or a non-string YAML value must never abort a scan or crash load. Untrusted YAML values are coerced (`asString`); persisted settings are validated with per-field fallback.
- **BR-14 — Deterministic enrichment.** Catalog enrichment uses frontmatter + heuristics only — no network calls, no LLM — so scans are reproducible and offline.
- **BR-15 — Clean lifecycle.** The server stops on `onunload`; ports are released (`closeAllConnections`), and `start` retries `EADDRINUSE` to survive hot-reload.

---

## Documentation Guidelines

When a new business rule is mentioned:

1. Add it to this document immediately
2. Use a concise format (single line or brief paragraph)
3. Maintain precision - do not lose important details for brevity
4. Include rationale where it adds clarity
