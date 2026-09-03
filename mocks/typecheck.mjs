#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
/**
 * Does the render obey the type system DESIGN.md locks?
 *
 * WHY THIS EXISTS — DESIGN.md stated "400 body · 450 medium · 500 strong. 600
 * and above never appear", `## Never` #5 banned weights above 500, and the type
 * section enumerated nine steps. Meanwhile v3 shipped `font-weight:650` and
 * `font-weight:550`, and v4's compact body rode a 12.5px literal that is not a
 * step on the ladder. Every existing gate passed. A claim in the locked identity
 * document with no gate behind it is a claim waiting to become false — that is
 * twice this phase.
 *
 * Four assertions over the rendered DOM, both schemes:
 *   1. every computed font-weight is one of the three ladder weights
 *   2. every computed font-size is one of the nine enumerated steps
 *   3. no text-bearing element is left on `line-height: normal` — an unspecified
 *      line box is unspecified type, and it is how a `font:` shorthand without a
 *      leading silently reset ~200 elements
 *   4. the primary and secondary action on the permission gate are not
 *      interchangeable: DESIGN.md's signature move says nothing pressable is
 *      flat, and a destructive grant must not look identical to its refusal
 *
 *   node mocks/typecheck.mjs
 */
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ["v2-fleet.html", "v3-assistant.html", "v4-transcript.html"];
// TYPE x WIDTH. Verified at 1440 only, while the ladder genuinely changes at the
// 900px breakpoint (the KPI steps to --text-2xl), so the narrow-width sizes were
// never checked against the enumerated steps.
const WIDTHS = [320, 390, 768, 1024, 1440];
const WEIGHTS = new Set(["400", "450", "500"]);
const STEPS = new Set([
  "10.25px",
  "11.5px",
  "13px",
  "14.5px",
  "16.5px",
  "18.5px",
  "20.75px",
  "23.5px",
  "26.25px",
]);

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_BIN ||
    "/home/bewinxed/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
});

let fails = 0;
const weights = {},
  sizes = {},
  normals = [],
  decorated = [];

for (const file of FILES) {
  for (const width of WIDTHS) {
    for (const dark of [false, true]) {
      const page = await browser.newPage({
        viewport: { width, height: 1023 },
        deviceScaleFactor: 2,
      });
      await page.goto(pathToFileURL(join(HERE, file)).href, {
        waitUntil: "load",
      });
      if (dark) {
        await page.evaluate(() =>
          document.documentElement.classList.add("dark")
        );
      }
      await page.evaluate(() => document.fonts.ready);

      const r = await page.evaluate(() => {
        const w = {},
          s = {},
          n = [],
          u = [];
        for (const el of document.querySelectorAll("body *")) {
          if (
            ![...el.childNodes].some(
              (x) => x.nodeType === 3 && x.textContent.trim()
            )
          ) {
            continue;
          }
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") {
            continue;
          }
          w[cs.fontWeight] = (w[cs.fontWeight] || 0) + 1;
          s[cs.fontSize] = (s[cs.fontSize] || 0) + 1;
          if (cs.lineHeight === "normal") {
            n.push(
              (`${el.tagName}.${String(el.className || "")}`).slice(0, 40)
            );
          }
          // UA defaults arrive whenever markup is promoted to a real control or
          // link. font-size, line-height and placeholder colour were each caught
          // one at a time; the underline was not caught at all. This asserts the
          // class rather than the instances.
          if (cs.textDecorationLine && cs.textDecorationLine !== "none") {
            u.push(
              (`${el.tagName}.${String(el.className || "")}`).slice(0, 40) +
                " " +
                cs.textDecorationLine
            );
          }
        }
        return { w, s, n, u };
      });
      for (const [k, v] of Object.entries(r.w)) {
        weights[k] = (weights[k] || 0) + v;
      }
      for (const [k, v] of Object.entries(r.s)) {
        sizes[k] = (sizes[k] || 0) + v;
      }
      for (const x of r.n) {
        normals.push(`${file}${dark ? " dark" : ""} ${x}`);
      }
      for (const x of r.u) {
        decorated.push(`${file}${dark ? " dark" : ""} ${x}`);
      }
      await page.close();
    }
  }
}

console.log("  computed font-weights:", JSON.stringify(weights));
const badW = Object.keys(weights).filter((k) => !WEIGHTS.has(k));
if (badW.length) {
  fails++;
  console.log(
    `    FAIL weights outside the 400/450/500 ladder: ${badW.join(", ")}`
  );
}

