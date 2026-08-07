---
name: Outpost
description: Mission control for Claude Code — a warm, dense operator's screen that is calm when idle and loud only where a human is needed.
colors:
  action-olive: "oklch(0.52 0.1 120)"
  action-olive-night: "oklch(0.7 0.1 122)"
  on-action: "oklch(0.995 0.002 84)"
  on-action-night: "oklch(0.16 0.008 60)"
  canvas-day: "oklch(0.977 0.003 84)"
  canvas-night: "oklch(0.205 0.008 60)"
  surface-day: "oklch(1 0 0)"
  surface-night: "oklch(0.25 0.009 58)"
  surface-lifted-night: "oklch(0.275 0.01 58)"
  rail-day: "oklch(0.965 0.004 82)"
  rail-night: "oklch(0.225 0.008 60)"
  fill-day: "oklch(0.955 0.004 80)"
  fill-night: "oklch(0.285 0.009 58)"
  ink-day: "oklch(0.235 0.01 55)"
  ink-night: "oklch(0.945 0.004 84)"
  ink-muted-day: "oklch(0.525 0.014 62)"
  ink-muted-night: "oklch(0.72 0.012 70)"
  hairline-day: "oklch(0.912 0.006 78)"
  hairline-night: "oklch(1 0 0 / 5%)"
  control-edge-night: "oklch(1 0 0 / 13%)"
  idle-green: "oklch(0.63 0.135 160)"
  idle-green-night: "oklch(0.70 0.125 160)"
  working-amber: "oklch(0.74 0.145 78)"
  working-amber-night: "oklch(0.79 0.135 80)"
  needs-you-red: "oklch(0.577 0.215 27)"
  needs-you-red-night: "oklch(0.66 0.185 25)"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Public Sans Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.022em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Public Sans Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.014em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Public Sans Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Public Sans Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.002em"
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Public Sans Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "0.008em"
  mono:
    fontFamily: "'TX-02', ui-monospace, 'SF Mono', monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.35
    fontFeature: "font-variant-ligatures: none; font-variant-numeric: tabular-nums"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "20px"
  2xl: "24px"
  pill: "40px"
  circle: "9999px"
spacing:
  hair: "4px"
  tight: "6px"
  row: "12px"
  card: "16px"
  page: "16px"
  page-wide: "24px"
  stack: "20px"
components:
  button-primary:
    backgroundColor: "{colors.action-olive}"
    textColor: "{colors.on-action}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    height: "36px"
    padding: "0 12px"
  button-primary-hover:
    backgroundColor: "oklch(0.52 0.1 120 / 0.8)"
  button-sm:
    height: "32px"
    padding: "0 12px"
    rounded: "{rounded.pill}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-day}"
    rounded: "{rounded.pill}"
    height: "36px"
    padding: "0 12px"
  button-outline:
    textColor: "{colors.ink-day}"
    rounded: "{rounded.pill}"
    height: "32px"
    padding: "0 12px"
  icon-chip:
    rounded: "{rounded.circle}"
    size: "32px"
    padding: "0"
  badge-secondary:
    backgroundColor: "oklch(0.945 0.005 78)"
    textColor: "oklch(0.32 0.012 55)"
    typography: "{typography.micro}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  card-surface:
    backgroundColor: "{colors.surface-day}"
    textColor: "{colors.ink-day}"
    rounded: "{rounded.xl}"
    padding: "16px"
  session-row:
    textColor: "{colors.ink-day}"
    rounded: "{rounded.lg}"
    height: "36px"
    padding: "6px 12px"
  input-field:
    backgroundColor: "{colors.surface-day}"
    textColor: "{colors.ink-day}"
    rounded: "{rounded.lg}"
    padding: "8px 14px"
---

# Design System: Outpost

## Overview

**Creative North Star: "The Daylight Studio"**

One warm room, lit two ways. In the day the canvas is warm white and white
surfaces float on soft warm-inked shadows; at night it is the same room in warm
charcoal, surfaces stepping *lighter* rather than the palette inverting. Nothing
about the geometry, density, or hierarchy changes between them — light and dark
are equal citizens, not a theme and its afterthought.

The direction is pinned (user, 2026-08-07): **Apple × Airbnb**. From Apple come
translucent chrome materials, size-specific typography, interruptible motion,
and pro-app density — the reference bar is Instruments and Console.app, not a
marketing page. From Airbnb come the warmth: warm neutrals rather than blue-grey,
generous soft radii, real soft depth, humane row grammar. Explicit
anti-references: TUI/terminal aesthetics, themed metaphors, and the discarded
Flexoki-plus-shadcn-defaults world that preceded this one.

