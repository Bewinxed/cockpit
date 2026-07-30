# CLAUDE.md

## Read NEW.md first

This repo is mid-rework. **`NEW.md` is the single source of truth** for the
product, architecture, stack, and execution phases — read it before any work.
The rework targets the **ideal clean slate**: full cutover, no backwards
compatibility with legacy internals (user's explicit call, 2026-07-31).

## Layout

- **New spine (Phase 0 done — build here):**
  - `packages/core` — `@cockpit/core`: SDK 0.3.220 type re-exports + the
    8-verb tunnel `Envelope` + `COCKPIT_*` constants. Keep it thin; never
    re-model SDK types.
  - `packages/hub` — `@cockpit/hub`: Elysia 2 (`elysia@next`) + Effect v4
    (`effect@beta`), 4-table drizzle schema (`agents`, `instances`,
    `projects`, `credentials`), DB file `cockpit.db`, port 3456.
  - `packages/agent` — `@cockpit/agent`: Bun+Effect daemon; machineId
    fingerprint, register/heartbeat, backoff reconnect.
- **Legacy quarry (do not extend, delete per phase cadence — NEW.md §7–8):**
  `packages/{legacy-core,agent-service,hub-server,db,auth,mcp-task-tracker}`,
  most of `apps/dashboard`. The legacy stack is still the only *working* app
  until Phase 1 lands; don't break it gratuitously, don't build on it.

## Rules

- Bun, not Node.js: `bun:sqlite`, built-in `WebSocket` (never `ws`),
  `Bun.file`, `Bun.$`.
- Backend: Effect v4 + Elysia 2 betas — **the installed packages' real types
  win over NEW.md's API summaries**; when they disagree, note the drift in
  NEW.md in one line (see the drift log in §5 there).
- Claude Agent SDK pinned exactly `0.3.220`; tunnel it, never re-model it.
- New code uses `COCKPIT_*` env vars and `@cockpit/*` names only.
- Task tracking: `.flow/bin/flowctl` — rework epics are fn-13+ (fn-1…fn-12
  are legacy history). No markdown TODOs, no TodoWrite, no new planning docs;
  plans live in NEW.md.
- Verify by running the real thing (`bun run dev`, boot the hub/daemon), not
  just typecheck.

## Commands

```bash
bun install                                  # workspace deps
bun run dev                                  # legacy dashboard (port 3000) — current working app
bun run hub / bun run agent                  # legacy hub (3456) / legacy daemon
bun run --filter '@cockpit/*' typecheck      # new spine typecheck (Phase 0 done-criterion)
bun run --filter '@cockpit/hub' start        # new hub skeleton
bun run --filter '@cockpit/agent' start      # new daemon skeleton
```

## Code exploration

Prefer the wdyt MCP tools over raw grep/read: `tldr_codemap` for file
overviews, `tldr_impact` for callers/callees, `tldr_semantic_search` for
behavior search, `tldr_structure` for definitions in a file.