console.log("  computed font-sizes  :", JSON.stringify(sizes));
const badS = Object.keys(sizes).filter((k) => !STEPS.has(k));
if (badS.length) {
  fails++;
  console.log(
    `    FAIL sizes not on the enumerated ladder: ${badS.join(", ")}`
  );
}

if (normals.length) {
  fails++;
  console.log(
    `    FAIL ${normals.length} text-bearing element(s) left on line-height: normal`
  );
  for (const x of [...new Set(normals)].slice(0, 8)) {
    console.log(`      ${x}`);
  }
} else {
  console.log(
    "  line-height: normal  : none — every text element has a specified line box"
  );
}

if (decorated.length) {
  fails++;
  console.log(
    `    FAIL ${decorated.length} element(s) carry a UA text-decoration`
  );
  for (const x of [...new Set(decorated)].slice(0, 6)) {
    console.log(`      ${x}`);
  }
} else {
  console.log(
    "  text-decoration      : none anywhere — no leaked UA underline"
  );
}

// 4. THE PERMISSION PAIR, AT EVERY WIDTH AND IN BOTH SCHEMES.
// Asserting this at 1440 only was a scope hole: `.choice button{flex:1 1 auto}`
// under `pointer: coarse` sizes each button to its own label, so the pair that
// is 132x32 / 132x32 on the desktop rendered 170x44 vs 150x44 at 390 and
// 135x44 vs 115x44 at 320 — the destructive grant 13-17% wider AND the
// higher-salience filled button, on the device the brief names as the primary
// approval context. A parity invariant asserted at one width is not an
// invariant.
// The `flex: 1 1 auto` that breaks parity lives inside `@media (pointer: coarse)`,
// so a run without touch emulation never applies it and the gate reports a clean
// pass while a real phone renders the mismatch. Both pointer modes are tested.
const PAIR_WIDTHS = [320, 390, 768, 1024, 1440];
for (const width of PAIR_WIDTHS) {
  for (const coarse of [false, true]) {
    for (const dark of [false, true]) {
      const page = await browser.newPage({
        viewport: { width, height: 1023 },
        deviceScaleFactor: 2,
        hasTouch: coarse,
        isMobile: coarse,
      });
      await page.goto(pathToFileURL(join(HERE, "v4-transcript.html")).href, {
        waitUntil: "load",
      });
      if (dark) {
        await page.evaluate(() =>
          document.documentElement.classList.add("dark")
        );
      }
      await page.evaluate(() => document.fonts.ready);
      const pair = await page.evaluate(() =>
        [...document.querySelectorAll(".choice button")].map((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            text: el.textContent.trim(),
            w: Math.round(r.width),
            h: Math.round(r.height),
            bg: cs.backgroundColor,
            bgi: cs.backgroundImage === "none" ? "none" : "gradient",
            shadow: cs.boxShadow === "none" ? "none" : "shadow",
            color: cs.color,
          };
        })
      );
      await page.close();
      const tag = `@${width}${coarse ? " coarse" : ""}${dark ? " dark" : ""}`;
      if (pair.length !== 2) {
        fails++;
        console.log(`    FAIL ${tag} expected 2 actions, found ${pair.length}`);
        continue;
      }
      const [a, b] = pair;
      const line =
        `  ${tag.padEnd(11)} ${a.text} ${a.w}x${a.h} (${a.bgi}/${a.shadow})` +
        `  vs  ${b.text} ${b.w}x${b.h} (${b.bgi}/${b.shadow})`;
      const problems = [];
      if (a.w !== b.w || a.h !== b.h) {
        problems.push(`size parity lost: ${a.w}x${a.h} vs ${b.w}x${b.h}`);
      }
      if (
        a.bg === b.bg &&
        a.bgi === b.bgi &&
        a.color === b.color &&
        a.shadow === b.shadow
      ) {
        problems.push("visually interchangeable");
      }
      const flat = pair.filter((x) => x.bgi === "none" && x.shadow === "none");
      if (flat.length) {
        problems.push(`${flat.map((x) => x.text).join(", ")} is flat`);
      }
      if (problems.length) {
        fails += problems.length;
        console.log(`    FAIL ${line}\n         ${problems.join("; ")}`);
      } else {
        console.log(`    PASS ${line}`);
      }
    }
  }
}
await browser.close();

console.log(
  fails
    ? `  ${fails} type/action conformance failures`
    : "  render matches the locked type system and the action pair is distinct"
);
process.exit(fails ? 1 : 0);
