#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
/**
 * Phase 4 v5-components.html — pixel-level verification.
 *
 * The authoring model cannot view PNGs, so this measures the rendered page the
 * way ui-observer does: load each configuration, READ COMPUTED STYLES and
 * PAINTED PIXELS back from the browser, and assert facts:
 *   present / sized / painted  · idle pill has no fill
 *   modal ~460px, two modals, scrim paints
 *   density = dimension-only (colours identical, sizes differ)
 *   focus ring 2px solid + 2px offset
 *   inputs >=16px at every density and 320px  · 320px no horizontal overflow
 *   coarse-pointer targets >=44px
 *   painted contrast for status pills and destructive [+] [×] in both schemes
 *
 *   node mocks/v5check.mjs
 */
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const BROWSER =
  process.env.CHROMIUM_BIN ||
  "/home/bewinxed/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

let fails = 0,
  checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) {
    fails++;
    console.log("  FAIL  " + msg);
  }
};

const browser = await chromium.launch({
  executablePath: BROWSER,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
});

async function open({
  scheme = "light",
  compact = false,
  width = 1440,
  height = 5200,
  coarse = false,
} = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    hasTouch: coarse,
    isMobile: coarse,
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(join(HERE, "v5-components.html")).href, {
    waitUntil: "load",
  });
  if (scheme === "dark") {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
  }
  if (compact) {
    await page.evaluate(() =>
      document.documentElement.classList.add("d-compact")
    );
  }
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const G = ["color", "background-color", "border-color", "border-top-color"];
const SAMPLER = `
window.__cs = (sel, prop) => {
  const el = document.querySelector(sel); if (!el) return null;
  return getComputedStyle(el).getPropertyValue(prop).trim();
};
window.__rgb = (sel, prop) => {
  const el = document.querySelector(sel); if (!el) return null;
  const v = getComputedStyle(el).getPropertyValue(prop).trim();
  if (!v || v === 'transparent' || v === 'none' || v === 'rgba(0, 0, 0, 0)') return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000';
  try { ctx.fillStyle = v; } catch (e) { return null; }
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
};
window.__rect = (sel) => {
  const el = document.querySelector(sel); if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
};
`;

// =====================================================================
console.log("== presence / size / painted fill — light AND dark ==");
for (const scheme of ["light", "dark"]) {
  const p = await open({ scheme });
  await p.evaluate(SAMPLER);
  const probes = {
    "nav-item.on": ".rail .nav-i.on",
    "btn.pri": ".btn.pri",
    "btn (secondary)": ".btn:not(.pri):not(.des):not(.ic)",
    "btn.des (destructive)": ".btn.des",
    "btn.ic (icon-only)": ".btn.ic",
    "card .well (signature move)": ".panel .well",
    "pill.live": ".pill.live",
    "pill.attn": ".pill.attn",
    "pill.done": ".pill.done",
    "pill.fail": ".pill.fail",
    "pill.idle": ".pill.idle",
    "item mark (hue 1)": ".mark-row .mark",
    input: ".inp",
    select: ".sel",
    "page.on": ".page.on",
    sheet: ".sheet",
    "modal (default)": ".scrim.bare .modal .mod-hd",
    "modal close (✕)": ".mod-hd .close",
    "modal callout (warning)": ".modal .callout",
  };
  for (const [name, sel] of Object.entries(probes)) {
    if (!sel) {
      continue;
    }
    const r = await p.evaluate((s) => window.__rect(s), sel);
    if (!r) {
      ok(false, `${scheme}: ${name} NOT FOUND`);
      continue;
    }
    ok(r.w > 0 && r.h > 0, `${scheme}: ${name} sized ${r.w}x${r.h}`);
  }
  // destructive modal: second .modal present
  const nmod = await p.evaluate(
    () => document.querySelectorAll(".modal").length
  );
  ok(nmod === 2, `${scheme}: two modals present (got ${nmod})`);
  // idle pill has no fill
  const idleBg = await p.evaluate(
    (s) => window.__rgb(s, "background-color"),
    ".pill.idle"
  );
  ok(idleBg === null, `${scheme}: idle pill has NO fill`);
  // scrim paints
  const scrim = await p.evaluate(
    (s) => window.__rgb(s, "background-color"),
    ".scrim.bare"
  );
  ok(!!scrim, `${scheme}: scrim bg present to evaluate`);
  // modal ~460px
  const mw = await p.evaluate(
    () => document.querySelector(".modal").getBoundingClientRect().width
  );
  ok(mw >= 448 && mw <= 472, `${scheme}: modal width ${mw}px (~460)`);
  // the recessed-well elevation: the raised panel must differ from the sunken
  // well it contains (panel lighter than well in light, darker in dark).
  const panel = await p.evaluate(
    (s) => window.__rgb(s, "background-color"),
    ".panel"
  );
  const well = await p.evaluate(
    (s) => window.__rgb(s, "background-color"),
    ".panel .well"
  );
  ok(
    JSON.stringify(panel) !== JSON.stringify(well) && !!panel && !!well,
    `${scheme}: raised panel ${panel} differs from well ${well} (inset elevation)`
  );
  await p.close();
}

