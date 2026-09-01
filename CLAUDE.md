# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## UI/UX analysis

When analyzing, critiquing, or reviewing UI/UX in this repository, use the
`interface-craft` skill (its Design Critique methodology) as the analytical
frame. It composes with, not replaces, the measurement tools: clearshot for
incoming screenshots, ui-observer for rendered-layout ground truth.

## Project

Whiffle (UI wordmark "Whiffle") is a self-hosted fleet control plane for AI coding agents. A
`whiffle` daemon runs on each machine, joins a hub over tailnet/LAN via mDNS, and a browser
dashboard gives one board across every machine, project, and running agent session. Harnesses:
Claude Code, OpenCode, pi. A Telegram bridge lets the operator approve permissions from a phone.

## Design Context

- **Journey spec**: JOURNEY.md
- The dashboard's visual design is being re-derived from scratch (see
  `.design-foundations/plans/2026-08-18-whiffle-flowai-overhaul.md`). `DESIGN.md` (visual tokens)
  does not exist yet — once it is locked, it is law: apply its tokens, do not re-derive the
  palette or introduce one-off colors, fonts, or spacing outside it.
- The existing 7 route surfaces (`session`, `session/[id]`, `tools`, `rules`, `rules/[id]`,
  `project/[id]`, `usage`) are evidence of what information the product needs to show, never of
  how that information should be arranged. Structural and IA decisions come from JOURNEY.md, not
  from the incumbent layout.
