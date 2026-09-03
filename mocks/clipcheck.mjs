#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
/**
 * Text clipping, containment and computed leading.
 *
 * WHY THIS EXISTS — it is the gate that should have caught a shipped build in
 * which none of the four KPI numbers was legible: `.stat .v` measured
 * clientHeight 24 against scrollHeight 38 with overflow-y hidden (16 vs 38 at
 * 390px), in both schemes, in two of three mocks.
 *
 * WHY IT WAS REWRITTEN — an audit found the first version's assertions were
 * largely inert, and an inert assertion is worse than a missing one because it
 * reports a clean pass:
 *
 *   - ESCAPED walked ancestors breaking on `getComputedStyle().height !== 'auto'`.
 *     Chrome returns a USED px height for essentially every rendered element, so
 *     the walk always stopped at the immediate parent — and a used height already
 *     contains its own content, so the comparison could never fire. It reported 0
 *     and always would.
 *   - LEADING skipped `line-height: normal` silently: `parseFloat('normal')` is
 *     NaN and the guard was `lh > 0`. Five text-bearing elements in v2 were never
 *     checked at all.
 *   - The sr-only exclusion tested `clientWidth <= 2 && clientHeight <= 2`, which
 *     is 0x0 for EVERY inline element — so plain inline text was unreachable by
 *     all three assertions, and a box crushed to zero height (exactly the defect
 *     class this gate exists for) would have been excused.
 *   - `text-overflow: ellipsis` was honoured even where it is inert (it does
 *     nothing without a single-line `white-space`).
 *
 * Three assertions, across every mock, every width, both schemes:
 *   1. CLIPPED  — text-bearing element with hidden overflow whose content
 *                 exceeds its box. Real ellipsis truncation is excluded.
 *   2. ESCAPED  — text whose painted rect crosses outside the CONTENT box of a
 *                 genuinely constrained ancestor. Overflow `visible` spills
 *                 rather than cuts, which assertion 1 cannot see.
 *   3. LEADING  — computed line-height / font-size inside DESIGN.md's 1.2-1.4
 *                 band, with `line-height: normal` resolved by measuring the
 *                 real line box, and `--leading-numeric` allowed by TOKEN VALUE
 *                 rather than by a magic threshold.
 *
 *   node mocks/clipcheck.mjs
 */
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ["v2-fleet.html", "v3-assistant.html", "v4-transcript.html"];
const WIDTHS = [320, 390, 768, 1024, 1440];
const LEAD_MIN = 1.2,
  LEAD_MAX = 1.4,
  EPS = 0.005;

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_BIN ||
    "/home/bewinxed/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
});

let clipped = 0,
  escaped = 0,
  badLead = 0,
  skipped = 0;
const seenLead = new Map();
const skipList = new Map();