// =====================================================================
console.log(
  "== density = dimension-only: one tier, colours identical, sizes smaller =="
);
{
  const cols = [
    "color",
    "background-color",
    "background-image",
    "border-top-color",
  ];
  const sel = (base, state) => `${base}`;
  const gDatasets = {};
  for (const compact of [false, true]) {
    const p = await open({ compact });
    await p.evaluate(SAMPLER);
    const snap = await p.evaluate(() => {
      const grab = (s, prop) =>
        getComputedStyle(document.querySelector(s))
          .getPropertyValue(prop)
          .trim();
      return {
        btnH: grab(".btn.pri", "height"),
        btnPad: grab(".btn.pri", "padding-left"),
        btnFill: grab(".btn.pri", "background-color"),
        btnGrad: grab(".btn.pri", "background-image"),
        inpFs: grab(".inp input", "font-size"),
        navH: grab(".rail .nav-i", "height"),
        pillFs: grab(".pill.live", "font-size"),
        pageH: grab(".page.on", "height"),
        wellBg: grab(".panel .well", "background-color"),
        liveBg: grab(".pill.live", "background-color"),
        liveInk: grab(".pill.live", "color"),
        ringOut:
          grab(".st-focus", "outline-width") +
          " " +
          grab(".st-focus", "outline-style") +
          " " +
          grab(".st-focus", "outline-color"),
        ringOff: grab(".st-focus", "outline-offset"),
        modalW: grab(".modal", "width"),
      };
    });
    gDatasets[compact ? "compact" : "comfy"] = snap;
    await p.close();
  }
  const comfy = gDatasets.comfy,
    compact = gDatasets.compact;
  for (const k of [
    "btnFill",
    "btnGrad",
    "wellBg",
    "liveBg",
    "liveInk",
    "ringOut",
    "ringOff",
    "modalW",
  ]) {
    ok(
      comfy[k] === compact[k],
      `density keeps colour/ring/structural-width ${k} identical (${comfy[k]} vs ${compact[k]})`
    );
  }
  ok(
    Number.parseFloat(comfy.btnH) > Number.parseFloat(compact.btnH),
    `button height ${comfy.btnH} -> ${compact.btnH}`
  );
  ok(
    Number.parseFloat(comfy.navH) > Number.parseFloat(compact.navH),
    `nav height ${comfy.navH} -> ${compact.navH}`
  );
  ok(
    Number.parseFloat(comfy.pageH) > Number.parseFloat(compact.pageH),
    `page button ${comfy.pageH} -> ${compact.pageH}`
  );
  ok(
    Number.parseFloat(comfy.inpFs) >= 16 &&
      Number.parseFloat(compact.inpFs) >= 16,
    `input font >=16px both densities (${comfy.inpFs} / ${compact.inpFs})`
  );
}

// =====================================================================
console.log(
  "== modal density reaches the modal: field/btn heights DIFFER per density (C1) =="
);
{
  const grab = async (compact) => {
    const p = await open({ compact });
    await p.evaluate(SAMPLER);
    const r = await p.evaluate(() => ({
      field: getComputedStyle(document.querySelector(".mod-bd .sel")).height,
      btn: getComputedStyle(document.querySelector(".mod-ft .btn")).height,
    }));
    await p.close();
    return r;
  };
  const comfy = await grab(false),
    compact = await grab(true);
  ok(
    Number.parseFloat(comfy.field) > Number.parseFloat(compact.field),
    `modal field height differs per density (${comfy.field} comfy vs ${compact.field} compact)`
  );
  ok(
    Number.parseFloat(comfy.btn) > Number.parseFloat(compact.btn),
    `modal footer btn height differs per density (${comfy.btn} comfy vs ${compact.btn} compact)`
  );
}

