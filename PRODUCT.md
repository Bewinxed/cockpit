# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One user: the owner-operator (a developer). They run many Claude Code sessions
at once, across several of their own machines (Linux workstation, MacBook),
over a Tailscale network. Long working hours, multiple monitors, terminal
culture. They glance at the board to see "what needs me", dive into one
transcript, approve a permission, spawn a side quest, and leave again.
No teams, no collaboration, no second audience.

## Product Purpose

Outpost (renamed from Cockpit, 2026-08-07) is a self-hosted, multi-machine
mission control for Claude Code sessions. Success: the top-level view answers
"what is everything doing right now / what needs me" in one glance, and any
session is one click from full depth (subagent trees, tool calls, diffs).

## Positioning

The only self-hosted, multi-machine control plane for Claude Code (niche
verified open 2026-07-30). Sessions run on the user's own hardware;
transcripts and control stay on their infrastructure. Anthropic's own remote
tools relay through Anthropic servers or are single-machine.

## Operating Context

- Machines are peers: a remote machine's sessions look identical to local ones.
- The daemon on each machine hosts live sessions; the hub (port 3456) relays
  frames; the dashboard (port 3000) is the one screen.
- Attention events: permission requests, dialogs/questions, blocked sessions,
  finished turns. These interrupt the user's other work; latency to noticing
  them is the core cost the product removes.
- Side quests: ephemeral forked/worktree sessions, visually distinct from
  mainline work, kept or discarded.
- Projects group sessions by repo folder; project home renders the repo's own
  markdown (files as truth, no separate document store).

## Devices

Three first-class targets (user, 2026-08-07): an ultrawide monitor (use the
width — multi-pane, never one stretched column), a 16" MacBook (reference
layout), and an iPhone (true mobile composition: sheets, thumb reach, safe
areas — not a compressed desktop). Readability is non-negotiable at all three.

## Capabilities and Constraints

- Stack: SvelteKit 2 + Svelte 5 runes, Tailwind 4, bits-ui/shadcn-svelte kit
  (only components actually used). Bun everywhere. SDK frames are tunneled
  verbatim; the UI renders SDK message types directly.
- Live data is WebSocket frames; transcripts virtualize via virtua.
- Known product gaps the redesign must close (user, 2026-08-07): spawn a
  session in an existing folder/group in place; project management surface
  (project home half-built); task surfaces (SDK TaskCreate/TaskUpdate lists);
  several specified features implemented halfway.
- Explicitly not the product: teams, channels, multi-provider harnesses,
  issue-tracker document stores.
- No auth on the hub surface (Tailscale is the trust boundary, user decision).

## Brand Commitments

- Name: **Outpost** (user decision 2026-08-07; supersedes Cockpit). UI copy
  and wordmark change now; internal identifiers follow separately.
- The prior visual world (Flexoki v2 + shadcn defaults) is explicitly
  discarded (user, 2026-08-07): treat as anti-reference.
- TX-02 mono (licensed, files in `apps/dashboard/src/fonts/`) is an asset on
  hand, not a binding commitment.
- Pinned visual direction (user, 2026-08-07): **"as if Apple designed it"** —
  macOS pro-app grammar for the web. Reference bar: Xcode, Instruments,
  Console.app, Activity Monitor. Explicitly rejected: TUI/terminal aesthetics,
  themed metaphors (radio, aviation, print). Dense, fluid, native-feeling;
  spring motion; light and dark first-class.

## Evidence on Hand

- Real live data: the user's own fleet (machines, sessions, transcripts,
  permission flows) is running and reachable; no demo data needs inventing.
- NEW.md at repo root: full rework brief, architecture, and phase plan.
- Message renderers, diff views, and flow view exist and work; their behavior
  is product truth even where their look is discarded.

## Product Principles

1. Attention first: what needs the user outranks everything else on screen.
2. Depth on demand: glance → session → subagent → tool result, no dead ends.
3. Peers, not remotes: machine locality never changes the interface.
4. Files as truth: project surfaces render the repo, never a shadow copy.
5. Density is respect: this is an operator's screen, not a marketing page.

## Accessibility & Inclusion

Keyboard-first operation matters (jump palette exists; the user lives on
keyboards). No other product-specific requirement established.