Motion is part of the world, not decoration. Entrances and state changes ride
`--ease-out-expo` `cubic-bezier(0.16, 1, 0.3, 1)` (an approximated critically
damped spring) or Svelte's `quintOut`; exits are shorter than entrances
(140–160ms out, 180–240ms in); nothing exceeds ~320ms; pointer-down gets
feedback before release. `prefers-reduced-motion` clamps every duration to one
120ms beat and removes travel — it never zeroes durations, because stillness is
what the setting asks for, not instant swaps.

**Key Characteristics:**
- Warm neutral canvas in both modes; a single olive is the only action colour.
- Depth from elevation and surface step; hairlines separate, they never outline.
- Three status hues reserved for session state, red only where a human is needed.
- 15px UI base, 12px floor, tracking laddered per size; TX-02 mono for data only.
- Three first-class widths: ultrawide (multi-pane, auto-fit tracks), 16" laptop
  (reference), iPhone (sheets and a thumb bar, never a shrunken desktop).

## Colors

Warm neutrals carrying one action hue and three reserved state hues; every value
is authored in OKLCH and the frontmatter is the normative source.

### Primary
- **Action Olive** (`{colors.action-olive}` day / `{colors.action-olive-night}`
  night): the one colour that means "this acts". Primary buttons, links, the
  active thumb-bar tab, the text caret, `::selection` (25% day / 35% night), and
  the global focus ring. It is deliberately at hue 120 so no state hue can be
  mistaken for brand.

### Secondary
Reserved state hues. They are semantics, never decoration, and never appear on
anything that is not a session state or a server status.
- **Idle Green** (`{colors.idle-green}`): a session at rest. Sits cooler (hue 160)
  than the olive so "healthy" never reads as "branded".
- **Working Amber** (`{colors.working-amber}`): a session mid-turn; pulses.
- **Needs-You Red** (`{colors.needs-you-red}`): a blocked session, a failed
  session, and the header's pending-permission count. Nothing else.

### Neutral
- **Warm White Canvas** (`{colors.canvas-day}`) / **Warm Charcoal Canvas**
  (`{colors.canvas-night}`): the page. Cards sit *on* it, never flush with it.
- **Floating Surface** (`{colors.surface-day}` pure white day /
  `{colors.surface-night}` a step lighter than the canvas at night): cards,
  popovers, the fleet board's group sections. `{colors.surface-lifted-night}` is
  the extra night step popovers take so they read above cards.
- **Rail** (`{colors.rail-day}` / `{colors.rail-night}`): the sidebar sits on the
  canvas, half a step off it — it is not a card.
- **Ink** (`{colors.ink-day}` / `{colors.ink-night}`) and **Muted Ink**
  (`{colors.ink-muted-day}` / `{colors.ink-muted-night}`): body text and the
  secondary register (paths, counts, state words at rest).
- **Hairline** (`{colors.hairline-day}` / `{colors.hairline-night}`): row seams
  only. The night value is 5% white on purpose — 9% read as an outline drawn
  around every card. Controls that need a visible edge at night take
  `{colors.control-edge-night}` (13%) instead.

### Named Rules
**The One Action Rule.** Olive means "this acts", and only that. If a surface
uses olive for emphasis, ornament, or a chart series that isn't the primary
series, it is wrong.

**The Reserved Hue Rule.** Green, amber, and red belong to session state
(idle / working / needs-you) and MCP server status. They are never a palette to
pick from for a new surface.

**The Calm Red Rule.** Red appears only where a human is actually required: a
blocked permission, a failed session, the count of either. The attention queue
of six blocked sessions is six calm rows with one dot each — never six red
banners. Tinted backgrounds stay at 10–15% (`bg-error/10`, `bg-error/15`).

## Typography

**UI Font:** system SF stack — `-apple-system, BlinkMacSystemFont`, then
**Public Sans Variable** (SF-adjacent) so Linux and Windows read as the same
product.
**Mono Font:** **TX-02** (licensed, self-hosted, ligatures off), fallback
`ui-monospace, 'SF Mono'`.

**Character:** neutral, optically-sized, pro-app. The personality is in the
tracking ladder and the density, not in the faces. Recorded trade-off: the
development machine is Linux, so the built product renders Public Sans, not SF —
accepted for now; do not re-tune metrics against Public Sans.

### Hierarchy
Use the utilities, not raw sizes: the tracking is inside them.
- **`text-display`** (650, 28px, 1.15, −0.022em): page-level titles. Rare — two
  uses in the whole build.
