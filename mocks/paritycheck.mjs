#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
/**
 * A shared class must render equivalently in every mock.
 *
 * WHY THIS EXISTS — the three mocks are separate hand-authored files that share a
 * class vocabulary but not an implementation, so a fix applied to one silently
 * misses the others. Measured instances of exactly that:
 *   - `.mark` got its fill back in v2 only; v3's `.s-i` and v4's `.mark` painted
 *     at 1.07:1 and 1.09:1 because one literal `.replace()` matched v2's spelling.
 *   - `.nav-i` rendered an icon in v2 and v3 and bare text in v4, because v4
 *     wraps its label in a `<span>` and v2/v3 do not.
 * Both were found by a human looking at a picture, not by 135 assertions.
 *
 * For every shared component this asserts, across all three files:
 *   - ICON PRESENCE — an element that carries an icon in one file carries one in
 *     all of them.
 *   - RESOLVED FILL — the same class resolves to the same painted background.
 *   - CHILD SKELETON — the same tag structure, reported as a difference rather
 *     than failed, because some divergence is real content (the transcript
 *     sidebar has no favourite stars).
 *
 *   node mocks/paritycheck.mjs
 */
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ["v2-fleet.html", "v3-assistant.html", "v4-transcript.html"];
// `:not(.on)` matters: comparing the first `.nav-i` compared a SELECTED item in
// one file against an unselected one in another and reported a state difference
// as a divergence.
const SHARED = [
  ".nav-i:not(.on)",
  ".run-i:not(.on)",
  ".mark",
  ".chip-s",
  ".act button",
  ".pg button",
  ".sec",
];

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_BIN ||
    "/home/bewinxed/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
});

const seen = {};
for (const file of FILES) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1023 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(join(HERE, file)).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  seen[file] = await page.evaluate((sels) => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d");
    const px = (v) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return `${d[0]},${d[1]},${d[2]},${d[3]}`;
    };
    const out = {};
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) {
        out[sel] = null;
        continue;
      }
      const cs = getComputedStyle(el);
      out[sel] = {
        icons: el.querySelectorAll("svg").length,
        fill: px(cs.backgroundColor),
        skeleton: [...el.children]
          .map((c) => c.tagName.toLowerCase())
          .join(">"),
        count: document.querySelectorAll(sel).length,
      };
    }
    return out;
  }, SHARED);
  await page.close();
}
await browser.close();

let fails = 0;
for (const sel of SHARED) {
  const present = FILES.filter((f) => seen[f][sel]);
  if (present.length < 2) {
    console.log(
      `  --    ${sel.padEnd(14)} present in ${present.length} file(s) — nothing to compare`
    );
    continue;
  }
  const icons = new Set(present.map((f) => seen[f][sel].icons > 0));
  const fills = new Set(present.map((f) => seen[f][sel].fill));
  const skels = new Set(present.map((f) => seen[f][sel].skeleton));
  const detail = present
    .map(
      (f) => `${f.split("-")[0]}:${seen[f][sel].icons}icon/${seen[f][sel].fill}`
    )
    .join("  ");

  const iconOk = icons.size === 1;
  const fillOk = fills.size === 1;
  if (!iconOk) {
    fails++;
  }
  if (!fillOk) {
    fails++;
  }
  console.log(
    `  ${iconOk && fillOk ? "PASS" : "FAIL"}  ${sel.padEnd(14)} ${detail}`
  );
  if (!iconOk) {
    console.log("          icon presence differs between files");
  }
  if (!fillOk) {
    console.log("          resolved fill differs between files");
  }
  if (skels.size > 1) {
    console.log(
      `          note: child skeletons differ (${[...skels].join(" | ")}) — ` +
        "reported, not failed; some divergence is real content"
    );
  }
}
console.log(
  fails
    ? `  ${fails} shared-class divergences`
    : "  every shared class renders equivalently across all three mocks"
);
process.exit(fails ? 1 : 0);
