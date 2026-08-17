# Usage, Cost & Limits — implementation spec

Status: spec. Written 2026-08-16. Source of truth for the usage feature.
Companion to NEW.md (which says nothing about usage — this is greenfield).

## 1. What this builds

A usage and cost surface for the fleet, covering **Claude Code** and **opencode**:

- Real Anthropic **5-hour** and **weekly** limit utilization, live from the API.
- Token and cost detail per day, per project, per model, per session.
- ccusage-style **5-hour billing blocks** with burn rate and projection.
- A glanceable pill in the session strip; a full `/usage` page behind it.

## 2. Ground truth (verified 2026-08-16, do not re-litigate)

### 2.1 Limits are NOT on disk. They come from an API.

`ccusage` has **no** limit awareness. Greps for `rate_limit`, `quota`, `resets_at`,
`utilization` over its whole Rust tree return zero. Its `weekly` command is
calendar-week cost aggregation, nothing more.

The real source is `GET https://api.anthropic.com/api/oauth/usage`, with:

```
Authorization: Bearer <claudeAiOauth.accessToken from ~/.claude/.credentials.json>
anthropic-beta: oauth-2025-04-20
```

Verified live response shape (trimmed to what we consume):

```jsonc
{
  "five_hour":  { "utilization": 50.0, "resets_at": "2026-08-16T14:10:00.282445+00:00" },
  "seven_day":  { "utilization": 54.0, "resets_at": "2026-08-20T18:00:00.282462+00:00" },
  "seven_day_opus": null, "seven_day_sonnet": null,
  "limits": [
    { "kind": "session",       "group": "session", "percent": 50, "severity": "normal",
      "resets_at": "…", "scope": null, "is_active": false },
    { "kind": "weekly_all",    "group": "weekly",  "percent": 54, "severity": "normal",
      "resets_at": "…", "scope": null, "is_active": false },
    { "kind": "weekly_scoped", "group": "weekly",  "percent": 70, "severity": "normal",
      "resets_at": "…", "scope": { "model": { "id": null, "display_name": "Fable" } },
      "is_active": true }
  ],
  "spend": { "used": { "amount_minor": 0, "currency": "USD", "exponent": 2 },
             "limit": null, "percent": 0, "enabled": false },
  "extra_usage": { "is_enabled": false, "utilization": null, "user_disabled": true }
}
```

**Consume `limits[]` as the primary shape** — it is already normalized, carries
`severity` and `is_active`, and covers scoped (per-model) weekly limits that the
top-level keys do not. Treat `five_hour`/`seven_day` as fallback if `limits` is absent.

Plan tier is local, in the same credentials file: `subscriptionType: "max"`,
`rateLimitTier: "default_claude_max_20x"`. Show it as context; never use it to
compute a limit — the API already gives percentages.

### 2.2 Cost basis differs per harness

- **Claude Code** transcripts carry **no** cost field. Cost must be computed from a
  pricing table. On a Max plan this is notional, so it is **secondary**: the headline
  is limit %, and any dollar figure is labelled *"would cost on API"*.
- **opencode** already records real cost per message. That **is** genuine spend and
  is the opencode headline. Verified totals on this machine: `$7.90`, 13.1M input,
  1.46M output, 581M cache-read.

### 2.3 On-disk formats

**Claude Code** — JSONL under `<config>/projects/**/*.jsonl`, where `<config>` is
`$CLAUDE_CONFIG_DIR` (comma-separated) else `$XDG_CONFIG_HOME/claude` and `~/.claude`.
Corpus here: 828 MB, 544 files, 73,114 usage records.

Record fields we read (verified against a real line):

```jsonc
{
  "type": "assistant",
  "timestamp": "2026-08-16T12:47:53.922Z",
  "sessionId": "…", "requestId": "req_…", "cwd": "/home/…", "version": "2.1.220",
  "gitBranch": "main", "isSidechain": false, "isApiErrorMessage": false,
  "message": {
    "id": "msg_…", "model": "claude-…",
    "usage": {
      "input_tokens": 2,
      "output_tokens": 690,
      "cache_creation_input_tokens": 3292,
      "cache_read_input_tokens": 48910,
      "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 3292 },
      "service_tier": "standard",
      "speed": "standard"
    }
  }
}
```

