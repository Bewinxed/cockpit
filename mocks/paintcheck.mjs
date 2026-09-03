#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
/**
 * Painted-pixel contrast for every tinted chip and pill, on the surface it
 * actually lands on.
 *
 * WHY THIS EXISTS — it is the gap that let a failing build through review.
 * colorcheck.py measures *token* values: it takes `--status-attn-ink` on
 * `--status-attn-bg` and reports 4.96:1. Two things happen between a token and a
 * pixel that the token can't know about:
 *
 *   1. Small text does not reach its nominal ink. At 11.5px / weight 500 the
 *      antialiased glyph core renders several luminance steps lighter than the
 *      declared colour — the same effect that makes the table's header label
 *      measure #646464 where the token says #52555b.
 *   2. Anything can be composited over. v3 draws the assistant scrim
 *      (alpha 0.06) across the whole page, so every pill in the sidebar behind
 *      it is dimmed. Measured: the same pill paints rgb(240,232,214) in v2 and
 *      rgb(228,221,204) in v3.
 *
 * Together those dropped a pill that "passes" at 4.96 to 4.47 on the glass.
 * So this measures what the user's eye receives: the modal fill colour and the
 * 1st-percentile ink luminance inside each chip's own rect, cropped out of a 2x
 * render. 1st percentile rather than the darkest pixel, because subpixel
 * antialiasing produces colour-fringed outliers that measure the renderer
 * rather than the design (the convention fidelity.py already uses).
 *
 *   node mocks/paintcheck.mjs
 */
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
// WIDENED. Scoping this to "every chip and pill" meant a composer capsule
// rendering typed text at 1.20:1 and its placeholder at 1.37:1 in dark mode was
// simply out of scope — the gate could not have caught it. Placeholder text is
// the single most commonly under-contrasted element in any UI, so it is named
// explicitly rather than left to a selector list. The target is now every
// element that paints ink on a fill.
const TARGETS = "*";
const MIN = 4.5;
let VIEW_W = 1440;

const srgb = (c) => {
  c /= 255;
  return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) =>
  0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_BIN ||
    "/home/bewinxed/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
});