- **`text-title`** (600, 20px, 1.25, −0.014em): route headers ("Fleet"), the
  wordmark, sheet titles.
- **`text-body`** (400, 15px, 1.5, 0): the UI base, set on `body`. Row titles,
  permission summaries.
- **`text-caption`** (400, 13px, 1.4, +0.002em): secondary prose. Carries
  `--muted-foreground` itself, so don't add a colour class.
- **`text-micro`** (400, 12px, 1.35, +0.008em): the workhorse — paths, counts,
  state words, chip labels. Most-used utility in the app.

### Named Rules
**The Mono-Is-Data Rule.** TX-02 renders code, paths, commands, IDs, and
measurements. Never UI labels, never headings, never a costume.

**The 12px Floor Rule.** `text-micro` (12px) is the smallest text that ships.
Nothing renders below it, at any density, on any target.

**The Tracking-By-Size Rule.** Tracking is size-specific: negative at display and
title, zero at body, positive at caption and micro. Never set a global
`letter-spacing`.

**The Tabular Rule.** Any number that sits in a column, updates in place, or is
compared gets `tabular-nums` (`table` and `[data-tabular]` get it automatically).

## Layout

App shell: a 48px translucent header (`h-12`, `material-chrome`, with a
`scroll-edge-b` fade rather than a divider), a resizable left rail (default 288px,
clamped 216–520px, persisted in `localStorage`, pointer-drag plus arrow-key
resize), the route as the only scroller, and — on `/session/*` at phone widths —
a thumb bar as the last row of the column, not a fixed overlay.

Page rhythm: `p-4 sm:p-6` around a `max-w-5xl` column that releases to
`max-w-none` at `2xl`. Sections stack at `gap-5`; the board grids at `gap-4`.
Card interiors are `px-4 py-3`; rows are `px-3 py-1.5`.

Responsive behaviour, in the three sizes the product commits to:
- **Ultrawide (`2xl`, ≥1536px):** the board switches to
  `repeat(auto-fit, minmax(620px, 1fr))` and the width cap is dropped. Verb
  labels in the session toolbar appear only here; below it, icon + tooltip.
- **Laptop (`md`–`xl`):** reference layout —
  `repeat(auto-fit, minmax(480px, 1fr))`, rail visible, no thumb bar.
- **Phone (`<md`):** rail becomes a left `material-panel` sheet, the spawn panel
  becomes a bottom sheet, action rows wrap to their own line rather than
  truncating the reason above them, and the thumb bar carries Fleet / New session
  / Jump at `min-h-11` (44pt) with `env(safe-area-inset-bottom)` padding.

### Named Rules
**The Auto-Fit Rule.** Multi-card boards use `auto-fit` with a `minmax` floor,
never `auto-fill` (which pins cards to the floor width and leaves bare tracks on
an ultrawide) and never one stretched column.

**The 36px Row Rule.** A list row is `min-h-9` and reads left to right: state dot,
kind glyph (if any), title, path in mono micro, then state word and time pushed
right with `ml-auto`. The hover band is the full card width; the *content* stops
at `max-w-3xl` so an ultrawide never strands the state word a screen from the
name. Under width pressure the path yields three times as fast as the title
(`shrink-[3]`) and truncates from the left (`[direction:rtl]` + `<bdi>`), because
the leaf tells two checkouts apart.

## Elevation & Depth

Depth is elevation plus a surface step, never a border. Four warm-inked shadows
in light (offset + soft blur, tinted `oklch(0.25 0.02 55)`), the same ladder in
plain black at night, where the surface step does most of the work. Borders are
hairlines between rows (`border-border/50`–`/60`) and seams under chrome — they
do not trace the outside of anything that already floats.

Translucency is structural, not decorative: `material-chrome` (0.72–0.78 alpha,
20px blur, 1.6 saturate) for the app header, rail header, and thumb bar;
`material-panel` (1.4× blur) for sheets, the spawn panel, and menus that float
over content. `prefers-reduced-transparency: reduce` drops both to the opaque
background with no blur.

### Shadow Vocabulary
- **`shadow-sm`** (`0 1px 2px …/0.05`): inputs, in-transcript cards, kbd hints.
- **`shadow-md`** (`0 2px 8px …/0.07, 0 1px 2px …/0.05`): the default for a card
  that sits on the canvas — board group sections, the attention queue.
- **`shadow-lg`** (`0 8px 28px …/0.10, 0 2px 8px …/0.06`): popovers, floating
  docks over the transcript.