**opencode** — SQLite at `$OPENCODE_DATA_DIR` else `~/.local/share/opencode`,
file `opencode.db` (else first `opencode-*.db`). Open **read-only**.

```sql
SELECT id, session_id, data FROM message WHERE time_created > ?1
```

`data` is JSON:

```jsonc
{ "id": "msg_…", "sessionID": "…", "role": "assistant",
  "providerID": "opencode-go", "modelID": "deepseek-v4-pro",
  "path": { "cwd": "/home/bewinxed/cockpit", "root": "…" },
  "cost": 0.0123,
  "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
  "time": { "created": 1786884539888 } }
```

Note the capitalized `sessionID` / `providerID` / `modelID`. Map
`cache.write → cacheCreationTokens`, `cache.read → cacheReadTokens`.
Skip rows where `role !== "assistant"` or all token fields are zero.
Legacy JSON files under `storage/message/**/*.json` use the same object shape;
DB rows win over a file with the same id.

## 3. Architecture — where each piece lives and why

Cockpit is a **fleet**. Each machine runs its own agent daemon and owns its own
`~/.claude` and opencode DB. The hub cannot read a remote machine's disk, and
`~/.claude/.credentials.json` only exists where its account is logged in.

> Therefore the scanner runs **in the agent**, per machine, and reports to the hub.
> The hub stores, aggregates across machines, and serves the dashboard.

This mirrors how `agents.fleet` and `agents.harnesses` already work.

```
[agent: machine A] scan ~/.claude JSONL  ─┐
                   scan opencode.db      ─┤ ws verb 'usage' ─> [hub] ─> cockpit.db
                   GET /api/oauth/usage  ─┘                      │
                                                                 └─ broadcast frame ─> [dashboard]
                                                                 └─ REST /api/usage/* ─> [dashboard]
```

The OAuth token is read at call time on the machine that owns it, used for one
request, and never stored, logged, or sent over the wire. Only numbers travel.

## 4. `packages/core/src/usage/` — shared library

Pure, dependency-free (except `node:fs`/`bun:sqlite` in the scanners). No Effect here.

### 4.1 `types.ts`

```ts
export type UsageHarness = 'claude' | 'opencode';

export interface UsageTokens {
  input: number;
  output: number;
  cacheCreation: number;   // Claude: see cacheCreationCount() rule below
  cacheRead: number;
  reasoning: number;       // opencode only; 0 for Claude
}

/** One (session, model, hour) bucket. The unit the agent reports and the hub stores. */
export interface UsageBucket {
  harness: UsageHarness;
  hourStart: number;       // ms epoch, floored to the UTC hour
  firstTs: number;         // ms epoch of the earliest record in the bucket
  lastTs: number;          // ms epoch of the latest record in the bucket
  sessionId: string;
  project: string;         // Claude: dir name after `projects/`. opencode: basename(path.root)
  projectPath: string | null;
  model: string;
  provider: string | null; // opencode only
  tokens: UsageTokens;
  costUsd: number;
  messages: number;
}

export interface LimitWindow {
  kind: string;            // 'session' | 'weekly_all' | 'weekly_scoped' | …
  group: 'session' | 'weekly' | string;
  percent: number;
  severity: 'normal' | 'warning' | 'critical' | string;
  resetsAt: string | null; // ISO
  scopeLabel: string | null; // scope.model.display_name, e.g. "Fable"
  isActive: boolean;
}

export interface ClaudeLimits {
  fetchedAt: number;
  planTier: string | null;       // rateLimitTier
  subscription: string | null;   // subscriptionType
  windows: LimitWindow[];
  spendUsed: number | null;      // dollars
  spendLimit: number | null;
  error: string | null;
}
```

### 4.2 `tokens.ts`

