# CLAUDE.md

## Read NEW.md first

**`NEW.md` is the single source of truth** for the product, architecture,
stack, and phase history — read it before any work. The 2026-07 rework is
**done**: full cutover shipped, the legacy stack was deleted (commit
`20a098a`, 2026-07-31). There is exactly one stack now — everything below is
it, live and serving the user's real fleet. The product is named **Outpost**
in all UI copy; internal identifiers stay `@cockpit/*`/`COCKPIT_*` until the
coordinated rename (needs a daemon-idle window).

## Layout

- `packages/core` — `@cockpit/core`: SDK 0.3.220 type re-exports + the
  8-verb tunnel `Envelope` (`register|heartbeat|spawn|send|stop|control|
  frames|fs`) + `COCKPIT_*` constants. Keep it thin; never re-model SDK
  types.
- `packages/hub` — `@cockpit/hub`: Elysia 2 (`elysia@next`) + Effect v4
  (`effect@beta`), drizzle schema (`agents`, `instances`, `projects`,
  `credentials`), DB file `cockpit.db`, port 3456. WS: `/ws` (daemons),
  `/ws/dashboard` (browsers).
- `packages/agent` — `@cockpit/agent`: Bun+Effect daemon; hosts live SDK
  sessions, machine-scoped control functions, `fs` verb (list/read/write).
  **NEVER restart a running daemon — it hosts live sessions.** Changes to
  this package wait for a user-granted idle window.
- `packages/auth`, `packages/cli` — keychain/login helpers, CLI entry.
- `apps/dashboard` — `@cockpit/dashboard`: SvelteKit 2 + Svelte 5 runes +
  Tailwind 4, port 3000. The redesigned Outpost UI (2026-08); design system
  in `apps/dashboard/DESIGN.md`, product record in `PRODUCT.md`.

## Rules

- Bun, not Node.js: `bun:sqlite`, built-in `WebSocket` (never `ws`),
  `Bun.file`, `Bun.$`.
- Backend: Effect v4 + Elysia 2 betas — **the installed packages' real types
  win over NEW.md's API summaries**; when they disagree, note the drift in
  NEW.md in one line (see the drift log in §5 there).
- Claude Agent SDK pinned exactly `0.3.220`; tunnel it, never re-model it.
- New code uses `COCKPIT_*` env vars and `@cockpit/*` names only.
- No markdown TODOs, no TodoWrite, no new planning docs; plans live in
  NEW.md.
- Verify by running the real thing (`bun run dev`, boot the hub/daemon), not
  just typecheck.

## Commands

```bash
bun install                                  # workspace deps
bun run dev                                  # dashboard (port 3000)
bun run hub                                  # hub (port 3456)
bun run agent                                # daemon — do NOT run/restart against the live fleet
bun run typecheck                            # workspace typecheck
```

## Code exploration

Prefer the wdyt MCP tools over raw grep/read: `tldr_codemap` for file
overviews, `tldr_impact` for callers/callees, `tldr_semantic_search` for
behavior search, `tldr_structure` for definitions in a file.