// =====================================================================
console.log("== pagination exposes all 8 interaction states (DW-4.4) ==");
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const caps = await p.evaluate(
    () =>
      Array.from(document.querySelectorAll("section.group h2")).map(
        (h) => h.textContent
      ).length && 0
  ); // silence
  // scope to the pagination section: find the <h2> "Pagination" then its .cell caps
  const pg = await p.evaluate(() => {
    const out = { caps: [] };
    for (const s of document.querySelectorAll("section.group")) {
      const h = s.querySelector("h2");
      if (h && h.textContent.trim() === "Pagination") {
        out.caps = Array.from(s.querySelectorAll(".cell .cap")).map((c) =>
          c.textContent.trim()
        );
        out.pages = s.querySelectorAll(".page").length;
      }
    }
    return out;
  });
  ok(
    pg.caps.length >= 8,
    `pagination documents >=8 state cells (${pg.caps.length}: ${pg.caps.join(", ")})`
  );
  const stateMods = [
    "active · press",
    "hover",
    "focus",
    "disabled",
    "loading",
    "error",
    "success",
    "default",
  ];
  for (const s of stateMods) {
    ok(
      pg.caps.some((c) => c.toLowerCase().includes(s.toLowerCase())),
      `pagination exposes the "${s}" state cell`
    );
  }
  await p.close();
}

// =====================================================================
console.log("== focus ring: 2px solid, 2px offset, non-transparent colour ==");
for (const scheme of ["light", "dark"]) {
  const p = await open({ scheme });
  await p.evaluate(SAMPLER);
  const ring = await p.evaluate(
    (s) =>
      window.__cs(s, "outline-width") +
      " " +
      window.__cs(s, "outline-style") +
      " " +
      window.__cs(s, "outline-color"),
    ".st-focus"
  );
  const off = await p.evaluate(
    (s) => window.__cs(s, "outline-offset"),
    ".st-focus"
  );
  ok(ring.startsWith("2px solid"), `${scheme}: focus ring ${ring}`);
  ok(
    !ring.endsWith("transparent") && ring.includes("rgb"),
    `${scheme}: ring colour visible`
  );
  ok(off === "2px", `${scheme}: ring offset ${off}px`);
  await p.close();
}

// =====================================================================
console.log(
  "== responsive: 320/390/430 no overflow; coarse targets >=44px; input 16px =="
);
for (const scheme of ["light", "dark"]) {
  for (const width of [320, 390, 430]) {
    const p = await open({ scheme, width, height: 5200, coarse: true });
    await p.evaluate(SAMPLER);
    const m = await p.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: innerWidth,
      fs: getComputedStyle(document.querySelector(".inp input")).fontSize,
      ic: (() => {
        const r = document.querySelector(".btn.ic").getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)];
      })(),
      page: (() => {
        const r = document.querySelector(".page").getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)];
      })(),
      nav: (() => {
        const r = document.querySelector(".nav-i").getBoundingClientRect();
        return Math.round(r.height);
      })(),
      eye: (() => {
        const r = document.querySelector(".inp .eye").getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)];
      })(),
    }));
    ok(
      m.sw <= m.iw,
      `${scheme} @${width}: no horizontal overflow (scrollWidth ${m.sw} vs ${m.iw})`
    );
    ok(
      Number.parseFloat(m.fs) >= 16,
      `${scheme} @${width}: input font ${m.fs}px`
    );
    ok(
      m.ic[0] >= 44 && m.ic[1] >= 44,
      `${scheme} @${width}: icon button ${m.ic[0]}x${m.ic[1]}`
    );
    ok(
      m.page[0] >= 44 && m.page[1] >= 44,
      `${scheme} @${width}: page button ${m.page[0]}x${m.page[1]}`
    );
    ok(m.nav >= 44, `${scheme} @${width}: nav item ${m.nav}px`);
    ok(
      m.eye[0] >= 44 && m.eye[1] >= 44,
      `${scheme} @${width}: .inp .eye coarse target ${m.eye[0]}x${m.eye[1]} (DW-4.10)`
    );
    await p.close();
  }
}