```ts
/**
 * ccusage rule (types.rs:42-49): if `cache_creation` is PRESENT, the ephemeral
 * 5m+1h pair replaces `cache_creation_input_tokens` entirely — the flat field is
 * ignored, not added. Switch on presence, not on value.
 */
export const cacheCreationCount = (u: RawClaudeUsage): number =>
  u.cache_creation
    ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) +
      (u.cache_creation.ephemeral_1h_input_tokens ?? 0)
    : (u.cache_creation_input_tokens ?? 0);

export const totalTokens = (t: UsageTokens): number =>
  t.input + t.output + t.cacheCreation + t.cacheRead + t.reasoning;
```

### 4.3 `pricing.ts`

Ship a bundled snapshot; refresh opportunistically.

- Bundle `packages/core/src/usage/pricing-snapshot.json`, generated from
  `https://models.dev/api.json`, keeping only providers we use
  (`anthropic`, `opencode`, plus any `providerID` seen). Rates are **per million**
  in the source — divide by 1e6 on load.
- Optional refresh: fetch models.dev at most once/24h; on failure keep the snapshot
  and never block a scan. Offline must work.
- Resolution order for a model id: exact → alias table → normalized
  (`claude-sonnet-4.5` → `claude-sonnet-4-5`) → `provider/model` → give up.
- **On a miss, cost is 0 and the model id is recorded in a `missingPricing` set**
  that the API surfaces. Do not silently invent a price. Do not guess a fallback rate.
- Derived defaults when a source omits cache rates: `cacheCreation = input * 1.25`,
  `cacheRead = input * 0.1`.

Cost formula (matches ccusage `cost.rs:99-180`, simplified — we do NOT implement the
long-context 200k tier in v1; record it as a known gap):

```
cost = input*rIn + output*rOut + cacheCreation*rCacheWrite + cacheRead*rCacheRead
```

For opencode, `costUsd` comes from the record and pricing is **not** consulted
(`data.cost` is authoritative). Only fall back to computed pricing when `cost` is
absent or 0 **and** tokens are non-zero.

### 4.4 `blocks.ts` — 5-hour billing blocks

Port of ccusage `blocks.rs:53-107`. Operates on **hourly buckets**, which is exact:
block starts are hour-floored, and within-bucket gaps are ≤1h so can never exceed
the 5h gap threshold. Only inter-bucket gaps matter, and buckets carry `firstTs`/`lastTs`.

```ts
export const SESSION_DURATION_MS = 5 * 60 * 60 * 1000;

export function identifyBlocks(buckets: UsageBucket[], now: number): UsageBlock[]
```

Algorithm, exactly:

1. Sort buckets by `firstTs`.
2. First bucket: `blockStart = floorToHour(firstTs)`.
3. For each next bucket: `sinceStart = firstTs - blockStart`, `sinceLast = firstTs - prevLastTs`.
   If `sinceStart > 5h` **or** `sinceLast > 5h`: close the block; if `sinceLast > 5h`
   also emit a **gap block** spanning `prevLastTs + 5h → firstTs`; then
   `blockStart = floorToHour(firstTs)`.
4. Flush the final block.

Per block: `endTime = startTime + 5h`, `actualEndTime = last bucket's lastTs`,
`isActive = (now - actualEndTime < 5h) && now < endTime`, `id = ISO(startTime)`.

Burn rate (`blocks.rs:567-584`), returns null for gap/empty/zero-duration:

```
durationMinutes        = (lastTs - firstTs) / 60000
tokensPerMinute        = totalTokens / durationMinutes
tokensPerMinuteForIndicator = (input + output) / durationMinutes   // excludes cache
costPerHour            = costUsd / durationMinutes * 60
```

Projection (`blocks.rs:586-601`):

```
remainingMinutes = round((endTime - now) / 60000)
projectedTokens  = round(totalTokens + tokensPerMinute * remainingMinutes)
projectedCost    = round2(costUsd + (costPerHour / 60) * remainingMinutes)
```

### 4.5 `limits.ts`

```ts
export async function fetchClaudeLimits(opts?: { configDir?: string }): Promise<ClaudeLimits>
```

- Read `<configDir|~/.claude>/.credentials.json`; take `claudeAiOauth.accessToken`,
  `subscriptionType`, `rateLimitTier`.
- If the file is missing or has no token: return `{ error: 'not signed in', windows: [] }`.
  This is a normal state, not a crash — a machine may run opencode only.