- **`shadow-xl`** (`0 24px 64px …/0.16, 0 6px 16px …/0.08`): sheets and the spawn
  panel — the only surfaces that fully leave the page.

### Named Rules
**The No-Outline Rule.** A surface with a shadow does not also get a border.
Cards are `rounded-xl bg-card shadow-md`, full stop. Hairlines exist to separate
siblings inside a card, not to draw its edge.

**The Night Seam Rule.** At night the hairline is 5% white — a seam, not an
outline. When a control genuinely needs a visible edge in the dark, it takes
`--input` (13%), not a heavier `--border`.

## Shapes

Soft, Airbnb-warm geometry on a ladder built from `--radius` (10px): `sm` 6px,
`md` 10px, `lg` 14px (rows, small controls, inline chips), `xl` 20px (cards,
popovers, group sections), `2xl` 24px (sheets and the spawn panel, top corners
only on the mobile sheet). Circles are reserved for status dots, avatars, favicon
chips, and progress fills.

Build truth worth knowing: the vendored kit gives **buttons and badges
`rounded-4xl` (40px)**, which is a full pill at their 20–40px heights. So the
ladder above governs *surfaces*, and controls are pills. (The stylesheet's header
comment still describes an older "controls 10, cards 14, sheets 20" ladder; the
build is the ladder above.)

Nothing in this world is drawn with a dashed border, a hard offset shadow, or a
square corner smaller than `sm`.

### Named Rules
**The Ringed Dot Rule.** A status dot that lands on unknown colour (a favicon, a
photo) gets `ring-2 ring-background` so it reads on anything.

**The Pill-Control Rule.** Interactive controls are pills; containers are soft
rectangles. Don't square off a button to make it "fit" a card.

## Components

### Buttons
- **Shape:** pill (`rounded-4xl`, 40px), transparent border, `bg-clip-padding`.
- **Sizes:** `xs` 24px, `sm` 32px, default 36px, `lg` 40px; icon-only variants
  are squares of the same heights (`icon-xs` 24, `icon-sm` 32, `icon` 36).
- **Primary:** olive fill, `hover:bg-primary/80`.
- **Outline / ghost / secondary:** the quiet majority. `outline` is the toolbar
  idiom (`border-input bg-input/30`); `ghost` is the header idiom.
- **Destructive:** tinted, never solid — `bg-destructive/10 text-destructive`.
- **States:** press nudges `translate-y-px` (kit) or `scale(0.97)` via
  `.pressable` on the app's own primary actions; focus-visible draws a 3px
  `ring-ring/50` on top of the global 2px outline.

### Chips
- **MCP server chip:** a 32px circular `outline` icon-button whose favicon fills
  it edge to edge (no inset, no framed square); the name's first letter on
  `bg-muted` when no favicon resolves. Status is a 8px ringed dot in the corner,
  and only for the states that need acting on — connected is silent.
- **Folding:** past **3** servers, at every width, the row collapses to one
  counted chip (`3 MCP`) carrying the worst status as its dot and opening the
  same list. At or under 3 the chips hide on phones and the counted chip stands
  in.
- **Label badge:** `Badge variant="secondary"` at `text-micro font-normal` —
  the "side quest" tag is the canonical use.

### Cards / Containers
- **Corner:** `rounded-xl` (20px). **Background:** `bg-card`. **Shadow:**
  `shadow-md`. **Border:** none (see The No-Outline Rule).
- **Header:** `px-4 py-3`, a 20px duotone glyph, a 14px semibold name with a mono
  micro path beneath it, a right-aligned count, then a 32px `+` affordance. A
  project card and a machine card share this header exactly, so the board has one
  header to learn.
- **Body:** rows flush to the card edge, separated by `border-t border-border/50`
  groups, never by gaps.

### Inputs / Fields
- `.input`: `rounded-lg`, `border-input`, `bg-card`, `px-3.5 py-2`, `shadow-sm`,
  `text-base sm:text-sm` (16px on phones so iOS does not zoom).
- **Focus:** 2px `ring-ring` and the border goes transparent, over 160ms
  `--ease-out-expo`. **Disabled:** 50% opacity, `cursor-not-allowed`.

### Navigation
- **Header:** 48px `material-chrome`, wordmark at 17px, session tabs, then a
  right cluster: Jump (with a `⌘K` kbd), the permission shield (red tint only
  when the count is non-zero, the number scaling in), the hub status dot, help,
  theme.
- **Rail:** `h-8` rows at 13px with `rounded-lg` hover, machines → projects →
  sessions, dots at the 1.5 size. Resize handle is a 4px strip that colours on
  hover and takes arrow keys.