// =====================================================================
console.log("== painted contrast: status pills + destructive, both schemes ==");
{
  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.039_28 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  for (const scheme of ["light", "dark"]) {
    const p = await open({ scheme });
    await p.evaluate(SAMPLER);
    const pairs = [
      [".pill.live", ".pill.live", "live pill ink on tint"],
      [".pill.attn", ".pill.attn", "attn pill ink on tint"],
      [".pill.done", ".pill.done", "done pill ink on tint"],
      [".pill.fail", ".pill.fail", "fail pill ink on tint"],
      [".btn.des.sol", ".btn.des.sol", "destructive-solid ink on fill"],
      [".callout", ".callout", "warning callout ink on tint"],
      [".btn.pri", ".btn.pri", "primary ink on gradient (bg-color)"],
    ];
    for (const [sel, , name] of pairs) {
      const ink = await p.evaluate((s) => window.__rgb(s, "color"), sel);
      // the *filled* background: solid variant used for bordered/ghost-free
      const bg = await p.evaluate(
        (s) => window.__rgb(s, "background-color"),
        sel
      );
      if (!(ink && bg)) {
        ok(false, `${scheme}: ${name} — could not sample ink ${ink} bg ${bg}`);
        continue;
      }
      const r = ratio(ink, bg);
      // radio.text on a tinted ghost uses the panel field; treat bg on its own fill
      ok(
        r >= 4.5,
        `${scheme}: ${name} ${r.toFixed(2)}:1 (ink ${ink} on ${bg})`
      );
    }
    await p.close();
  }
}

console.log(
  "== density: compact rects strictly smaller than comfortable (pixel gate input) =="
);

const RECTS = [
  "navOn",
  "btnPri",
  "btnDes",
  "btnDesSol",
  "btnIcon",
  "pillLive",
  "pillAttn",
  "pillFail",
  "pillIdle",
  "panel",
  "well",
  "inp",
  "sel",
  "pageOn",
  "modalScrim",
  "modalFt",
  "focRing",
  "mark1",
  "mark2",
  "mark3",
  "sheet",
  "close",
];
const RECT_SEL = {
  navOn: [".rail .nav-i.on", 0],
  btnPri: [".btn.pri", 0],
  btnDes: [".btn.des", 0],
  btnDesSol: [".btn.des.sol", 0],
  btnIcon: [".btn.ic", 0],
  pillLive: [".pill.live", 0],
  pillAttn: [".pill.attn", 0],
  pillFail: [".pill.fail", 0],
  pillIdle: [".pill.idle", 0],
  panel: [".panel", 0],
  well: [".panel .well", 0],
  inp: [".inp", 0],
  sel: [".sel", 0],
  pageOn: [".page.on", 0],
  modalScrim: [".scrim.bare", 0],
  modalFt: [".mod-ft", 0],
  focRing: [".st-focus", 0],
  mark1: [".mark-row .mark", 0],
  mark2: [".mark-row .mark", 1],
  mark3: [".mark-row .mark", 2],
  sheet: [".sheet", 0],
  close: [".mod-hd .close", 0],
};
{
  const fs = await import("node:fs");
  for (const [label, scheme, compact] of [
    ["light", "light", false],
    ["dark", "dark", false],
    ["compact", "light", true],
  ]) {
    const p = await open({ scheme, compact });
    const out = await p.evaluate((sels) => {
      const o = {};
      for (const [name, [sel, i]] of Object.entries(sels)) {
        const el = document.querySelectorAll(sel)[i];
        if (!el) {
          o[name] = null;
          continue;
        }
        const r = el.getBoundingClientRect();
        o[name] = [
          Math.round(r.x),
          Math.round(r.y),
          Math.round(r.width),
          Math.round(r.height),
        ];
      }
      return o;
    }, RECT_SEL);
    fs.writeFileSync(join(HERE, `rects-${label}.json`), JSON.stringify(out));
    await p.close();
  }
  console.log(
    "  written rects-light.json / rects-dark.json / rects-compact.json"
  );
}

await browser.close();
console.log(`\n${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