- If `expiresAt` is in the past: return `{ error: 'token expired' }`. **Do not refresh**
  the token — Claude Code owns that file. (User decision, 2026-08-16.)
- `GET /api/oauth/usage` with the two headers above and a 10s timeout.
- Map `limits[]` → `LimitWindow[]`; `scopeLabel = scope?.model?.display_name ?? null`.
- Non-200 → `{ error: 'HTTP <code>' }`, never throw.
- Cache in-process for **60s**. Never persist the token.

## 5. `packages/agent/src/usage/` — per-machine scanner

### 5.1 Incremental strategy (measured)

A raw scan of the 828 MB corpus is 0.6s; a full JSON parse of 73k records is a few
seconds. Full-parse-per-poll is wasteful; parse-on-request is too slow. So:

- **Full rebuild on daemon start.** Populates an in-memory dedup set and watermarks.
- **Incremental every 60s.** For each file, compare `(mtimeMs, size)` to the
  watermark. Unchanged → skip. Grown → read **from the stored byte offset only**
  (transcripts are append-only). Shrunk/rotated → re-read whole file.
- **Full rebuild every 30 min**, to heal anything the incremental path missed.
- Dedup set lives **in memory** for the process lifetime and is rebuilt on start.
  ~73k keys is a few MB. No persistence needed.

Watermarks persist to `<agent data dir>/usage-index.json` so a restart is cheap;
if it is missing or its schema version differs, do a full rebuild.

### 5.2 Dedup

**Claude** (ccusage `lib.rs:142-233`): key on `(message.id, requestId)`.
On collision, prefer the non-sidechain entry; else the one with the larger total
tokens. Also run the sidechain fallback pass keyed on `(message.id, null)` so
`/btw` replays with a fresh `requestId` do not double count.

**opencode**: key on `message.id` alone. DB rows win over legacy files.

Skip Claude lines that: lack the literal `"usage":{` (cheap prefilter before any
JSON parse), fail timestamp parse, or have an empty-string `sessionId`/`requestId`/
`message.id`/`message.model`.

### 5.3 Bucketing and reporting

Fold surviving records into `UsageBucket`s keyed
`${harness}:${sessionId}:${model}:${hourStart}`.

Report **absolute bucket totals**, never deltas — the hub upserts by id, so a
re-send is idempotent and self-healing. Send only buckets touched since the last
report, plus every bucket in the current and previous hour (they are still moving).

```ts
send(socket, { verb: 'usage', machineId, payload: { buckets, limits } });
```

Schedule with the existing Effect idiom in `daemon.ts` (mirror
`Schedule.spaced(HEARTBEAT_INTERVAL)`): `USAGE_INTERVAL = Duration.seconds(60)`.
Limits are fetched on the same tick (they have their own 60s cache).

Never let a scan failure kill the daemon: wrap in `Effect.catchAll`, log, continue.

## 6. `packages/hub` — storage and API

### 6.1 Schema — `packages/hub/src/db/schema.ts`

Follow the existing idiom exactly (`timestamp()` helper, `$type<>()`, `sqliteTable`).

```ts
export const usageBuckets = sqliteTable('usage_buckets', {
  /** `${machineId}:${harness}:${sessionId}:${model}:${hourStart}` */
  id: text('id').primaryKey(),
  machineId: text('machine_id').notNull(),
  harness: text('harness').$type<'claude' | 'opencode'>().notNull(),
  hourStart: integer('hour_start').notNull(),
  firstTs: integer('first_ts').notNull(),
  lastTs: integer('last_ts').notNull(),
  sessionId: text('session_id').notNull(),
  project: text('project').notNull(),
  projectPath: text('project_path'),
  model: text('model').notNull(),
  provider: text('provider'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  reasoningTokens: integer('reasoning_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  messages: integer('messages').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
});

export const usageLimits = sqliteTable('usage_limits', {
  machineId: text('machine_id').primaryKey(),
  payload: text('payload', { mode: 'json' }).$type<ClaudeLimits>().notNull(),
  fetchedAt: timestamp('fetched_at').notNull().$defaultFn(() => new Date()),
});
```