- **Thumb bar:** three 44pt targets, active one in olive, the rest muted.

### Status Dot (signature)
`ActivityDot` is the single source of session state on screen: a 8px (or 6px)
dot, green idle, amber pulsing while working, red with an `animate-ping` halo
when blocked — the only state waiting on a human is the only one that moves.
Every pulse carries `motion-reduce:animate-none`. Never hand-roll a coloured dot;
use this component or the same three tokens.

### Attention Queue (signature)
The fleet view's whole answer to "what needs me": one `rounded-xl bg-card
shadow-md` section headed "Needs you" with a count in a red-tinted pill, then one
row per blocked request (permission or question) and one per failed session —
both *derived*, so a queue is never stale. Rows are hairline-separated, hover to
`accent/40`, enter with `fly y:-8 240ms` and leave with `slide 160ms`. Permission
rows answer to `y`/`a` and `n`/`d` while focused; questions get no shortcut
because they need a real choice. Actions are `sm` buttons right-aligned, dropping
to their own full-width row on phones.

### Permission Card (signature)
`bg-card rounded-xl shadow-sm p-4`, shield glyph, one-line summary, a collapsible
`Details` holding the raw command in mono, and three verbs: Deny (quiet, left),
"Always allow <rule> (<scope>)" (secondary, middle), Allow (olive, right), each
with a kbd hint when the card is the stack's top. On answer the card
optimistically flips to its resolved colour (green fill on allow, red tint on
deny) and the other verbs fade — the answer travels browser → hub → agent, so the
card says it heard you immediately.

### Motion Details Worth Copying
- **Label swaps:** `{#key}` + `fly y:5 in / y:-5 out` at 180/140ms, guarded by a
  `painted` flag so rows that merely appear with the page announce nothing.
- **Icon swaps:** `.icon-swap` grids both icons into one cell and crossfades
  opacity + scale + 4px blur over 240ms, so the outgoing icon animates too.
- **Page transitions:** desktop fades with a 6px rise (120ms out / 180ms in);
  phones push horizontally 200ms `cubic-bezier(0.32, 0.72, 0, 1)` with direction
  from `html[data-nav='prev']`; card→header morphs share
  `--ease-inout-soft` at 240ms via `view-transition-name`.
- **Reduced motion:** all durations clamp to 120ms, loops stop, `.pressable`
  stops scaling, and travelling view transitions swap to fade-only keyframes.

## Do's and Don'ts

### Do:
- **Do** reach for `text-display/-title/-body/-caption/-micro` instead of raw
  `text-xs`/`text-sm` — the tracking and the 12px floor live in the utility.
- **Do** build a new floating surface as `rounded-xl bg-card shadow-md` with no
  border, and let hairlines separate only what is inside it.
- **Do** put paths, commands, and IDs in `font-mono text-micro`, and truncate
  long paths from the left (`[direction:rtl]` + `<bdi>`).
- **Do** use `ActivityDot` for session state and the three status tokens for
  server status; a hand-rolled coloured dot will drift.
- **Do** check `components/ui/` (the full vendored shadcn-svelte kit) and the
  nearest existing surface before hand-rolling a control.
- **Do** enter at 180–240ms and exit at 140–160ms on `quintOut` /
  `--ease-out-expo`, and pair every pulse with `motion-reduce:animate-none`.
- **Do** fold a repeating chip row into one counted chip past three items.
- **Do** keep 44pt targets, `env(safe-area-inset-*)` padding, and 16px inputs on
  phone surfaces.
- **Do** mark comparable numbers `tabular-nums` / `data-tabular`.

### Don't:
- **Don't** use red for anything that is not waiting on the user; a failure that
  needs no action is muted, not red.
- **Don't** outline a card that already has a shadow, and don't raise the night
  hairline above 5% to "make it visible".
- **Don't** use dashed borders, hard offset shadows, or striped/diagonal fills to
  mark ephemerality — side quests are a duotone sparkle plus a "side quest"
  badge.
- **Don't** set a global `letter-spacing`, and don't put UI copy in TX-02.
- **Don't** zero durations under `prefers-reduced-motion`; clamp to 120ms and
  remove travel, or the comprehension cross-fades go with it.
- **Don't** stretch one column on an ultrawide, and don't ship a shrunken desktop
  on the phone — the two layouts are different compositions.
- **Don't** hand-paint colours for rendered markdown; `.prose` is already bound
  to the tokens in both modes (`prose-invert` is intentionally a no-op).
- **Don't** animate a state label on first paint.