let fails = 0;
for (const file of [
  "v2-fleet.html",
  "v3-assistant.html",
  "v4-transcript.html",
]) {
  // PAINTED CONTRAST x WIDTH. Colour is width-independent, but the SURFACES a
  // chip lands on are not: the stacked mobile layout puts pills and threshold
  // numerals on different fills than the desktop table does.
  for (const width of [390, 1440]) {
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
      await page.waitForTimeout(150);

      const rects = await page.evaluate((sel) => {
        // OCCLUSION, without mutating the page.
        //
        // The first version muted overlays by background alpha and required
        // `alpha > 0`, so the layer that actually swallows nine v3 chips —
        // DIV.a-grid at rgba(0,0,0,0) — was never muted and the guard was right
        // only by luck. Muting is also unsafe: pointer-events:none on a wrapper
        // disables its descendants, so a transparent wrapper CONTAINING the
        // opaque panel would wrongly expose everything under it.
        //
        // elementsFromPoint returns the whole stack instead. An element is
        // visible when every layer above it is see-through, however that is
        // produced: background alpha <= 0.3, element opacity <= 0.3, or a
        // backdrop-filter (which paints the content beneath, not over it).
        const seeThrough = (el) => {
          const cs = getComputedStyle(el);
          if (Number.parseFloat(cs.opacity) <= 0.3) {
            return true;
          }
          if (cs.backdropFilter && cs.backdropFilter !== "none") {
            return true;
          }
          const m = cs.backgroundColor.match(/[\d.]+\)$/);
          const alpha = m
            ? Number.parseFloat(m[0])
            : cs.backgroundColor === "transparent"
              ? 0
              : 1;
          const hasImage = cs.backgroundImage && cs.backgroundImage !== "none";
          return alpha <= 0.3 && !hasImage;
        };

        const textish = (el) => {
          const direct = [...el.childNodes].some(
            (n) => n.nodeType === 3 && n.textContent.trim().length > 1
          );
          if (direct) {
            return "text";
          }
          // a real form control paints its placeholder, which has no text node
          const tag = el.tagName.toLowerCase();
          if ((tag === "input" || tag === "textarea") && el.placeholder) {
            return "placeholder";
          }
          return null;
        };

        return [...document.querySelectorAll(sel)]
          .map((el) => {
            const kind = textish(el);
            if (!kind) {
              return null;
            }
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden") {
              return null;
            }
            // Effective, not own, opacity: `.aff-row{opacity:0}` hides its children
            // while each child still computes opacity 1. Those regions genuinely
            // paint nothing and are not contrast findings.
            let eff = 1;
            for (
              let a = el;
              a && a !== document.documentElement;
              a = a.parentElement
            ) {
              eff *= Number.parseFloat(getComputedStyle(a).opacity);
              const ar = a.getBoundingClientRect();
              if (ar.width < 1 || ar.height < 1) {
                return null;
              }
            }
            if (eff < 0.15) {
              return null;
            }
            const r = el.getBoundingClientRect();
            // WHOLE-RECT visibility, not a centre point. A cell at the table's
            // right edge can have a clear centre while the assistant panel covers
            // most of its box — the modal fill then reads as the PANEL and the pair
            // reports ~2.3:1 for text that is fine. Five probes: the centre and the
            // four corners inset by 2px. Any occluded probe means the region is not
            // measurable, which is a skip, not a finding.
            const probes = [
              [r.x + r.width / 2, r.y + r.height / 2],
              [r.x + 2, r.y + 2],
              [r.right - 2, r.y + 2],
              [r.x + 2, r.bottom - 2],
              [r.right - 2, r.bottom - 2],
            ];
            let visible = true,
              blocker = null;
            for (const [px, py] of probes) {
              const stack = document.elementsFromPoint(px, py);
              let ok = false;
              const idx = stack.findIndex((n) => n === el || el.contains(n));
              if (idx >= 0) {
                ok = stack.slice(0, idx).every(seeThrough);
                if (!ok) {
                  blocker =
                    blocker || stack.slice(0, idx).find((n) => !seeThrough(n));
                }
              } else if (stack.length) {
                const anc = stack.findIndex((n) => n.contains(el));
                if (anc >= 0) {
                  ok = stack.slice(0, anc).every(seeThrough);
                  if (!ok) {
                    blocker =
                      blocker ||
                      stack.slice(0, anc).find((n) => !seeThrough(n));
                  }
                } else {
                  blocker = blocker || stack[0];
                }
              }
              if (!ok) {
                visible = false;
                break;
              }
            }

            const textRects = [];
            for (const n of el.childNodes) {
              if (n.nodeType !== 3 || !n.textContent.trim()) {
                continue;
              }
              const rg = document.createRange();
              rg.selectNodeContents(n);
              for (const tr of rg.getClientRects()) {
                if (tr.width > 1 && tr.height > 1) {
                  textRects.push({
                    x: tr.x,
                    y: tr.y,
                    w: tr.width,
                    h: tr.height,
                  });
                }
              }
              rg.detach?.();
            }
            return {
              textRects,
              label:
                ((el.className && String(el.className)) || el.tagName) +
                (kind === "placeholder" ? " [placeholder]" : "") +
                ' "' +
                (kind === "placeholder" ? el.placeholder : el.textContent)
                  .trim()
                  .slice(0, 14) +
                '"',
              x: r.x,
              y: r.y,
              w: r.width,
              h: r.height,
              visible,
              blocker: blocker
                ? (
                    blocker.tagName +
                    "." +
                    String(blocker.className || "")
                  ).slice(0, 30)
                : null,
            };
          })
          .filter(Boolean);
      }, TARGETS);

      // Both axes are clamped. getImageData pads outside the canvas with
      // transparent black, which lands at luminance 0, is picked as the
      // 1st-percentile "ink", and produces a falsely HIGH contrast ratio — a
      // silent PASS. Only y was clamped before.
      VIEW_W = width;
      const inFrame = (r) =>
        r.y >= 0 && r.y + r.h <= 1023 && r.x >= 0 && r.x + r.w <= VIEW_W;
      const visible = rects.filter(
        (r) => r.visible && r.w >= 8 && r.h >= 8 && inFrame(r)
      );
      const dropped = rects.filter(
        (r) => !(r.visible && r.w >= 8 && r.h >= 8 && inFrame(r))
      );

      // one full-page bitmap, then crop in-page: avoids per-element screenshot
      // clipping, which silently returns the wrong region when the element is
      // inside a scroll container.
      const shot = (
        await page.screenshot({ animations: "disabled", caret: "hide" })
      ).toString("base64");
      const measured = await page.evaluate(
        async ({ b64, rects }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const cv = document.createElement("canvas");
          cv.width = img.width;
          cv.height = img.height;
          cv.getContext("2d").drawImage(img, 0, 0);
          const ctx = cv.getContext("2d");
          const out = [];
          for (const r of rects) {
            const d = ctx.getImageData(
              Math.round(r.x * 2),
              Math.round(r.y * 2),
              Math.max(1, Math.round(r.w * 2)),
              Math.max(1, Math.round(r.h * 2))
            ).data;
            const counts = new Map();
            const lums = [];
            for (let i = 0; i < d.length; i += 4) {
              const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
              counts.set(k, (counts.get(k) || 0) + 1);
              lums.push({
                l: d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114,
                c: [d[i], d[i + 1], d[i + 2]],
              });
            }
            if (!lums.length) {
              continue;
            }
            const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
            const fillShare = top[1] / (d.length / 4);
            if (fillShare < 0.4) {
              out.push({ label: r.label, mixed: true });
              continue;
            }
            const fill = top[0].split(",").map(Number);
            const fillLum = fill[0] * 0.299 + fill[1] * 0.587 + fill[2] * 0.114;

            // INK EXTRACTION. A flat 1st-percentile over the whole rect is only
            // right when the glyphs cover a decent share of it: for a two-character
            // label the darkest 1% is still background, and the pair reports ~1.0:1
            // — a false failure that buries the real ones. Ink is taken from the
            // pixels that actually DIFFER from the surface, at their 10th
            // percentile, so coverage no longer changes the answer.
            // ink pixels: prefer the text's own rects when we have them
            let inkPool = [];
            if (r.textRects && r.textRects.length) {
              for (const tr of r.textRects) {
                const tx = Math.max(0, Math.round(tr.x * 2)),
                  ty = Math.max(0, Math.round(tr.y * 2));
                const tw = Math.max(1, Math.round(tr.w * 2)),
                  th = Math.max(1, Math.round(tr.h * 2));
                if (tx + tw > cv.width || ty + th > cv.height) {
                  continue;
                }
                const td = ctx.getImageData(tx, ty, tw, th).data;
                for (let i = 0; i < td.length; i += 4) {
                  inkPool.push({
                    l: td[i] * 0.299 + td[i + 1] * 0.587 + td[i + 2] * 0.114,
                    c: [td[i], td[i + 1], td[i + 2]],
                  });
                }
              }
            }
            if (!inkPool.length) {
              inkPool = lums;
            }
            const differing = inkPool.filter(
              (x) => Math.abs(x.l - fillLum) > 8
            );
            if (differing.length < 4) {
              out.push({ label: r.label, noInk: true });
              continue;
            }
            differing.sort((a, b) => a.l - b.l);
            const q = (arr, f) =>
              arr[Math.min(arr.length - 1, Math.floor(arr.length * f))].c;
            const ink = q(differing, 0.1);
            const light = q(differing, 0.9);
            out.push({ label: r.label, fill, ink, light });
          }
          return out;
        },
        { b64: shot, rects: visible }
      );

      let mixedCount = 0;
      const noInkList = [];
      console.log(
        `\n  ${file} @${width} ${dark ? "dark " : "light"}` +
          `  (${visible.length} candidates, ${dropped.length} skipped)`
      );
      // An unlisted drop is how a finding disappears. Name every one.
      for (const d of dropped) {
        const why = d.visible
          ? d.w < 8 || d.h < 8
            ? "smaller than 8px"
            : "rect outside the captured frame"
          : `occluded by ${d.blocker || "unknown"}`;
        console.log(
          `      SKIP  ${d.label.padEnd(34)} ` +
            `rect ${Math.round(d.x)},${Math.round(d.y)} ${Math.round(d.w)}x${Math.round(d.h)}  — ${why}`
        );
      }
      for (const m of measured) {
        if (m.mixed) {
          mixedCount++;
          continue;
        }
        if (m.noInk) {
          noInkList.push(m.label);
          continue;
        }
        // in dark mode the text is the LIGHT extreme against a dark fill
        const fl = lum(m.fill);
        const text = fl < 0.18 ? m.light : m.ink;
        const r = ratio(text, m.fill);
        const ok = r >= MIN;
        if (!ok) {
          fails++;
        }
        console.log(
          `    ${ok ? "PASS" : "FAIL"}  ${r.toFixed(2)}:1  ${m.label.padEnd(34)}` +
            ` text rgb(${text}) on fill rgb(${m.fill})`
        );
      }
      if (mixedCount) {
        console.log(
          `      (${mixedCount} regions span multiple fills — no single background to judge)`
        );
      }
      if (noInkList.length) {
        console.log(
          `      NO INK  ${noInkList.length} region(s) paint nothing distinguishable from their surface:`
        );
        for (const l of [...new Set(noInkList)]) {
          console.log(`        ${l}`);
        }
      }
      await page.close();
    }
  }
}
await browser.close();
console.log(
  fails
    ? `\n  ${fails} painted chip/pill pairs below ${MIN}:1`
    : `\n  every painted chip and pill clears ${MIN}:1 in both schemes`
);
process.exit(fails ? 1 : 0);
