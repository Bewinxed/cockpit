#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
/**
 * Proves the dashboard survives its real deployment shape: plain http, off
 * localhost. `crypto.randomUUID` (and every other secure-context API) is
 * simply undefined there — no flag, no warning, just `undefined is not a
 * function` the first time an operator does anything. The one way to exercise
 * a genuine insecure origin without a second machine is to make Chromium
 * resolve a non-localhost hostname to the loopback address: the browser reads
 * the *hostname*, decides the origin is insecure, and still connects locally.
 *
 * This harness proves its own premise (`window.isSecureContext === false`)
 * rather than trusting the resolver trick blindly, then asserts the page
 * loads with zero uncaught exceptions.
 *
 * It then asserts the thing the whole design exists for: THE FAILED GHOST.
 * A send that cannot be delivered must leave a rendered, named, recoverable
 * outcome on the operator's own row — never silence. The failure is induced
 * by sending into a session whose MACHINE the hub cannot reach: the hub
 * refuses the command with "machine <id> is not connected", which is the real
 * production failure this design was written for, and there is no daemon at
 * the far end for the message to arrive at. See UNREACHABLE_SESSION for why
 * the target is nominated rather than discovered.
 *
 * Every branch says which branch it took. A skip is reported as a skip, never
 * folded into the PASS line, because a harness that quietly asserts nothing is
 * the exact failure mode this file was written to rule out.
 *
 * Usage: node scripts/insecure-origin-smoke.mjs
 * Requires: `bun run --filter '@whiffle/dashboard' build` beforehand — this
 * script previews the existing build, it does not build one.
 *
 * Env:
 *   WHIFFLE_HUB_URL (default http://127.0.0.1:3456) — the hub the front proxy puts
 *     behind the previewed build's own origin, so the dashboard can reach it.
 *   SMOKE_UNREACHABLE_SESSION — an instance id whose MACHINE the hub cannot
 *     reach. Required for the failed-ghost block, which sends for real and
 *     therefore refuses to guess its own target. Unset = that block is
 *     skipped, out loud.
 */
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const dashboardDir = path.join(repoRoot, "apps/dashboard");
const INSECURE_HOST = "insecure.whiffle.test";
const WHIFFLE_HUB_URL = process.env.WHIFFLE_HUB_URL ?? "http://127.0.0.1:3456";
/**
 * Distinctive enough to locate the row, obviously a test if it were ever seen,
 * and UNIQUE PER RUN — a row left behind by an earlier run must never be
 * mistaken for this run's, in either direction.
 */
const GHOST_PROBE_TEXT = `insecure-origin smoke: undeliverable probe ${Date.now()}`;

/**
 * The session the ghost assertion is allowed to send into — nominated, never
 * guessed.
 *
 * This block types a message and presses Enter for real, so the ONE thing it
 * must never do is reach a live agent. Two attempts to guarantee that from
 * inside the browser both failed and both actually delivered: `socket.close()`
 * is asynchronous (the socket is still OPEN for the rest of the tick), and a
 * stubbed `globalThis.__whiffleSocket` is overwritten by the client's own
 * reconnect before the keystroke lands. Measured, in this repo, against a real
 * hub: five probe messages delivered to somebody's running session.
 *
 * So the guarantee moves outside the browser: the operator names an instance
 * whose MACHINE the hub cannot reach. The hub refuses that command with
 * "machine <id> is not connected" — the exact production failure the ghost was
 * built for — and there is no daemon at the other end for a message to reach.
 *
 * There is deliberately no auto-discovery. The hub's own `/api/agents` reports
 * `status` from the database, which says `online` for machines whose socket
 * died without a close handler (the presence defect this design documents
 * separately), so "pick an offline one" would be picking from a list that
 * lies — and being wrong means sending a stranger's agent a test message. No
 * nomination, no assertion.
 */
const UNREACHABLE_SESSION = process.env.SMOKE_UNREACHABLE_SESSION ?? null;

/**
 * playwright-core is a root devDependency (`^1.62.1`) — verified against
 * `package.json` before this script was written. If resolution ever fails
 * (a pruned install, a workspace that dropped the dep), fail loudly with the
 * fix rather than let a bare `MODULE_NOT_FOUND` masquerade as "smoke passed".
 */
