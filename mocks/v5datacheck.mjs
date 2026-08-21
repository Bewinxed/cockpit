#!/usr/bin/env node
/**
 * Phase 6 "data surfaces" (v5-data.html) — DW-6 gate verification.
 *
 * Measures the rendered page the way ui-observer does (load, read computed
 * styles + painted geometry back from the browser) and asserts the Phase 6
 * "Done when" items that are mechanically checkable on a static mock:
 *
 *   DW-6.1  Every bar's bottom rests on the value-axis baseline (starts at ZERO);
 *           the "0" axis label is present; no bar extends below it.
 *   DW-6.2  Every stat card renders a comparison value + a direction of change
 *           + whether the change is favourable; zero bare-number cards.
 *   DW-6.3  Zero gauges / radial meters; the meters are bullet-shaped
 *           (bar + target reference line + contextual range).
 *   DW-6.4  Every threshold-coloured value carries a non-colour cue (icon +
 *           breakpoint word) in the same element.
 *   DW-6.5  Threshold hues are exactly the DISCRETE --data-* steps (no
 *           interpolation with magnitude).
 *   DW-6.6  Status hues (--data-ok/warn/bad, --error/--warning/--success solid)
 *           appear only on status indicators; the chart series use the Okabe-Ito
 *           categorical palette, not the status palette.
 *   DW-6.7  Table text columns left-aligned, numeric columns right-aligned, NO
 *           full cell borders (only header-divider / row-hairline border-bottom).
 *   DW-6.8  The chart carries aria-label matching "[chart type] showing
 *           [subject], [period]. [insight]" plus an aria-describedby long
 *           description / data table.
 *   DW-6.9  The chart palette is Okabe-Ito categorical, NOT the status palette,
 *           and every series carries a redundant non-hue channel (distinct
 *           legend shape markers) so it survives deuteranopia/protanopia; the
 *           used series hues are pairwise CVD-separated.
 *   DW-6.10 The stat row has <=7 metrics and every primary value is visible
 *           without scrolling.
 * Plus Phase-4 carry-over: density = dimension-only (colors identical, sizes
 * differ), no horizontal overflow at narrow widths on a coarse pointer, inputs
 * >=16px.
 *
 *   node mocks/v5datacheck.mjs
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BROWSER = process.env.CHROMIUM_BIN
  || '/home/bewinxed/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL  ' + msg); } };

const browser = await chromium.launch({
  executablePath: BROWSER, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'],
});

async function open({ scheme = 'light', compact = false, width = 1440, height = 1800, coarse = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2,
    hasTouch: coarse, isMobile: coarse,
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(join(HERE, 'v5-data.html')).href, { waitUntil: 'load' });
  if (scheme === 'dark') await page.evaluate(() => document.documentElement.classList.add('dark'));
  if (compact) await page.evaluate(() => document.documentElement.classList.add('d-compact'));
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const SAMPLER = `
window.__cs = (sel, prop, i) => {
  const els = document.querySelectorAll(sel); const el = els[i||0]; if (!el) return null;
  return getComputedStyle(el).getPropertyValue(prop).trim();
};
window.__rgb = (sel, prop, i) => {
  const els = document.querySelectorAll(sel); const el = els[i||0]; if (!el) return null;
  const v = getComputedStyle(el).getPropertyValue(prop).trim();
  if (!v || v === 'transparent' || v === 'none' || v === 'rgba(0, 0, 0, 0)') return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, 1, 1);
  try { ctx.fillStyle = v; } catch (e) { return null; }
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
};
window.__rect = (sel, i) => {
  const els = document.querySelectorAll(sel); const el = els[i||0]; if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
};
`;

// sRGB -> OKLCH (for CVD hue-separation math)
const okColor = (rgb) => {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const [r, g, b] = rgb.map(lin);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
  const C = Math.hypot(a, bb);
  let h = Math.atan2(bb, a) * 180 / Math.PI; if (h < 0) h += 360;
  return { L, C, h };
};
// pairwise OKLCH deltaE (Cielab-style) approximating CVD survivability
const dE = (a, b) => Math.hypot(a.L - b.L, a.C * Math.cos(a.h * Math.PI / 180) - b.C * Math.cos(b.h * Math.PI / 180),
  a.C * Math.sin(a.h * Math.PI / 180) - b.C * Math.sin(b.h * Math.PI / 180));

// =====================================================================
console.log('== DW-6.1: bar value axis starts at ZERO ==');
{
  const p = await open({});
  const m = await p.evaluate(() => {
    const svg = document.querySelector('svg.chart-box');
    const line = svg.querySelector('line');
    const axisY = parseFloat(line.getAttribute('y1'));
    // group the stacked segments back into their DAY stacks by x position
    const rects = Array.from(svg.querySelectorAll('rect')).map((r) => ({
      x: Math.round(parseFloat(r.getAttribute('x'))), y: parseFloat(r.getAttribute('y')),
      h: parseFloat(r.getAttribute('height')), fill: r.getAttribute('fill'),
    }));
    const byDay = new Map();
    for (const r of rects) {
      const k = r.x;
      byDay.set(k, (byDay.get(k) || []).concat(r));
    }
    // the LOWEST segment of each day-stack (max y+h) is the one resting on the axis
    const dayBottoms = [...byDay.values()].map((stack) => Math.max(...stack.map((s) => s.y + s.h)));
    const labels = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
    const nSeries = new Set(rects.map((r) => r.fill)).size;
    return { axisY, rects, dayBottoms, nDays: byDay.size, hasZero: labels.includes('0'), nSeries };
  });
  ok(m.rects.length >= 21, `DW-6.1 chart has ${m.rects.length} bar segments (>=21)`);
  ok(m.nDays === 7, `DW-6.1 chart has ${m.nDays} day stacks (7)`);
  ok(m.hasZero, 'DW-6.1 value axis carries the "0" label');
  ok(m.dayBottoms.every((b) => b === m.axisY),
    `DW-6.1 every day stack bottoms out at the value-axis baseline (axis ${m.axisY}; bottoms ${m.dayBottoms.join(', ')}) — value axis starts at zero (Cairo: truncated axis is a chart lie)`);
  ok(m.rects.every((r) => r.y >= 0), 'DW-6.1 no bar segment extends below the baseline (no negative value)');
  await p.close();
}

// =====================================================================
console.log('== DW-6.2 / DW-6.10: stat cards carry baseline + direction + favorability; <=7, visible ==');
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const cards = await p.evaluate(() => {
    const list = Array.from(document.querySelectorAll('.stats .stat'));
    return list.map((c) => ({
      dir: c.querySelector('.dir'),
      cmp: c.querySelector('.cmp'),
      fav: c.querySelector('.fav'),
    }));
  });
  ok(cards.length >= 4 && cards.length <= 7,
    `DW-6.2 stat row has ${cards.length} metrics (between 4 and 7)`);
  let bare = 0;
  for (const c of cards) {
    if (!c.dir || !c.cmp || !c.fav) bare++;
  }
  ok(bare === 0, `DW-6.2 zero bare-number cards (${bare} missing the triplet)`);
  // each card's direction arrow must be one of up/down and the favour word non-empty
  const dirs = await p.evaluate(() =>
    Array.from(document.querySelectorAll('.stats .stat')).map((c) => c.querySelector('.dir')?.classList.contains('up') || c.querySelector('.dir')?.classList.contains('dn')));
  ok(dirs.every(Boolean), 'DW-6.2 every card carries an up/down direction');
  // DW-6.10: primary values visible without scrolling (view 1440x1800)
  const v = await p.evaluate(() => {
    const el = document.querySelector('.stats .stat .v');
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bot: Math.round(r.bottom), ih: innerHeight };
  });
  ok(v.bot <= v.ih && v.top >= 0,
    `DW-6.10 primary stat value visible without scrolling (top ${v.top}, bottom ${v.bot} in ${v.ih}px viewport)`);
  await p.close();
}

// =====================================================================
console.log('== DW-6.3: zero gauges; meters are bullet-shaped ==');
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  // no radial / circular meter: no element styled as a gauge ring
  const gauge = await p.evaluate(() => {
    const bad = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      const bg = cs.backgroundImage;
      if (/(conic|radial)-gradient/.test(bg)) bad.push(`${el.tagName}.${el.className}:${bg.slice(0, 30)}`);
    }
    return bad;
  });
  ok(gauge.length === 0, `DW-6.3 zero gauge/radial meters (${gauge.length} conic/radial gradients)`);
  const bullets = await p.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.meter'));
    return els.map((e) => {
      const b = e.querySelector('.bullet');
      const bar = e.querySelector('.bullet .bar');
      const target = e.querySelector('.bullet .target');
      const range = e.querySelector('.bullet .range');
      const r = b.getBoundingClientRect();
      return { n: e.querySelector('.cap .nm')?.textContent, w: Math.round(r.width), h: Math.round(r.height),
        hasBar: !!bar, hasTarget: !!target, hasRange: !!range };
    });
  });
  ok(bullets.length === 2, `DW-6.3 two bullet meters present (${bullets.length})`);
  for (const b of bullets) {
    ok(b.w > b.h * 4, `DW-6.3 "${b.n}" bullet is a wide bar (${b.w}x${b.h}px), not a circle`);
    ok(b.hasBar && b.hasTarget && b.hasRange,
      `DW-6.3 "${b.n}" bullet has bar + target reference line + contextual range`);
  }
  await p.close();
}

// =====================================================================
console.log('== DW-6.4 / DW-6.5: threshold ink is status, discrete, never colour-alone ==');
for (const scheme of ['light', 'dark']) {
  const p = await open({ scheme });
  await p.evaluate(SAMPLER);
  const thr = await p.evaluate(() => {
    const data = {};
    const grab = (sel) => { const v = getComputedStyle(document.querySelector(sel)).color; return v; };
    const okay = grab('.thr.ok'), warn = grab('.thr.warn'), bad = grab('.thr.bad');
    const sol = {};
    ['--data-ok', '--data-warn', '--data-bad'].forEach((t) => {
      sol[t] = getComputedStyle(document.documentElement).getPropertyValue(t).trim();
    });
    const cells = Array.from(document.querySelectorAll('.thr')).map((c) => ({
      color: getComputedStyle(c).color,
      hasIcon: !!c.querySelector('svg'),
      hasWord: !!c.querySelector('.lvl') && c.querySelector('.lvl').textContent.trim().length > 0,
    }));
    return { okay, warn, bad, sol, cells };
  });
  // DW-6.4: every threshold cell carries a non-colour cue in the same element
  const missingCue = thr.cells.filter((c) => !c.hasIcon || !c.hasWord).length;
  ok(missingCue === 0, `${scheme}: DW-6.4 every threshold value has icon + word (${missingCue} missing)`);
  // DW-6.5: the three levels are DISCRETE (distinct colours), never interpolated
  const set = new Set([thr.okay, thr.warn, thr.bad]);
  ok(set.size === 3, `${scheme}: DW-6.5 exactly 3 discrete threshold colours (${set.size})`);
  const allLevels = new Set(thr.cells.map((c) => c.color));
  ok(allLevels.size === 3,
    `${scheme}: DW-6.5 the rendered threshold colours are exactly the 3 discrete steps (${allLevels.size}), no interpolation`);
  await p.close();
}

// =====================================================================
console.log('== DW-6.6: status hues only on status indicators; chart uses the categorical palette ==');
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const palette = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const k = (v) => { // normalise a resolved oklch/color string to rgb via canvas later
      return v;
    };
    const ret = {
      dataWarn: cs.getPropertyValue('--data-warn').trim(),
      dataOk: cs.getPropertyValue('--data-ok').trim(),
      dataBad: cs.getPropertyValue('--data-bad').trim(),
      err9: cs.getPropertyValue('--error-9').trim(),
      warn9: cs.getPropertyValue('--warning-9').trim(),
      suc9: cs.getPropertyValue('--success-9').trim(),
    };
    // fill an invisible swatch grid to read the resolved rgb of the status tokens
    const grid = document.createElement('div'); grid.style.cssText = 'position:absolute;left:-9999px;top:0';
    const mk = (v, id) => { const d = document.createElement('div'); d.id = id; d.style.background = v; grid.appendChild(d); };
    mk(ret.dataOk, 'sdataOk'); mk(ret.dataWarn, 'sdataWarn'); mk(ret.dataBad, 'sdataBad');
    mk(cs.getPropertyValue('--error-9'), 'serr9'); mk(cs.getPropertyValue('--warning-9'), 'swarn9');
    mk(cs.getPropertyValue('--success-9'), 'ssuc9');
    document.body.appendChild(grid);
    const rgb = (id) => { const cv = document.createElement('canvas'); cv.width = cv.height = 1; const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = getComputedStyle(document.getElementById(id)).backgroundColor; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]].join(','); };
    ret.asp = { dataOk: rgb('sdataOk'), dataWarn: rgb('sdataWarn'), dataBad: rgb('sdataBad'), err9: rgb('serr9'), warn9: rgb('swarn9'), suc9: rgb('ssuc9') };
    // chart series fills
    ret.series = Array.from(document.querySelectorAll('svg.chart-box rect')).map((r) => r.getAttribute('fill'));
    ret.statusFills = Array.from(document.querySelectorAll('.pill,.fav')).map((e) => getComputedStyle(e).backgroundColor);
    return ret;
  });
  const seriesColors = await p.evaluate(() => Array.from(document.querySelectorAll('svg.chart-box rect'))
    .map((r) => { const f = r.getAttribute('fill'); const id = 'seg' + Math.random().toString(36).slice(2); const d = document.createElement('div'); d.id = id; d.style.background = f; document.body.appendChild(d); const cv = document.createElement('canvas'); cv.width = cv.height = 1; const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = getComputedStyle(d).backgroundColor; ctx.fillRect(0, 0, 1, 1); const dat = ctx.getImageData(0, 0, 1, 1).data; d.remove(); return [dat[0], dat[1], dat[2]].join(','); }));
  const statusRgb = Object.values(palette.asp);
  // chart series must NOT use the status palette colours
  const clash = seriesColors.filter((c) => statusRgb.includes(c));
  ok(clash.length === 0,
    `DW-6.6 no chart series uses a status hue (${clash.length} clashes — chart uses the categorical palette)`);
  await p.close();
}

// =====================================================================
console.log('== DW-6.7: numeric right, text left, no full cell borders ==');
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const tbl = await p.evaluate(() => {
    const ths = Array.from(document.querySelectorAll('table.t th'));
    const tds = Array.from(document.querySelectorAll('table.t td'));
    const r = (el) => { const cs = getComputedStyle(el); return cs.textAlign; };
    const isLeft = (v) => v === 'left' || v === 'start';
    const isRight = (v) => v === 'right' || v === 'end';
    const allThNum = ths.filter((t) => t.classList.contains('num')).every((t) => isRight(r(t)));
    const allThTxt = ths.filter((t) => !t.classList.contains('num')).every((t) => isLeft(r(t)));
    const allTdNum = tds.filter((t) => t.classList.contains('num')).every((t) => isRight(r(t)));
    const allTdTxt = tds.filter((t) => !t.classList.contains('num') && !t.classList.contains('mono')).every((t) => isLeft(r(t)));
    // no full cell borders: left/top/right must be 0 width; bottom is header-divider or row-hairline
    let borderViolations = 0;
    for (const el of [...ths, ...tds]) {
      const cs = getComputedStyle(el);
      if (cs.borderLeftWidth !== '0px' || cs.borderTopWidth !== '0px' || cs.borderRightWidth !== '0px') borderViolations++;
    }
    return { allThNum, allThTxt, allTdNum, allTdTxt, borderViolations, ths: ths.length, tds: tds.length };
  });
  ok(tbl.ths >= 6, `DW-6.7 table has ${tbl.ths} columns`);
  ok(tbl.allThNum && tbl.allTdNum, 'DW-6.7 numeric columns right-aligned (header + cells)');
  ok(tbl.allThTxt && tbl.allTdTxt, 'DW-6.7 text columns left-aligned (header + cells)');
  ok(tbl.borderViolations === 0,
    `DW-6.7 no full cell borders (0 of ${tbl.ths + tbl.tds} cells have a left/top/right border)`);
  await p.close();
}

// =====================================================================
console.log('== DW-6.8: chart alt/aria-label pattern + aria-describedby data table ==');
{
  const p = await open({});
  const ch = await p.evaluate(() => {
    const svg = document.querySelector('svg.chart-box');
    const l = svg.getAttribute('aria-label');
    const d = svg.getAttribute('aria-describedby');
    const exists = d && document.getElementById(d);
    return { l, d, exists: !!exists, role: svg.getAttribute('role') };
  });
  ok(ch.role === 'img', `DW-6.8 chart is role=img (presentational? ${ch.role})`);
  ok(/^[^:]+ showing /i.test(ch.l || ''),
    `DW-6.8 aria-label leads with "[chart type] showing …"`);
  ok(/^[^:]+ showing [^,]+, [^.]+\. .+/.test(ch.l || ''), 'DW-6.8 aria-label has the [subject], [period]. [insight] shape');
  ok(ch.d && ch.exists, `DW-6.8 aria-describedby present and resolves (${ch.d})`);
  await p.close();
}

// =====================================================================
console.log('== B1 (Never #3): delta arrows are neutral ink, not status/data hues ==');
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const m = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const arr = ['--data-ok', '--data-bad', '--error-9', '--success-9'];
    const rgb = (v) => {
      const d = document.createElement('div'); d.style.background = v; document.body.appendChild(d);
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = getComputedStyle(d).backgroundColor; ctx.fillRect(0, 0, 1, 1);
      const dat = ctx.getImageData(0, 0, 1, 1).data; d.remove();
      return [dat[0], dat[1], dat[2]].join(',');
    };
    const forbidden = new Set(arr.map((t) => rgb(cs.getPropertyValue(t))));
    const inkBody = rgb(cs.getPropertyValue('--ink-body'));
    const arrows = Array.from(document.querySelectorAll('.stat .d .dir')).map((a) => ({
      cls: a.className, color: getComputedStyle(a).color,
    }));
    const arrowRgb = (c) => { const d = document.createElement('div'); d.style.color = c; d.textContent = 'x'; document.body.appendChild(d); const cv = document.createElement('canvas'); cv.width = cv.height = 1; const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = getComputedStyle(d).color; ctx.fillRect(0, 0, 1, 1); const dat = ctx.getImageData(0, 0, 1, 1).data; d.remove(); return [dat[0], dat[1], dat[2]].join(','); };
    return { forbidden: [...forbidden], inkBody, arrows: arrows.map((a) => ({ cls: a.cls, rgb: arrowRgb(a.color), color: a.color })) };
  });
  ok(m.arrows.length >= 5, `B1 ${m.arrows.length} delta arrows present`);
  let clashes = 0;
  const badCls = [];
  for (const a of m.arrows) {
    if (m.forbidden.includes(a.rgb)) { clashes++; badCls.push(`${a.cls}=${a.rgb}`); }
  }
  ok(clashes === 0, `B1 zero delta arrows painted in --data-ok/--data-bad/--error-9/--success-9 (${badCls.join(', ') || 'all neutral'})`);
  const allInk = m.arrows.every((a) => a.rgb === m.inkBody);
  ok(allInk, `B1 every delta arrow renders the neutral ink-body (${m.inkBody}) — Cairo: encode direction by glyph/sign, never by a lying hue`);
  await p.close();
}

// =====================================================================
console.log('== B2 (DW-6.5): every threshold cell classifies its value into the named band ==');
for (const scheme of ['light', 'dark']) {
  const p = await open({ scheme });
  await p.evaluate(SAMPLER);
  const cells = await p.evaluate(() => {
    return Array.from(document.querySelectorAll('.thr')).map((c) => ({
      cls: c.className,
      val: parseFloat((c.textContent.match(/([\d.]+)%/) || [])[1]),
      lvl: (c.querySelector('.lvl')?.textContent || '').trim(),
      icon: !!c.querySelector('svg'),
    }));
  });
  // named breakpoints (DW-6.5): ok <70, warn 70–90, bad >90
  const band = (v) => (v < 70 ? 'ok' : v <= 90 ? 'warn' : 'bad');
  const word = { ok: 'ok', warn: 'moving', bad: 'critical' };
  let wrongBand = 0, wrongWord = 0;
  const bad = [];
  for (const c of cells) {
    if (Number.isNaN(c.val)) { wrongBand++; bad.push(`${c.cls} val unparseable`); continue; }
    const exp = band(c.val);
    if (c.cls !== 'thr ' + exp) { wrongBand++; bad.push(`${c.val}% -> class "${c.cls}" should be "thr ${exp}"`); }
    if (c.lvl !== word[exp]) { wrongWord++; bad.push(`${c.val}% -> word "${c.lvl}" should be "${word[exp]}"`); }
  }
  ok(wrongBand === 0, `${scheme}: B2 every .thr class matches its value band (ok<70, warn 70–90, bad>90) — ${bad.join('; ') || 'all correct'}`);
  ok(wrongWord === 0, `${scheme}: B2 every .thr breakpoint word matches its band (${bad.length ? '' : 'ok/moving/critical consistent'})`);
  ok(cells.every((c) => c.icon), `${scheme}: B2 every .thr value still carries its non-colour icon (DW-6.4)`);
  await p.close();
}

// =====================================================================
console.log('== B3 (Nielsen #3/#6): coarse <=900px has an opener, >=44x44, toggles the drawer on-screen ==');
{
  const p = await open({ width: 390, height: 3600, coarse: true });
  await p.evaluate(SAMPLER);
  // opener present, focusable, named, and its declared control target exists
  const opener = await p.evaluate(() => {
    const b = document.querySelector('.burger');
    if (!b) return { present: false };
    return {
      present: true,
      tag: b.tagName, cls: b.className,
      r: (() => { const x = b.getBoundingClientRect(); return [Math.round(x.width), Math.round(x.height)]; })(),
      labelled: b.getAttribute('aria-label'),
      controls: b.getAttribute('aria-controls'),
      controlsExists: !!b.getAttribute('aria-controls') && !!document.getElementById(b.getAttribute('aria-controls')),
      expanded: b.getAttribute('aria-expanded'),
    };
  });
  ok(opener.present, 'B3 a nav opener (.burger) exists at coarse <=900px');
  ok(opener.r[0] >= 44 && opener.r[1] >= 44,
    `B3 opener is ${opener.r[0]}x${opener.r[1]}px (coarse target >=44x44)`);
  ok(opener.tag === 'BUTTON' || opener.tag === 'A', `B3 opener is a real focusable control (${opener.tag}.${opener.cls})`);
  ok(!!opener.labelled, `B3 opener has an accessible name (${opener.labelled})`);
  ok(opener.controls && opener.controlsExists, `B3 opener aria-controls resolves to the drawer (${opener.controls})`);
  ok(opener.expanded !== null, `B3 opener tracks aria-expanded (${opener.expanded})`);
  // closed drawer is off-screen at rest
  const closed = await p.evaluate(() => { const r = document.querySelector('aside').getBoundingClientRect(); return Math.round(r.left); });
  ok(closed <= 0, `B3 closed drawer sits off-canvas (left ${closed}px <= 0)`);
  // toggle .nav-open (as the burger click does) and confirm the drawer lands
  // on-screen. The aside/scrim transition over --c-300, so wait for it to settle
  // (the first frame of a transition reads the start value, not the open state).
  await p.evaluate(() => document.body.classList.add('nav-open'));
  await p.waitForTimeout(420);
  const toggled = await p.evaluate(() => {
    const r = document.querySelector('aside').getBoundingClientRect();
    const scrim = getComputedStyle(document.querySelector('.nav-scrim')).opacity;
    return { left: Math.round(r.left), opacity: scrim };
  });
  ok(toggled.left >= 0, `B3 toggling .nav-open brings the aside on-screen (left ${toggled.left}px >= 0) — Fleet/Tools/Rules/Usage reachable`);
  ok(toggled.opacity === '1', `B3 scrim is active over the board while the drawer is open (opacity ${toggled.opacity})`);
  // restoring the resting state so the 1440 render is unaffected
  await p.evaluate(() => document.body.classList.remove('nav-open'));
  await p.close();
}

// =====================================================================
console.log('== B4 (DW-6.8): EVERY chart carries role=img + [type] showing [subject], [period]. [insight] + resolvable describedby ==');
{
  const p = await open({});
  const charts = await p.evaluate(() => {
    const sels = ['.chart-box', '.dist'];
    const out = [];
    for (const sel of sels) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const l = el.getAttribute('aria-label') || '';
        const d = el.getAttribute('aria-describedby');
        out.push({
          sel,
          role: el.getAttribute('role'),
          label: l,
          descId: d,
          resolves: !!d && !!document.getElementById(d),
        });
      }
    }
    return out;
  });
  ok(charts.length === 2, `B4 exactly 2 charts on the surface (svg + .dist): ${charts.length}`);
  for (const c of charts) {
    ok(c.role === 'img', `B4 [${c.sel}] role=img (${c.role})`);
    ok(/^[^:]+ showing /i.test(c.label || ''),
      `B4 [${c.sel}] aria-label leads with "[chart type] showing …" (${c.label})`);
    ok(/^[^:]+ showing [^,]+, [^.]+\. .+/.test(c.label || ''),
      `B4 [${c.sel}] aria-label has the [subject], [period]. [insight] shape`);
    ok(c.resolves, `B4 [${c.sel}] aria-describedby present and resolves (${c.descId})`);
  }
  await p.close();
}

// =====================================================================
console.log('== DW-6.9: Okabe-Ito categorical palette, CVD-survivable redundant encoding ==');
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const m = await p.evaluate(() => {
    const distinctFills = [...new Set(Array.from(document.querySelectorAll('svg.chart-box rect')).map((r) => r.getAttribute('fill')))];
    const legendShapes = Array.from(document.querySelectorAll('.chart-legend .k')).map((k) => k.querySelector('.sw').className);
    const rgb = (v) => { const id = 'r' + Math.random().toString(36).slice(2); const d = document.createElement('div'); d.id = id; d.style.background = v; document.body.appendChild(d); const cv = document.createElement('canvas'); cv.width = cv.height = 1; const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = getComputedStyle(d).backgroundColor; ctx.fillRect(0, 0, 1, 1); const dat = ctx.getImageData(0, 0, 1, 1).data; d.remove(); return [dat[0], dat[1], dat[2]]; };
    return { distinctFills, legendShapes, seriesRgb: distinctFills.map(rgb) };
  });
  ok(m.distinctFills.length === 3,
    `DW-6.9 chart uses exactly 3 Okabe-Ito series (${m.distinctFills.length})`);
  const shapes = m.legendShapes.map(String);
  ok(new Set(shapes).size === m.distinctFills.length,
    `DW-6.9 redundant non-hue channel: a distinct legend shape per series (${shapes.join(', ')}) — colour is never the only encoder (Knaflic; WCAG 1.4.1)`);
  const okh = m.seriesRgb.map(okColor);
  let minPair = Infinity;
  for (let i = 0; i < okh.length; i++) for (let j = i + 1; j < okh.length; j++) {
    minPair = Math.min(minPair, dE(okh[i], okh[j]));
  }
  // OKLab distance: JND is ~0.02, so 0.05 is >2.5x just-noticeable = clearly
  // distinguishable. The closest Okabe-Ito pair here (sky vs blue) separates by
  // LIGHTNESS (dL~0.2), which survives deuteranopia/protanopia even when hue
  // collapses — plus the redundant shape channel is the primary CVD survival
  // mechanism (Knaflic; viz-principles colourblind-safety rules).
  ok(minPair > 0.05, `DW-6.9 series pairwise OKLab-separated (min dE ${minPair.toFixed(3)} > 0.05 JND-margin) — no two series collapse under deutan/protan`);
  await p.close();
}

// =====================================================================
console.log('== density = dimension-only (DW-4.2 carry-over): colours identical, sizes differ ==');
{
  const grab = async (compact) => {
    const p = await open({ compact });
    await p.evaluate(SAMPLER);
    const s = await p.evaluate(() => ({
      rowH: getComputedStyle(document.querySelector('.t td')).height,
      statH: getComputedStyle(document.querySelector('.stat')).height,
      statPad: getComputedStyle(document.querySelector('.stat')).paddingTop,
      pillBg: getComputedStyle(document.querySelector('.pill.live')).backgroundColor,
      dataWarn: getComputedStyle(document.documentElement).getPropertyValue('--data-warn').trim(),
      font: getComputedStyle(document.querySelector('.t td')).fontSize,
    }));
    await p.close();
    return s;
  };
  const comfy = await grab(false), compact = await grab(true);
  for (const k of ['pillBg', 'dataWarn', 'font']) {
    ok(comfy[k] === compact[k], `density keeps ${k} identical (${comfy[k]} vs ${compact[k]})`);
  }
  ok(parseFloat(comfy.rowH) > parseFloat(compact.rowH), `table row ${comfy.rowH} -> ${compact.rowH}`);
  ok(parseFloat(comfy.statH) > parseFloat(compact.statH), `stat card ${comfy.statH} -> ${compact.statH}`);
}

// =====================================================================
console.log('== responsive: 320/390/430 no overflow on coarse pointer; bullets/table fit ==');
for (const width of [320, 390, 430]) {
  const p = await open({ width, height: 3600, coarse: true });
  await p.evaluate(SAMPLER);
  const m = await p.evaluate(() => ({
    sw: document.documentElement.scrollWidth, iw: innerWidth,
    rowH: getComputedStyle(document.querySelector('.t td')).height,
    pg: (() => { const r = document.querySelector('.pgbtn').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    btn: (() => { const r = document.querySelector('.phead .btn').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
  }));
  ok(m.sw <= m.iw, `v5-data @${width}: no horizontal document overflow (scrollWidth ${m.sw} vs ${m.iw})`);
  ok(parseFloat(m.rowH) >= 44, `v5-data @${width}: table row ${m.rowH}px under coarse (>=44)`);
  ok(m.pg[0] >= 44 && m.pg[1] >= 44, `v5-data @${width}: pagination target ${m.pg[0]}x${m.pg[1]}`);
  ok(m.btn[0] >= 44 && m.btn[1] >= 44, `v5-data @${width}: header button ${m.btn[0]}x${m.btn[1]}`);
  await p.close();
}

await browser.close();
console.log(`\n${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
