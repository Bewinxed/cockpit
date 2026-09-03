#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
/**
 * Keyboard operability and focus visibility.
 *
 * WHY THIS EXISTS — the entire suite rendered every axis and never pressed Tab.
 * A tab walk of v2-fleet yielded THREE stops against 27 `cursor: pointer`
 * affordances: the 23 row actions, the nav, the running-session list, pagination,
 * filters, Export CSV, favourites and Ask AI were all bare `<span>`. Worse, the
 * stylesheet shipped a `:focus-visible` rule naming those exact selectors, which
 * could never match because none of them could hold focus — a rule added in
 * response to "no interaction states exist" that satisfied the letter of the
 * finding while reaching 3 of 27 elements. DESIGN.md then claimed the ring was on
 * "every interactive affordance".
 *
 * Four assertions, per file, in both schemes:
 *   1. OPERABLE   — every element that responds to a pointer (cursor: pointer,
 *                   or an onclick, or a role) is focusable. Measured by walking
 *                   the real tab order, not by reading the markup.
 *   2. NAMED      — every focusable stop has an accessible name.
 *   3. VISIBLE    — every stop paints a focus indicator that is actually
 *                   distinguishable from its surroundings, at >= 3:1 against the
 *                   adjacent background (WCAG 2.2 SC 1.4.11 non-text contrast),
 *                   measured from painted pixels rather than from the CSS.
 *   4. ORDER      — the tab sequence follows reading order (top-to-bottom,
 *                   left-to-right within a row band), so focus does not jump.
 *
 *   node mocks/keyboardcheck.mjs
 */
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ["v2-fleet.html", "v3-assistant.html", "v4-transcript.html"];
const MAX_TABS = 200;
// KEYBOARD x WIDTH. The tab walk used to run at 1440 only, while the width sweep
// never pressed Tab — so the drawer opener, which only PAINTS below 900px, was
// never keyboard-tested at any width where it exists, and the closed drawer's 19
// focusables were never checked for staying in the tab order. The defect lived
// in the crossing, not in either axis.
const WIDTHS = [320, 390, 768, 1024, 1440];

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

      // ---- 1 & 2: pointer affordances vs focusable stops ---------------------
      const inventory = await page.evaluate(() => {
        const FOCUSABLE =
          'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),' +
          "summary,details,audio[controls],video[controls]";
        const pointer = [],
          unreachable = [],
          unnamed = [];
        const name = (el) =>
          (
            el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            (el.labels && el.labels[0] && el.labels[0].textContent) ||
            el.textContent ||
            ""
          ).trim();
        const cls = (el) =>
          typeof el.className === "string"
            ? el.className
            : (el.getAttribute && el.getAttribute("class")) || "";
        for (const el of document.querySelectorAll("body *")) {
          // An <svg> or <path> inside a control inherits cursor:pointer, but the
          // CONTROL is the parent — counting the glyph as its own affordance
          // inflates the inventory and hides the real ones.
          if (el.namespaceURI === "http://www.w3.org/2000/svg") {
            continue;
          }
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") {
            continue;
          }
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) {
            continue;
          }
          const actsLikeControl =
            cs.cursor === "pointer" ||
            el.hasAttribute("onclick") ||
            [
              "button",
              "link",
              "tab",
              "menuitem",
              "checkbox",
              "switch",
            ].includes(el.getAttribute("role"));
          if (!actsLikeControl) {
            continue;
          }
          // a pointer affordance whose only job is to host a focusable child is fine
          if (el.querySelector(FOCUSABLE)) {
            continue;
          }
          if (el.closest(FOCUSABLE)) {
            continue; // the focusable ancestor is the control
          }
          const label =
            (`${el.tagName}.${cls(el)}`).slice(0, 30) +
            ' "' +
            name(el).slice(0, 18) +
            '"';
          pointer.push(label);
          if (!el.matches(FOCUSABLE)) {
            unreachable.push(label);
          } else if (!name(el)) {
            unnamed.push(label);
          }
        }
        return {
          pointerCount: pointer.length,
          unreachable,
          unnamed,
          focusableCount: document.querySelectorAll(FOCUSABLE).length,
        };
      });

      // ---- walk the real tab order -------------------------------------------
      await page.evaluate(() => document.body.focus());
      const stops = [];
      for (let i = 0; i < MAX_TABS; i++) {
        await page.keyboard.press("Tab");
        const stop = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) {
            return null;
          }
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            tag: (`${el.tagName}.${String(el.className || "")}`).slice(0, 26),
            name: (el.getAttribute("aria-label") || el.textContent || "")
              .trim()
              .slice(0, 20),
            // DOCUMENT coordinates, not viewport. The browser scrolls as focus
            // moves, so a viewport-relative y makes an in-order walk look like it
            // bounces (972 -> 503 -> 800 -> 503 ...) and invents inversions. The
            // 1440 runs only passed because the page happened not to scroll.
            x: Math.round(r.x + window.scrollX),
            y: Math.round(r.y + window.scrollY),
            w: Math.round(r.width),
            h: Math.round(r.height),
            vx: Math.round(r.x),
            vy: Math.round(r.y),
            // the landmark this stop belongs to: a column-to-column jump is
            // correct reading order, an upward jump inside one column is not
            // "off-screen" means horizontally outside the viewport — a stop the
            // user cannot see even after the browser scrolls to it. Vertical
            // position is not a defect: the browser scrolls to it.
            inView: r.right > 0 && r.left < window.innerWidth,
            region: (() => {
              const l = el.closest(
                'aside,main,header,footer,nav,section,[role="dialog"]'
              );
              return l
                ? `${l.tagName}.${String(l.className || "").slice(0, 12)}`
                : "root";
            })(),
            outline:
              cs.outlineStyle === "none"
                ? null
                : `${cs.outlineWidth} ${cs.outlineColor}`,
          };
        });
        if (!stop) {
          break;
        }
        if (
          stops.length &&
          stops[stops.length - 1].tag === stop.tag &&
          stops[stops.length - 1].x === stop.x &&
          stops[stops.length - 1].y === stop.y
        ) {
          break;
        }
        stops.push(stop);
      }

      // ---- 3: is the ring actually painted and distinguishable? ---------------
      let ringFails = 0,
        ringMin = 99;
      if (stops.length) {
        await page.evaluate(() => document.body.focus());
        for (let i = 0; i < Math.min(stops.length, 12); i++) {
          await page.keyboard.press("Tab");
        }
        const probe = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) {
            return null;
          }
          // The clip is in VIEWPORT coordinates and a screenshot only captures the
          // viewport, so a focused element the browser has scrolled past yields an
          // empty crop and reads as "paints nothing". Bring it into view first.
          el.scrollIntoView({ block: "center", inline: "center" });
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        });
        if (probe) {
          const pad = 6;
          const clip = {
            x: Math.max(0, Math.round(probe.x - pad)),
            y: Math.max(0, Math.round(probe.y - pad)),
            width: Math.min(1440, Math.round(probe.w + pad * 2)),
            height: Math.min(1023, Math.round(probe.h + pad * 2)),
          };
          if (
            clip.width > 4 &&
            clip.height > 4 &&
            clip.x + clip.width <= 1440 &&
            clip.y + clip.height <= 1023
          ) {
            const withRing = await page.screenshot({ clip });
            await page.evaluate(() => document.activeElement.blur());
            const without = await page.screenshot({ clip });
            const diff = await page.evaluate(
              async ({ a, b }) => {
                const load = async (s) => {
                  const im = new Image();
                  im.src = `data:image/png;base64,${s}`;
                  await im.decode();
                  const c = document.createElement("canvas");
                  c.width = im.width;
                  c.height = im.height;
                  c.getContext("2d").drawImage(im, 0, 0);
                  return c
                    .getContext("2d")
                    .getImageData(0, 0, im.width, im.height).data;
                };
                const A = await load(a),
                  B = await load(b);
                let changed = 0,
                  ringPx = null,
                  bgPx = null,
                  best = 0;
                for (let i = 0; i < A.length; i += 4) {
                  const d =
                    Math.abs(A[i] - B[i]) +
                    Math.abs(A[i + 1] - B[i + 1]) +
                    Math.abs(A[i + 2] - B[i + 2]);
                  if (d > 24) {
                    changed++;
                    // the ring CORE is the maximally-changed pixel; the first
                    // changed pixel is an antialiased edge and understates it
                    if (d > best) {
                      best = d;
                      ringPx = [A[i], A[i + 1], A[i + 2]];
                      bgPx = [B[i], B[i + 1], B[i + 2]];
                    }
                  }
                }
                return { changed, ringPx, bgPx };
              },
              { a: withRing.toString("base64"), b: without.toString("base64") }
            );
            if (!diff.changed) {
              ringFails++;
            } else if (diff.ringPx && diff.bgPx) {
              ringMin = Math.min(ringMin, ratio(diff.ringPx, diff.bgPx));
            }
          }
        }
      }

      // ---- 4: reading order ---------------------------------------------------
      let inversions = 0;
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1],
          b = stops[i];
        if (a.region !== b.region) {
          continue; // region change is legitimate
        }
        if (b.y + b.h <= a.y - 1) {
          inversions++; // jumped upward a full row
        }
      }

      // is there a keyboard-operable way to REACH the navigation at this width?
      const opener = await page.evaluate(() => {
        const aside = document.querySelector("aside");
        if (!aside) {
          return { needed: false };
        }
        const hidden =
          aside.getBoundingClientRect().right <= 0 ||
          getComputedStyle(aside).transform.includes("-2") ||
          getComputedStyle(aside).display === "none";
        if (!hidden) {
          return { needed: false };
        }
        const FOCUSABLE =
          'a[href],button,input:not([hidden]),select,textarea,[tabindex]:not([tabindex="-1"])';
        const candidates = [
          ...document.querySelectorAll(".burger,[aria-controls],[data-drawer]"),
        ];
        const usable = candidates.find(
          (el) =>
            el.matches(FOCUSABLE) &&
            el.getBoundingClientRect().width > 0 &&
            el.tabIndex >= 0
        );
        return {
          needed: true,
          present: !!usable,
          found: candidates.map(
            (c) => `${c.tagName}.${c.className} tabIndex=${c.tabIndex}`
          ),
        };
      });
      const offscreen = stops.filter((st) => !st.inView);

      // INTERACTION STATE x SCHEME. The hover and active surfaces were verified as
      // token values only; this presses them and measures the painted result, in
      // both schemes, because a state is a condition the design enters, not a
      // colour it declares.
      const stateProblems = [];
      for (const sel of [".nav-i:not(.on)", "tbody tr td"]) {
        // Only probe something the pointer can actually reach: below 900px the
        // drawer is closed and `inert`, so hovering a nav item is a no-op and
        // "hover changes nothing" would be an artifact of the closed drawer
        // rather than a missing state.
        const target = await page.$(sel);
        if (!target) {
          continue;
        }
        const hittable = await target.evaluate((e) => {
          if (e.closest("[inert]")) {
            return false;
          }
          const r = e.getBoundingClientRect();
          if (
            !(
              r.width > 2 &&
              r.height > 2 &&
              r.right > 0 &&
              r.left < window.innerWidth
            )
          ) {
            return false;
          }
          // and the pointer must actually be able to land on it. v3 renders the
          // assistant-open state, where a scrim covers the board on purpose, so a
          // synthetic hover lands on the scrim and "hover changes nothing" would
          // describe the overlay rather than a missing state.
          const hit = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2
          );
          return !!hit && (hit === e || e.contains(hit) || hit.contains(e));
        });
        if (!hittable) {
          continue;
        }
        const before = await target.evaluate(
          (e) => getComputedStyle(e).backgroundColor
        );
        await target.hover().catch(() => {});
        await page.waitForTimeout(40);
        const after = await target.evaluate((e) => {
          const cs = getComputedStyle(e);
          const cv = document.createElement("canvas");
          cv.width = cv.height = 1;
          const ctx = cv.getContext("2d");
          const px = (v) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = v;
            ctx.fillRect(0, 0, 1, 1);
            const d = ctx.getImageData(0, 0, 1, 1).data;
            return [d[0], d[1], d[2]];
          };
          return {
            bg: cs.backgroundColor,
            bgPx: px(cs.backgroundColor),
            inkPx: px(cs.color),
          };
        });
        if (before === after.bg) {
          stateProblems.push(`${sel} hover changes nothing`);
        } else {
          const r = ratio(after.inkPx, after.bgPx);
          if (r < 4.5) {
            stateProblems.push(`${sel} ink on hover surface ${r.toFixed(2)}:1`);
          }
        }
        await page.mouse.move(0, 0);
      }

      const tag = `${file.replace(".html", "")} @${width} ${dark ? "dark " : "light"}`;
      const problems = [];
      if (opener.needed && !opener.present) {
        problems.push(
          "drawer is closed and has NO keyboard-focusable opener " +
            `(${opener.found.join("; ") || "no candidate"})`
        );
      }
      if (offscreen.length) {
        problems.push(
          `${offscreen.length} tab stop(s) land off-screen ` +
            `(first at x=${offscreen[0].x}, "${offscreen[0].name}")`
        );
      }
      if (inventory.unreachable.length) {
        problems.push(
          `${inventory.unreachable.length} of ${inventory.pointerCount} pointer affordances are not focusable`
        );
      }
      if (inventory.unnamed.length) {
        problems.push(
          `${inventory.unnamed.length} focusable control(s) with no accessible name`
        );
      }
      if (ringFails) {
        problems.push("focus indicator paints nothing");
      }
      if (ringMin < 3 && ringMin !== 99) {
        problems.push(
          `focus ring ${ringMin.toFixed(2)}:1 against its background (need 3:1)`
        );
      }
      if (inversions) {
        problems.push(
          `${inversions} tab-order inversion(s) against reading order`
        );
      }
      for (const sp of stateProblems) {
        problems.push(sp);
      }

      console.log(
        `  ${problems.length ? "FAIL" : "PASS"}  ${tag.padEnd(30)}` +
          ` ${stops.length} tab stops · ${inventory.pointerCount} pointer affordances` +
          ` · ${inventory.focusableCount} focusable` +
          (ringMin === 99 ? "" : ` · ring ${ringMin.toFixed(2)}:1`)
      );
      for (const p of problems) {
        fails++;
        console.log(`          ${p}`);
      }
      if (inventory.unreachable.length) {
        for (const u of [...new Set(inventory.unreachable)].slice(0, 5)) {
          console.log(`            not focusable: ${u}`);
        }
      }
      await page.close();
    }
  }
}
await browser.close();
console.log(
  fails
    ? `  ${fails} keyboard/focus failures`
    : "  every pointer affordance is focusable and named, the ring is visible, order follows reading order"
);
process.exit(fails ? 1 : 0);