let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch (err) {
  console.error(
    "[insecure-origin-smoke] playwright-core is not resolvable from the repo root.\n" +
      "  This script depends on the root devDependency 'playwright-core' (see package.json).\n" +
      "  Run 'bun install' at the repo root and retry.\n" +
      `  Underlying error: ${err.message}`
  );
  process.exit(1);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        return;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `preview server never answered at ${url}: ${lastErr?.message ?? "timed out"}`
  );
}

/**
 * playwright-core ships no browser binaries — the repo relies on whatever
 * Chromium `npx playwright install` (or the cache it left behind) provided.
 * `scripts/shot.mjs` already found and pinned this exact path; reuse its
 * fallback so this script fails with a fix, not a guess, if the cache moves.
 */
function findChromiumExecutable() {
  if (process.env.CHROMIUM_BIN && existsSync(process.env.CHROMIUM_BIN)) {
    return process.env.CHROMIUM_BIN;
  }
  const fallback =
    "/home/bewinxed/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
  if (existsSync(fallback)) {
    return fallback;
  }
  return null;
}

/**
 * One origin in front of two servers, because the dashboard insists on it.
 *
 * `hubSocketUrl()` builds `ws://<the page's own host>/ws/dashboard` — the hub
 * is always same-origin as far as the client is concerned, and the dev server
 * makes that true with a proxy plugin. `vite preview` has no such plugin, so a
 * previewed build cannot reach a hub at all, no session is ever addressable,
 * and the composer never mounts: the ghost assertion would be skipped forever
 * for a reason that has nothing to do with what it tests.
 *
 * So the browser is pointed at this instead: `/ws*` and `/api*` go to the hub,
 * everything else to the preview, and the origin the page sees is one host —
 * the same shape production is served in, and the same shape the resolver
 * trick needs for the origin to read insecure.
 */
