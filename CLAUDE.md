# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## Project

Cockpit (UI wordmark "Outpost") is a self-hosted fleet control plane for AI coding agents. A
`cockpit` daemon runs on each machine, joins a hub over tailnet/LAN via mDNS, and a browser
dashboard gives one board across every machine, project, and running agent session. Harnesses:
Claude Code, OpenCode, pi. A Telegram bridge lets the operator approve permissions from a phone.

## Design Context

- **Journey spec**: JOURNEY.md
- The dashboard's visual design is being re-derived from scratch (see
  `.design-foundations/plans/2026-08-18-cockpit-flowai-overhaul.md`). `DESIGN.md` (visual tokens)
  does not exist yet — once it is locked, it is law: apply its tokens, do not re-derive the
  palette or introduce one-off colors, fonts, or spacing outside it.
- The existing 7 route surfaces (`session`, `session/[id]`, `tools`, `rules`, `rules/[id]`,
  `project/[id]`, `usage`) are evidence of what information the product needs to show, never of
  how that information should be arranged. Structural and IA decisions come from JOURNEY.md, not
  from the incumbent layout.