for (const file of FILES) {
  for (const width of WIDTHS) {
    for (const coarse of [false, true]) {
      for (const dark of [false, true]) {
        // CLIPPING x POINTER: the coarse rules raise every control to 44px, which
        // changes layout, and layout is what this gate measures.
        const page = await browser.newPage({
          viewport: { width, height: 1023 },
          deviceScaleFactor: 2,
          hasTouch: coarse,
          isMobile: coarse,
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

        // passed in and ACTUALLY USED inside the page now; in the first
        // version these three were handed over and then ignored, with the
        // banding done in node — dead parameters that read as coverage.
        const r = await page.evaluate(
          ({ LEAD_MIN, LEAD_MAX, EPS }) => {
            const out = { clipped: [], escaped: [], lead: {}, skipped: [] };
            const numericLead =
              Number.parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue(
                  "--leading-numeric"
                )
              ) || null;

            // The real visually-hidden idiom, measured — not "small box", which is
            // 0x0 for every inline element and would exclude ordinary text.
            const srOnly = (el, cs) => {
              if (cs.clipPath === "inset(50%)") {
                return true;
              }
              if (cs.clip && cs.clip !== "auto" && /rect\(/.test(cs.clip)) {
                return true;
              }
              const r = el.getBoundingClientRect();
              const positioned =
                cs.position === "absolute" || cs.position === "fixed";
              const hidden =
                cs.overflow === "hidden" || cs.overflowX === "hidden";
              return positioned && hidden && r.width <= 1.5 && r.height <= 1.5;
            };

            // Real line box, for `line-height: normal`.
            // Measure the element's OWN text nodes, not selectNodeContents on the
            // whole element: that also returns rects for inline-block children (an
            // SVG glyph, a chip), and taking the min of those reports the smallest
            // fragment as the "line box" — which invented 90 false leading failures
            // at ratios like 1.043. Text nodes only, largest line.
            const lineBox = (el) => {
              let best = 0;
              for (const n of el.childNodes) {
                if (n.nodeType !== 3 || !n.textContent.trim()) {
                  continue;
                }
                const rng = document.createRange();
                rng.selectNodeContents(n);
                for (const x of rng.getClientRects()) {
                  best = Math.max(best, x.height);
                }
                rng.detach?.();
              }
              return best || null;
            };

            const contentBox = (el) => {
              const r = el.getBoundingClientRect();
              const cs = getComputedStyle(el);
              return {
                top:
                  r.top +
                  Number.parseFloat(cs.borderTopWidth) +
                  Number.parseFloat(cs.paddingTop),
                bottom:
                  r.bottom -
                  Number.parseFloat(cs.borderBottomWidth) -
                  Number.parseFloat(cs.paddingBottom),
              };
            };

            for (const el of document.querySelectorAll("body *")) {
              const hasText = [...el.childNodes].some(
                (n) => n.nodeType === 3 && n.textContent.trim()
              );
              if (!hasText) {
                continue;
              }
              const cs = getComputedStyle(el);
              const name = (
                el.tagName +
                "." +
                String(el.className || "")
              ).slice(0, 44);
              if (cs.display === "none" || cs.visibility === "hidden") {
                out.skipped.push({ name, why: "display/visibility hidden" });
                continue;
              }
              if (srOnly(el, cs)) {
                out.skipped.push({ name, why: "visually-hidden idiom" });
                continue;
              }

              // ---- 1. clipped -------------------------------------------------
              const hidY =
                cs.overflowY === "hidden" || cs.overflow === "hidden";
              const hidX =
                cs.overflowX === "hidden" || cs.overflow === "hidden";
              // ellipsis is inert unless the text is on a single line
              const oneLine =
                cs.whiteSpace === "nowrap" || cs.whiteSpace === "pre";
              const ellipsis = cs.textOverflow === "ellipsis" && oneLine;
              if (
                (hidY && el.scrollHeight > el.clientHeight + 1) ||
                (hidX && !ellipsis && el.scrollWidth > el.clientWidth + 1)
              ) {
                out.clipped.push({
                  name,
                  ch: el.clientHeight,
                  sh: el.scrollHeight,
                  cw: el.clientWidth,
                  sw: el.scrollWidth,
                  fs: cs.fontSize,
                  lh: cs.lineHeight,
                });
              }

              // ---- 2. escaped a genuinely constrained ancestor -----------------
              const er = el.getBoundingClientRect();
              for (
                let anc = el.parentElement;
                anc && anc !== document.body;
                anc = anc.parentElement
              ) {
                const acs = getComputedStyle(anc);
                // assertion 1 owns anything that clips; stop before double-counting
                if (acs.overflow !== "visible" || acs.overflowY !== "visible") {
                  break;
                }
                const constrained =
                  anc.scrollHeight > anc.clientHeight + 1 ||
                  acs.maxHeight !== "none";
                if (!constrained) {
                  continue;
                }
                const cb = contentBox(anc);
                if (er.bottom > cb.bottom + 1 || er.top < cb.top - 1) {
                  out.escaped.push({
                    name,
                    anc: (
                      anc.tagName +
                      "." +
                      String(anc.className || "")
                    ).slice(0, 30),
                    by: +Math.max(
                      er.bottom - cb.bottom,
                      cb.top - er.top
                    ).toFixed(1),
                  });
                }
                break;
              }

              // ---- 3. leading --------------------------------------------------
              const fs = Number.parseFloat(cs.fontSize);
              let lh = Number.parseFloat(cs.lineHeight);
              let how = "computed";
              if (!(lh > 0)) {
                // `normal` — measure the line box
                lh = lineBox(el);
                how = "measured";
              }
              if (fs > 0 && lh > 0) {
                const ratio = lh / fs;
                const key = ratio.toFixed(3) + (how === "measured" ? "*" : "");
                out.lead[key] = (out.lead[key] || 0) + 1;
                // display figures ride --leading-numeric BY TOKEN VALUE; everything
                // else must sit in the band. A magic `> 1.1` filter would also
                // excuse genuinely-broken sub-1.1 leading.
                const isNumericToken =
                  numericLead !== null && Math.abs(ratio - numericLead) <= EPS;
                if (
                  !isNumericToken &&
                  (ratio < LEAD_MIN - EPS || ratio > LEAD_MAX + EPS)
                ) {
                  out.lead["BAD:" + key] = (out.lead["BAD:" + key] || 0) + 1;
                }
              }
            }
            return out;
          },
          { LEAD_MIN, LEAD_MAX, EPS }
        );

        const tag = `${file} @${width}${coarse ? " coarse" : ""}${dark ? " dark" : ""}`;
        for (const c of r.clipped) {
          clipped++;
          console.log(
            `    CLIPPED  ${tag}  ${c.name}  client ${c.cw}x${c.ch} vs scroll ${c.sw}x${c.sh}  ${c.fs}/${c.lh}`
          );
        }
        for (const e of r.escaped) {
          escaped++;
          console.log(
            `    ESCAPED  ${tag}  ${e.name} out of ${e.anc} content box by ${e.by}px`
          );
        }
        for (const [k, n] of Object.entries(r.lead)) {
          if (k.startsWith("BAD:")) {
            badLead += n;
            console.log(
              `    LEADING  ${tag}  ratio ${k.slice(4)} on ${n} element(s) — outside ${LEAD_MIN}-${LEAD_MAX}`
            );
          } else {
            seenLead.set(k, (seenLead.get(k) || 0) + n);
          }
        }
        for (const s of r.skipped) {
          skipped++;
          skipList.set(
            `${s.name} (${s.why})`,
            (skipList.get(`${s.name} (${s.why})`) || 0) + 1
          );
        }
        await page.close();
      }
    }
  }
}
await browser.close();

console.log(
  "    computed leading ratios seen: " +
    [...seenLead.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, n]) => `${k}x${n}`)
      .join("  ") +
    "   (* = measured line box)"
);
if (skipList.size) {
  console.log(`    skipped ${skipped} element-passes, by reason:`);
  for (const [k, n] of [...skipList.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      x${String(n).padStart(3)}  ${k}`);
  }
}
const total = clipped + escaped + badLead;
console.log(
  total
    ? `    ${clipped} clipped, ${escaped} escaped, ${badLead} out-of-band leading`
    : `    no clipped text, nothing escaping a constrained box, all body leading inside ${LEAD_MIN}-${LEAD_MAX}`
);
process.exit(total ? 1 : 0);