Indexes: `(hour_start)`, `(machine_id, harness, hour_start)`, `(session_id)`.

Migration: `bun run --filter '@cockpit/hub' db:generate`. **One statement per
migration file** — the sqlite migrator runs only the first statement (NEW.md §5).
Split the table create and each index into separate files.

### 6.2 `DbShape` methods — `packages/hub/src/db/index.ts`

Match the existing upsert idiom (see `putMcpServer`, db/index.ts:550-557).

```ts
readonly putUsageBuckets: (machineId: string, buckets: UsageBucket[]) => void;
readonly putUsageLimits: (machineId: string, limits: ClaudeLimits) => void;
readonly listUsageBuckets: (q: {
  since?: number; until?: number; harness?: string; machineId?: string;
}) => UsageBucketRow[];
readonly listUsageLimits: () => UsageLimitRow[];
```

`putUsageBuckets` must `onConflictDoUpdate` **setting absolute values** (not adding),
and should run inside a single transaction for the batch.

### 6.3 Routes — `packages/hub/src/server.ts`

Append to the chain before the `.ws('/ws/dashboard')` block. TypeBox validation, and
return errors via `status(code, msg)` — never throw.

```
GET /api/usage/limits
    -> { machines: [{ machineId, hostname, limits: ClaudeLimits }] }

GET /api/usage/summary?since&until&harness&machineId&groupBy=day|model|project|session
    -> { rows: [...], totals: {...}, missingPricing: string[] }

GET /api/usage/blocks?harness&machineId&recentDays=3
    -> { blocks: UsageBlock[] }   // computed via core blocks.ts from stored buckets
```

Aggregation happens in SQL where possible (`SUM`, `GROUP BY`), and blocks are
computed in TS from the bucket rows via the shared `identifyBlocks`.

### 6.4 Agent verb — `server.ts` `/ws` switch (~line 1576)

```ts
case 'usage': {
  const { buckets, limits } = envelope.payload;
  if (buckets?.length) db.putUsageBuckets(machineId, buckets);
  if (limits) db.putUsageLimits(machineId, limits);
  registry.broadcast({ verb: 'frames', machineId,
    payload: { kind: 'usage', limits: db.listUsageLimits() } });
  break;
}
```

Broadcast only the small limits payload on each tick — the dashboard pulls heavy
aggregates over REST. Do not push the full bucket set over the socket.

## 7. `apps/dashboard` — UI

House rules, from `app.css` and existing components — follow them, do not invent:

- Svelte 5 runes: `$props()`, `$state`, `$derived`, `$derived.by`.
- Import kit as namespaces: `import * as Popover from '$lib/components/ui/popover'`.
- Type utilities: `text-micro`, `text-caption`, `text-body`, `text-title`.
- **`tabular-nums` on every number.** `font-mono` (TX-02) for ids, paths, measurements only.
- Status hues are semantic, never decoration: `--success` idle, `--warning` working,
  `--destructive`/`--error` needs-you. Action colour is the single olive `--primary`.
- Chart ramp is `--chart-1..5`, already defined. **Nothing in the app renders a chart
  yet** — this feature is the first. `layerchart@2.1.0` and the shadcn `chart` wrapper
  (`ui/chart`, exporting `ChartContainer`/`ChartTooltip`) are installed and unused.
- Depth = elevation (`shadow-md`/`lg`/`xl`), not borders. Hairlines separate only.
- Motion ≤ 320ms, `--ease-out-expo`, and honour `prefers-reduced-motion`.
- Errors surface via `toast` from `svelte-sonner`.

### 7.1 `lib/cockpit/UsageMeter.svelte` — the pill

Sits in the session strip **next to `ContextMeter`**, and deliberately mirrors it:
a thin bar plus a number at rest, colour only when it matters, Popover on click.

- Two stacked hairline bars: 5-hour and weekly. Width = `percent`.
- Bands: `< 70` neutral (`bg-muted-foreground/60`), `>= 70` `bg-warning`,
  `>= 90` `bg-destructive`. Same thresholds as ContextMeter, for consistency.
