#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
/**
 * DOM measurement for the Phase 3 quantities fidelity.py explicitly does not
 * cover: the action gradient, the graded border scale, the mark and tile radii,
 * the panel geometry and scrim, and whether the dark ramp actually activates.
 *
 * fidelity.py compares painted pixels between two images. It cannot read a
 * `background-image`, a `box-shadow`, or a `border-radius`, and it never sees
 * the dark scheme at all. These are read out of the live DOM instead of eyeballed.
 *
 *   node mocks/measure.mjs
 */
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_BIN ||
    "/home/bewinxed/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
});

let fails = 0;
const check = (label, ok, detail) => {
  if (!ok) {
    fails++;
  }
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`
  );
};

const page = await browser.newPage({
  viewport: { width: 1440, height: 1023 },
  deviceScaleFactor: 2,
});
await page.goto(pathToFileURL(join(HERE, "v2-fleet.html")).href, {
  waitUntil: "load",
});
await page.evaluate(() => document.fonts.ready);

// ---- DW-3.14: the primary action is not flat -------------------------------
console.log("\n=== DW-3.14 — primary action gradient + graded borders ===");
const action = await page.evaluate(() => {
  const el = document.querySelector(".cta");
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    backgroundImage: cs.backgroundImage,
    boxShadow: cs.boxShadow,
    borderRadius: cs.borderRadius,
    size: `${Math.round(r.width)}x${Math.round(r.height)}`,
  };
});
console.log(`     .cta background-image: ${action.backgroundImage}`);
console.log(`     .cta box-shadow      : ${action.boxShadow}`);
const stops =
  action.backgroundImage.match(/(?:rgb|oklch|color)\([^)]*\)/g) || [];
check(
  "action carries a linear-gradient (not a flat fill)",
  action.backgroundImage.includes("linear-gradient"),
  action.backgroundImage.slice(0, 40) + "…"
);
check(
  "gradient has two distinct stops (top highlight -> body)",
  stops.length >= 2 && stops[0] !== stops[1],
  `${stops[0]} -> ${stops[1]}`
);
check(
  "action carries an inset bottom edge",
  action.boxShadow.includes("inset"),
  action.boxShadow
    .split(",")
    .find((s) => s.includes("inset"))
    ?.trim()
);

const borders = await page.evaluate(() => {
  const one = (sel, prop) => {
    const el = document.querySelector(sel);
    if (!el) {
      return null;
    }
    return getComputedStyle(el)[prop];
  };
  return {
    hairline: one("aside", "borderRightColor"),
    divider: one("tbody td", "borderBottomColor"),
    control: one(".search", "borderTopColor"),
  };
});
console.log(`     hairline (aside border-right) : ${borders.hairline}`);
console.log(`     divider  (td border-bottom)   : ${borders.divider}`);
console.log(`     control  (.search border)     : ${borders.control}`);
const uniq = new Set(Object.values(borders));
check(
  "border scale is graded, not flattened to one value",
  uniq.size === 3,
  `${uniq.size} distinct values`
);

// ---- radii the gate cannot see ---------------------------------------------
console.log(
  "\n=== radii + tile geometry (fidelity.py covers none of these) ==="
);
const shapes = await page.evaluate(() => {
  const g = (sel) => {
    const el = document.querySelector(sel);
    if (!el) {
      return null;
    }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      radius: cs.borderRadius,
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
      bg: cs.backgroundColor,
      bgi: cs.backgroundImage.slice(0, 30),
    };
  };
  return {
    panel: g(".panel"),
    card: g(".stat"),
    well: g(".stat .well"),
    tile: g(".stat .chip"),
    mark: g(".nm-cell .mark"),
  };
});
for (const [k, v] of Object.entries(shapes)) {
  console.log(
    `     ${k.padEnd(6)} ${String(v && v.w).padStart(6)}x${String(v && v.h).padEnd(6)} r=${v && v.radius}`
  );
}
check(
  "table panel radius 14px",
  shapes.panel?.radius === "14px",
  shapes.panel?.radius
);
check(
  "stat card radius 10px",
  shapes.card?.radius === "10px",
  shapes.card?.radius
);
check(
  "stat well radius 7px",
  shapes.well?.radius === "7px",
  shapes.well?.radius
);
check(
  "stat icon tile 24x24 r5.5",
  shapes.tile?.w === 24 &&
    shapes.tile?.h === 24 &&
    shapes.tile?.radius === "5.5px",
  `${shapes.tile?.w}x${shapes.tile?.h} r=${shapes.tile?.radius}`
);
check(
  "row mark 17x17 r4.6 with a gradient fill (not a hue fill)",
  shapes.mark?.w === 17 &&
    shapes.mark?.h === 17 &&
    shapes.mark?.radius === "4.6px" &&
    shapes.mark?.bgi.includes("gradient"),
  `${shapes.mark?.w}x${shapes.mark?.h} r=${shapes.mark?.radius} ${shapes.mark?.bgi}…`
);

// ---- DW-3.12: status carries a hueless channel ------------------------------
console.log("\n=== DW-3.12 — status legible with hue removed ===");
const chips = await page.evaluate(() =>
  [...document.querySelectorAll(".chip-s")].map((el) => ({
    cls: [...el.classList].find((c) => c.startsWith("s-")),
    label: el.textContent.trim(),
    glyph:
      el
        .querySelector("svg")
        ?.querySelector("path,circle")
        ?.getAttribute("d") ||
      el.querySelector("svg")?.tagName ||
      null,
    fill: getComputedStyle(el).backgroundColor,
  }))
);
const states = new Map();
for (const c of chips) {
  states.set(c.cls, c);
}
for (const [cls, c] of states) {
  console.log(
    `     ${cls.padEnd(8)} "${c.label}"  glyph=${c.glyph ? "yes" : "NONE"}  fill=${c.fill}`
  );
}
check(
  "every status chip carries a glyph as well as a label",
  chips.length > 0 && chips.every((c) => c.glyph),
  `${chips.length} chips`
);
check(
  "every status state has a distinct glyph",
  new Set([...states.values()].map((c) => c.glyph)).size === states.size,
  `${states.size} states`
);
check(
  "idle ships no fill (measured 6.7 dE from the live chip when it had one)",
  [...states.values()]
    .filter((c) => c.cls === "s-idle")
    .every((c) => c.fill === "rgba(0, 0, 0, 0)"),
  states.get("s-idle")?.fill
);

// ---- the design is alive: colour on the marks, icons that are icons ---------
// None of this was caught by 135 assertions across eight review cycles, because
// the suite measured conformance and never asked whether the result was any
// good. A column of empty grey boxes passed every check.
console.log("\n=== marks carry colour, and their glyph is legible on it ===");
const marks = await page.evaluate(() => {
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
  const out = [];
  for (const m of document.querySelectorAll(".mark, .s-i")) {
    const cs = getComputedStyle(m);
    const sv = m.querySelector("svg");
    out.push({
      fill: px(cs.backgroundColor),
      glyph: sv
        ? px(
            getComputedStyle(sv).stroke === "none"
              ? getComputedStyle(sv).fill
              : getComputedStyle(sv).stroke
          )
        : null,
    });
  }
  return out;
});
const sat = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
const cr = (a, b) => {
  const l = (c) => {
    c /= 255;
    return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = ([r, g, bb]) => 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(bb);
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const hues = new Set(marks.map((m) => m.fill.join(",")));
const flat = marks.filter((m) => sat(m.fill) < 30);
const worstGlyph = marks
  .filter((m) => m.glyph)
  .reduce((w, m) => Math.min(w, cr(m.glyph, m.fill)), 99);
console.log(
  `     ${marks.length} marks · ${hues.size} distinct fills · worst glyph contrast ${worstGlyph.toFixed(2)}:1`
);
check(
  "every item mark carries a saturated identity hue (not graphite)",
  flat.length === 0,
  `${flat.length} flat/greyscale marks`
);
check(
  "at least 4 distinct mark hues — identity, not one accent",
  hues.size >= 4,
  `${hues.size} hues`
);
check(
  "mark glyph clears 3:1 on its own fill (WCAG 1.4.11 non-text)",
  worstGlyph >= 3,
  `worst ${worstGlyph.toFixed(2)}:1`
);

console.log("\n=== no Unicode character standing in for an icon ===");
const uni = await page.evaluate(() => {
  const BAD =
    /[\u25A0-\u25FF\u2190-\u21FF\u2300-\u23FF\u2000-\u206F\u25CC\u25E7\u25A4\u2039\u203A\u2304]/g;
  const ALLOW = new Set(["\u2026", "\u00b7", "\u2014", "\u2013", "\u2019"]);
  const hits = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    for (const m of n.textContent.match(BAD) || []) {
      if (ALLOW.has(m)) {
        continue;
      }
      hits.push(
        `${m} in <${n.parentElement.tagName.toLowerCase()}.${n.parentElement.className}>`
      );
    }
  }
  return hits;
});
check(
  "no Unicode glyph used as an icon",
  uni.length === 0,
  uni.length ? uni.slice(0, 4).join(" | ") : "none"
);

// ---- DW-3.4: the dark ramp actually activates -------------------------------
console.log(
  "\n=== DW-3.4 — dark ramp under the project's .dark class variant ==="
);
const themed = await page.evaluate(() => {
  // Chrome computes color-mix()/oklch() to oklab(...)/oklch(...), NOT rgb(...),
  // so parsing the string for three numbers yields nonsense. Paint each colour
  // onto a 1x1 canvas and read the pixel — the renderer's own conversion.
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const hex = (v) => {
    ctx.clearRect(0, 0, 1, 1);
    try {
      ctx.fillStyle = v;
    } catch {
      return v;
    }
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
  };
  const read = () => {
    const cs = getComputedStyle(document.body);
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    probe.style.color = "var(--neutral-1)";
    const n1 = getComputedStyle(probe).color;
    probe.remove();
    return {
      body: hex(cs.backgroundColor),
      ink: hex(cs.color),
      neutral1: hex(n1),
    };
  };
  const light = read();
  document.documentElement.classList.add("dark");
  const dark = read();
  document.documentElement.classList.remove("dark");
  return { light, dark };
});
console.log(
  `     light: body-bg ${themed.light.body}  ink ${themed.light.ink}  --neutral-1 ${themed.light.neutral1}`
);
console.log(
  `     dark : body-bg ${themed.dark.body}  ink ${themed.dark.ink}  --neutral-1 ${themed.dark.neutral1}`
);
const lum = (h) => {
  const n = h.replace("#", "");
  return (
    [0, 2, 4].reduce((a, i) => a + Number.parseInt(n.slice(i, i + 2), 16), 0) /
    3
  );
};
check(
  ".dark flips the page ground from light to dark",
  lum(themed.light.body) > 200 && lum(themed.dark.body) < 60,
  `${lum(themed.light.body).toFixed(0)} -> ${lum(themed.dark.body).toFixed(0)}`
);
check(
  ".dark flips the ink from dark to light",
  lum(themed.light.ink) < 80 && lum(themed.dark.ink) > 180,
  `${lum(themed.light.ink).toFixed(0)} -> ${lum(themed.dark.ink).toFixed(0)}`
);
check(
  ".dark re-solves the ramp (neutral-1 is a different value, not an inversion)",
  themed.light.neutral1 !== themed.dark.neutral1,
  `${themed.light.neutral1} vs ${themed.dark.neutral1}`
);

await browser.close();
console.log(
  "\n" + (fails === 0 ? "ALL DOM CHECKS PASS" : `${fails} DOM CHECKS FAILED`)
);
process.exit(fails ? 1 : 0);