function startFrontProxy({ port, previewPort, hub }) {
  // The Host header is rewritten to the upstream's own, deliberately. `vite
  // preview` refuses any Host it was not configured for ("Blocked request.
  // This host is not allowed."), and it answers that refusal with a 200 HTML
  // page — so a harness that only checks for uncaught exceptions will happily
  // report PASS having measured Vite's error page instead of the dashboard.
  // The browser still sees `insecure.whiffle.test`, which is the only thing
  // the origin's security state is computed from.
  const to = (req) =>
    /^\/(ws|api)(\/|$)/.test(req.url ?? "")
      ? { host: hub.hostname, port: hub.port || 80, hostHeader: hub.host }
      : {
          host: "127.0.0.1",
          port: previewPort,
          hostHeader: `127.0.0.1:${previewPort}`,
        };
  const forward = (req, target) => ({
    host: target.host,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: target.hostHeader },
  });

  const server = http.createServer((req, res) => {
    const target = to(req);
    const proxied = http.request(forward(req, target), (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    });
    proxied.on("error", () => res.writeHead(502).end("proxy error"));
    req.pipe(proxied);
  });

  // The upgrade is replayed by hand for the same reason the dev server does it
  // by hand: a generic proxy loses the 101 under this toolchain.
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => {});
    const target = to(req);
    const proxied = http.request(forward(req, target));
    proxied.on("upgrade", (upstream, upstreamSocket, upstreamHead) => {
      const lines = ["HTTP/1.1 101 Switching Protocols"];
      for (let i = 0; i < upstream.rawHeaders.length; i += 2) {
        lines.push(`${upstream.rawHeaders[i]}: ${upstream.rawHeaders[i + 1]}`);
      }
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (upstreamHead?.length) {
        socket.write(upstreamHead);
      }
      if (head?.length) {
        upstreamSocket.write(head);
      }
      upstreamSocket.on("error", () => socket.destroy());
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    proxied.on("error", () => socket.destroy());
    proxied.end();
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

let previewProc;
let frontProxy;
let browser;
let exitCode = 0;

try {
  const previewPort = await getFreePort();
  const port = await getFreePort();
  const previewUrl = `http://127.0.0.1:${previewPort}`;

  previewProc = spawn(
    "bun",
    ["run", "preview", "--", "--port", String(previewPort), "--strictPort"],
    {
      cwd: dashboardDir,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let previewOutput = "";
  previewProc.stdout.on("data", (d) => (previewOutput += d));
  previewProc.stderr.on("data", (d) => (previewOutput += d));
  previewProc.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(
        `[insecure-origin-smoke] preview server exited early (code ${code}, signal ${signal})`
      );
      console.error(previewOutput);
    }
  });

  await waitForServer(previewUrl);
  frontProxy = await startFrontProxy({
    port,
    previewPort,
    hub: new URL(WHIFFLE_HUB_URL),
  });
  await waitForServer(`http://127.0.0.1:${port}`);

  const chromiumExe = findChromiumExecutable();
  if (!chromiumExe) {
    throw new Error(
      "No Chromium executable found. Set CHROMIUM_BIN or run 'npx playwright install chromium'."
    );
  }

  browser = await chromium.launch({
    executablePath: chromiumExe,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      `--host-resolver-rules=MAP ${INSECURE_HOST} 127.0.0.1`,
    ],
  });

  const page = await browser.newPage();

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  const insecureUrl = `http://${INSECURE_HOST}:${port}/session`;
  await page.goto(insecureUrl, { waitUntil: "networkidle", timeout: 30_000 });

  // The harness must prove its own premise: if this ever reads true, the
  // resolver trick stopped working and every assertion below is meaningless.
  const isSecureContext = await page.evaluate(() => window.isSecureContext);
  console.log(
    `[insecure-origin-smoke] window.isSecureContext === ${isSecureContext}`
  );
  if (isSecureContext !== false) {
    throw new Error(
      `Expected window.isSecureContext === false at ${insecureUrl}, got ${isSecureContext}. ` +
        "The origin was not actually insecure — this run proved nothing."
    );
  }

  // Best-effort: exercise the composer if one is reachable without a live
  // hub. With no hub running, no session ever addresses a real machine, so
  // the composer may legitimately never mount (see SessionPane's
  // `unaddressable`/`failure` states) — that is not a defect this script
  // checks for. What it DOES check, whenever the composer is present: typing
  // and submitting must not throw synchronously (the exact class of bug this
  // whole design fences).
  const composer = page.locator('textarea[aria-label="Message the agent"]');
  const composerVisible = await composer
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  if (composerVisible) {
    await composer.first().fill("insecure-origin smoke test");
    await composer.first().press("Enter");
    await page.waitForTimeout(500);
    console.log(
      "[insecure-origin-smoke] composer reached: typed and submitted with no throw"
    );
  } else {
    console.log(
      "[insecure-origin-smoke] no composer on /session (the fleet list has none); the failed-ghost block below opens a real session instead"
    );
  }

  await page.waitForTimeout(500);

  // ── The failed ghost ────────────────────────────────────────────────────
  // The acceptance condition of the whole design, as one assertion: from an
  // insecure origin, a send that cannot be delivered ends in a rendered,
  // named, recoverable outcome. Skipped — loudly — when there is no
  // addressable session to open, because inventing one would assert nothing.
  const sessionId = UNREACHABLE_SESSION;
  if (sessionId) {
    console.log(
      `[insecure-origin-smoke] failed-ghost: opening session ${sessionId}`
    );
    await page.goto(`http://${INSECURE_HOST}:${port}/session/${sessionId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const field = page
      .locator('textarea[aria-label="Message the agent"]')
      .first();
    // On a miss, say what the pane WAS showing. "the composer never appeared"
    // with no picture of the pane is the kind of failure report that costs an
    // hour; the state (unaddressable card, loading, a failed read) names the
    // cause on the spot.
    await field
      .waitFor({ state: "visible", timeout: 20_000 })
      .catch(async () => {
        const pane = await page
          .evaluate(() => ({
            hub:
              document.querySelector("[data-hub-status]")?.textContent ?? null,
            text: (
              document.querySelector(".pane")?.textContent ??
              document.body.innerText
            ).slice(0, 400),
          }))
          .catch(() => null);
        throw new Error(
          `no composer mounted on /session/${sessionId} within 20s — the pane showed ` +
            `${JSON.stringify(pane)}`
        );
      });

    // Retried, because the pane can re-render the composer out from under the
    // fill while the hub is still answering ("element was detached from the
    // DOM"). Bounded, and it says so if it never settles — a composer that
    // never holds still long enough to be typed into is itself a finding, not
    // something to paper over with a longer timeout.
    let filled = false;
    for (let attempt = 0; attempt < 5 && !filled; attempt += 1) {
      filled = await field
        .fill(GHOST_PROBE_TEXT, { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (!filled) {
        await page.waitForTimeout(1000);
      }
    }
    if (!filled) {
      throw new Error(
        `the composer on /session/${sessionId} never held still long enough to type into ` +
          "(it kept detaching from the DOM across 5 attempts)"
      );
    }

    await field.press("Enter");

    const ghost = page
      .locator("section.turn.you.failed")
      .filter({ hasText: GHOST_PROBE_TEXT });
    await ghost
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(async () => {
        // Which of the two failures this is matters enormously: a row that
        // rendered but wears the wrong tense is a MessageRow bug; no row at
        // all is the transcript never showing the operator's own words, which
        // is the original defect wearing a different hat. Say which.
        const rows = await page
          .evaluate(
            (probe) => ({
              userRows: [...document.querySelectorAll("section.turn.you")].map(
                (r) => ({
                  cls: r.className,
                  text: r.textContent.trim().slice(0, 60),
                })
              ),
              probeAnywhere: document.body.innerText.includes(probe),
              live:
                document.querySelector('[aria-live="polite"]')?.textContent ??
                null,
            }),
            GHOST_PROBE_TEXT
          )
          .catch(() => null);
        throw new Error(
          "an undeliverable send left NO failed ghost on the transcript — the message the operator " +
            "typed had no rendered outcome, which is the defect this whole design exists to make " +
            `impossible. Transcript at the time: ${JSON.stringify(rows)}`
        );
      });

    const rendered = await ghost.first().evaluate((row) => ({
      reason: row.querySelector(".reason")?.textContent?.trim() ?? null,
      note: row.querySelector(".who")?.textContent?.trim() ?? null,
      actions: [...row.querySelectorAll("button")].map((b) =>
        b.textContent.trim()
      ),
    }));
    const live =
      (await page.locator('[aria-live="polite"]').first().textContent()) ?? "";

    // Named, not merely styled: a red row with no words is not an outcome.
    if (!rendered.reason?.startsWith("Couldn't send that message.")) {
      throw new Error(
        `failed ghost carries no reason line (got ${JSON.stringify(rendered.reason)})`
      );
    }
    // Recoverable: the words the operator typed must be reachable again.
    for (const label of ["Try again", "Edit"]) {
      if (!rendered.actions.includes(label)) {
        throw new Error(
          `failed ghost is missing its "${label}" action (has ${JSON.stringify(rendered.actions)})`
        );
      }
    }
    // Spoken: the transcript is virtualized, so the pane's live region is the
    // only channel a screen reader reliably hears the failure through.
    if (!live.includes("Message not sent")) {
      throw new Error(
        `the live region never announced the failure (read ${JSON.stringify(live)})`
      );
    }
    console.log(
      `[insecure-origin-smoke] failed ghost OK — note ${JSON.stringify(rendered.note)}, ` +
        `reason ${JSON.stringify(rendered.reason)}, actions ${JSON.stringify(rendered.actions)}, ` +
        `live region ${JSON.stringify(live)}`
    );
    // Deliberately NOT clicked: "Try again" would dispatch for real the moment
    // the socket came back, and a smoke test must never send to a live agent.
  } else {
    console.log(
      "[insecure-origin-smoke] SKIP failed-ghost: set SMOKE_UNREACHABLE_SESSION=<instanceId> to an " +
        "instance whose MACHINE the hub cannot reach. This block sends for real, so it refuses to " +
        "guess a target — see the note on UNREACHABLE_SESSION. The insecure-origin assertions above " +
        "still hold."
    );
  }

  if (pageErrors.length > 0) {
    console.error(
      `[insecure-origin-smoke] ${pageErrors.length} uncaught page error(s):`
    );
    for (const err of pageErrors) {
      console.error(`  - ${err.message}`);
    }
    throw new Error("page threw uncaught exception(s) on an insecure origin");
  }

  console.log(
    "[insecure-origin-smoke] PASS — insecure origin, zero uncaught page errors"
  );
} catch (err) {
  console.error(`[insecure-origin-smoke] FAIL — ${err.message}`);
  exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  frontProxy?.close();
  if (previewProc && !previewProc.killed) {
    previewProc.kill("SIGTERM");
  }
}

process.exit(exitCode);