- Label: `50% · 54%` (5h · week), `tabular-nums`.
- `title` and `aria-label` spell out both windows and their reset times.
- Popover content (`w-80`, `rounded-xl`, `p-0`, `align="end"`, `side="top"`):
  - Header: "Usage limits" + plan tier badge (`Max 20x`).
  - One row per `LimitWindow`: label, bar, percent, and a live **countdown to reset**
    ("resets in 2h 14m"). Scoped windows show their `scopeLabel` ("Fable").
    Mark `isActive` windows — that is the one currently binding.
  - Divider, then an opencode row: real spend today + total.
  - Footer link: "Open full usage →" to `/usage`.
- Refresh on open, exactly like `ContextMeter`'s `onrefresh`.
- Empty state when not signed in: "No limit reading — this machine is not signed
  in to Claude." Never render a fake 0%.

### 7.2 `routes/usage/+page.svelte` (+ `+page.ts`)

New top-level route, sibling of `/tools`. `+page.ts` loads from `/api/usage/*`
through the existing SvelteKit proxy, mirroring `routes/tools/+page.ts`.

Sections, in order:

1. **Limit cards** — one card per window, full width. Big percent, bar, reset
   countdown, `severity` colour. The `is_active` card is elevated.
2. **Two headline tiles** — Claude (limit-led, with `~$X would cost on API` as
   caption) and opencode (real `$` spend). Never merge the two currencies into one
   total; they are not the same kind of number.
3. **Daily chart** — stacked bars by day, series = model, using `ChartContainer` +
   layerchart. Range picker: 7d / 30d / 90d / all. `--chart-1..5` ramp, cycling.
4. **5-hour blocks timeline** — each block a row: time range, tokens, cost, models,
   and for the active block a burn-rate line and projection ("on pace for X by
   19:00"). Gap blocks render as a thin muted spacer, labelled with their duration.
5. **Breakdown table** — tabs for Project / Model / Session (use `ui/tabs`, and
   drive selection from a search param like `tools/+page.svelte` does). Columns:
   name, input, output, cache write, cache read, total, cost. Sortable, `tabular-nums`.
   Clicking a session row opens a detail Popover/Dialog with its hourly shape.
6. **Footer note** — if `missingPricing` is non-empty, list those model ids plainly:
   "No published price for: … — their cost reads as $0."

### 7.3 Nav

Add one item to `lib/cockpit/Sidebar.svelte`'s `<Sidebar.Header>`, duplicating the
existing "Tools" block (Sidebar.svelte:1038-1055) with `href="/usage"`, an
`isActive` check on `/usage`, and a chart-ish icon from `~icons/solar/`.

## 8. Explicit non-goals for v1

State these rather than half-building them:

- **No token refresh.** If the OAuth token is expired, show that; Claude Code owns
  the credentials file.
- **No long-context (>200k) pricing tier.** Costs for very large contexts will read
  slightly low. Recorded as a known gap.
- **No harnesses beyond claude and opencode.** ccusage supports 19; the scanner
  interface should make adding one cheap, but do not add them now.
- **No budget enforcement.** The SDK's `maxBudgetUsd`/`taskBudget` exist (NEW.md:126)
  and are passed through, but this feature only reports; it never blocks a session.
- **No cross-account aggregation.** Limits are per-machine-account, keyed by machineId.

## 9. Verification gate

Do not report done without these, run and pasted:

1. `bun run typecheck` clean across the workspace.
2. `bun run lint` clean.
3. Agent scan on this machine parses **73,114** Claude usage records (± drift from new
   sessions) and yields a non-zero bucket count; print the count.
4. opencode scan totals reconcile with the DB:
   `SELECT SUM(cost) …` → **7.9013** at time of writing; input **13,134,514**,
   output **1,457,685**, cache read **581,227,008**. Print both sides.
5. `GET /api/usage/limits` returns live percentages matching a direct curl of
   `/api/oauth/usage` taken in the same minute.
6. Blocks: assert the active block's `isActive` is true and its projection is
   finite; print the block list for the last 3 days.
7. Screenshot or describe the pill in both bands and the `/usage` page rendering
   with real data.

Use an **isolated stack** for proofs (port 3457+, scratch DB). Do not restart the
shared hub or the agent daemon — those are the user's to restart.
