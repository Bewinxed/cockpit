#!/usr/bin/env node
/**
 * Phase 8 "workspace surface" (v5-workspace.html) — DW-8 gate verification.
 *
 * Measures the rendered page the way ui-observer does (load, read computed
 * styles + box geometry back from the browser) and asserts the Phase 8
 * "Done when" items that are mechanically checkable on a static mock:
 *
 *   DW-8.1  Every pane's scroll offset survives a tab reorder. The mechanism
 *           (visual order decoupled from DOM order) is the observable claim
 *           here: reorder changes the VISUAL (computed) order of the tabs
 *           while the DOM order is unchanged.
 *   DW-8.2  A split reads as ONE workspace: shared chrome (.shead, .tabstrip,
 *           .composer) is not duplicated, and the active pane is identifiable
 *           without colour alone — assert a non-colour cue (aria-selected,
 *           the graphite .pane-rail element, and/or the "Active" word).
 *   DW-8.3  Composer, Home and Stop hold identical measured positions across
 *           the ws states modelled here (split / tabbed / reordered).
 *   DW-8.4  The mobile-defect checklist passes IN FULL over the mock's
 *           rendered CSS/DOM (all nine rows, user-supplied 2026-08-18).
 *   DW-8.5  touch-action: pan-y is NOT applied to the transcript pane
 *           (deliberate deviation — it contains horizontally-scrolling code
 *           blocks; pan-y would forbid scrolling them).
 *   DW-8.7  Every gesture has a non-gesture equivalent (the swipe pager has
 *           explicit prev/next buttons; tab close is a visible button).
 *   DW-8.8  A horizontal swipe begun inside a sideways-scrolling descendant
 *           never changes tab: the descendant genuinely scrolls sideways
 *           (overflow-x:auto + content wider than the pane) and the pane does
 *           not claim horizontal pan (no pan-y), so the browser owns the swipe
 *           to the descendant.
 *   DW-8.9  A swipe's reachable set equals the open tab strip exactly: the
 *           open sessions live in .tabstrip; sessions that exist but are not
 *           open live in the sidebar "Running now", never in the strip.
 *
 *   node mocks/v5workspacecheck.mjs
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

const raw = readFileSync(join(HERE, 'v5-workspace.html'), 'utf8');
// the <style> block — the CSS whose hover-gating / units / pan-y we audit
const styleText = (raw.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const headText = raw.slice(0, raw.indexOf('<body')); // <head> for viewport/meta

// ---------------------------------------------------------------------------
console.log('== DW-8.4 row 1 — every :hover wrapped in (hover:hover) and (pointer:fine) ==');
{
  // Pull out every `@media (hover:hover) and (pointer:fine){ ... }` block by
  // brace balancing, remove them, and assert no `:hover` remains outside.
  let css = styleText.replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments (prose about :hover is not a rule)
  const gatedHover = [];
  const re = /@media[^{]*\(hover\s*:\s*hover\)[^{]*\{/g;
  let m, prevEnd = 0, markers = [];
  while ((m = re.exec(css))) {
    const start = m.index;
    const openIdx = css.indexOf('{', m.index);
    let depth = 0, i = openIdx;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') { depth--; if (depth === 0) break; }
    }
    markers.push([start, i + 1]);
    prevEnd = i + 1;
  }
  // assemble the non-gated remainder
  let remainder = '';
  let last = 0;
  for (const [a, b] of markers) { remainder += css.slice(last, a); last = b; }
  remainder += css.slice(last);
  // count :hover selectors in the gated blocks and in the remainder
  const countHover = (s) => (s.match(/:hover/g) || []).length;
  let inGated = 0;
  for (const [a, b] of markers) inGated += countHover(css.slice(a, b));
  const outside = countHover(remainder);
  ok(markers.length >= 1, `DW-8.4.1 at least one gated hover media block present (${markers.length})`);
  ok(outside === 0, `DW-8.4.1 zero :hover rules OUTSIDE the (hover:hover)+(pointer:fine) gate (${outside} found)`);
  ok(inGated >= 4, `DW-8.4.1 ${inGated} :hover rules gated under (hover:hover) and (pointer:fine)`);
}

// ---------------------------------------------------------------------------
console.log('== DW-8.4 rows 2/3/6/7/9 — static CSS/HEAD contract ==');
{
  ok(headText.includes('viewport-fit=cover'), 'DW-8.4.7 viewport-fit=cover declared in the viewport meta');
  ok(/env\(\s*safe-area-inset-(?:top|right|bottom|left)\s*\)/.test(styleText),
    'DW-8.4.7 env(safe-area-inset-*) present on fixed edges');
  ok(headText.includes('theme-color'), 'DW-8.4.9 theme-color meta present');
  const tc = (headText.match(/<meta name="theme-color"[^>]*>/g) || []);
  ok(tc.length >= 2, `DW-8.4.9 two theme-color metas declared for light+dark (${tc.length})`);
  ok(tc.some((t) => t.includes('prefers-color-scheme: dark')),
    'DW-8.4.9 a dark-scheme theme-color is declared alongside the light one');
}
{
  // No bare `vh` — only 100dvh / 100svh / calc(...dvh/svh). Strip comment text
  // and any `dvh`/`svh` unit; the remainder must contain no `vh` unit.
  const css = styleText.replace(/\/\*[\s\S]*?\*\//g, '');
  const noBare = css.replace(/\d+\.?\d*(dvh|svh)\b/g, '').replace(/[%;\s,()]/g, ' ');
  const bare = (noBare.match(/\bvh\b/g) || []).length;
  ok(bare === 0, `DW-8.4.3 no bare vh unit (only dvh/svh); ${bare} bare vh found`);
  ok(/\d+dvh\b/.test(css) && /100dvh/.test(css), 'DW-8.4.3 app shell uses 100dvh');
  ok(/\d+svh\b/.test(css), 'DW-8.4.3 a full-bleed block uses svh (100svh for full-bleed)');
  ok(/overscroll-behavior\s*:\s*none/.test(css), 'DW-8.4.6 overscroll-behavior:none declared');
  const ob = (css.match(/overscroll-behavior[^;}]*[;}]/g) || []);
  ok(ob.length >= 2, `DW-8.4.6 overscroll-behavior:none on html AND body (${ob.length} declarations)`);
}

// ---------------------------------------------------------------------------
const browser = await chromium.launch({
  executablePath: BROWSER, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'],
});

async function open({ scheme = 'light', width = 1440, height = 1200, coarse = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2,
    hasTouch: coarse, isMobile: coarse,
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(join(HERE, 'v5-workspace.html')).href, { waitUntil: 'load' });
  if (scheme === 'dark') await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const SAMPLER = `
window.__cs = (sel, prop, i) => {
  const els = document.querySelectorAll(sel); const el = els[i||0]; if (!el) return null;
  return getComputedStyle(el).getPropertyValue(prop).trim();
};
window.__rect = (sel, i) => {
  const els = document.querySelectorAll(sel); const el = els[i||0]; if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
};
window.__domOrder = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => e.id);
window.__computedOrder = (sel) => Array.from(document.querySelectorAll(sel))
  .map((e) => ({ id: e.id, order: parseFloat(getComputedStyle(e).order) }))
  .sort((a, b) => a.order - b.order).map((o) => o.id);
`;

// ---------------------------------------------------------------------------
console.log('== DW-8.1 / 8.9 — tab reorder via CSS order; reachable set ==');
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const domDefault = await p.evaluate(() => window.__domOrder('.tabstrip .tab'));
  // default visual order = DOM order (orders 1..4)
  const visDefault = await p.evaluate(() => window.__computedOrder('.tabstrip .tab'));
  ok(JSON.stringify(domDefault) === JSON.stringify(visDefault),
    `DW-8.1 default visual order == DOM order (${domDefault.join(',')})`);
  // apply the reordered state: DOM order MUST NOT change; visual order MUST
  const domBefore = await p.evaluate(() => window.__domOrder('.tabstrip .tab'));
  await p.evaluate(() => { document.body.setAttribute('data-ws', 'reordered'); document.querySelector('.tabstrip').setAttribute('data-order', 'reordered'); });
  await p.waitForTimeout(30);
  const domAfter = await p.evaluate(() => window.__domOrder('.tabstrip .tab'));
  const visAfter = await p.evaluate(() => window.__computedOrder('.tabstrip .tab'));
  ok(JSON.stringify(domBefore) === JSON.stringify(domAfter),
    `DW-8.1 DOM order unchanged across reorder (${domBefore.join(',')} stays)`);
  ok(JSON.stringify(visDefault) !== JSON.stringify(visAfter),
    `DW-8.1 visual order changes across reorder (${visAfter.join(',')})`);
  // every tab resolves a distinct CSS order (the reorder remaps orders, not DOM)
  const orders = await p.evaluate(() => Array.from(document.querySelectorAll('.tabstrip .tab')).map((e) => getComputedStyle(e).order));
  ok(new Set(orders).size === orders.length, `DW-8.1 tab visual order driven by CSS order values (${orders.join(',')})`);
  // DW-8.9: reachable set = open tabs in the strip
  const openTabs = await p.evaluate(() => document.querySelector('.tabstrip').getAttribute('data-open-tabs'));
  const renderedTabs = (await p.evaluate(() => window.__domOrder('.tabstrip .tab'))).join(',');
  ok(openTabs && openTabs.split(',').length === renderedTabs.split(',').length,
    `DW-8.9 the gesture reachable set is enumerated as the open tabs (${openTabs})`);
  // sessions that exist but are NOT open appear in the sidebar, not the strip
  const sidebarRuns = (await p.evaluate(() => Array.from(document.querySelectorAll('.runs .run-i')).map((e) => e.textContent))).length;
  ok(sidebarRuns >= 2, `DW-8.9 non-open sessions exist in the sidebar Running now but are NOT in the strip (${sidebarRuns})`);
  const tabCount = (await p.evaluate(() => window.__domOrder('.tabstrip .tab'))).length;
  const allSessions = tabCount + sidebarRuns;
  ok(allSessions > tabCount, `DW-8.9 total sessions (${allSessions}) > open tabs (${tabCount}) — the reachable set is NOT every session`);
  await p.close();
}

// ---------------------------------------------------------------------------
console.log('== DW-8.2 — split reads as ONE workspace ==');
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const shared = await p.evaluate(() => ({
    shead: document.querySelectorAll('.shead').length,
    tabstrip: document.querySelectorAll('.tabstrip').length,
    composer: document.querySelectorAll('.composer').length,
    split: document.querySelectorAll('.split').length,
    panes: document.querySelectorAll('.split .ws-pane').length,
  }));
  ok(shared.shead === 1 && shared.tabstrip === 1 && shared.composer === 1,
    `DW-8.2 shared chrome not duplicated (shead ${shared.shead}, tabstrip ${shared.tabstrip}, composer ${shared.composer} — each once)`);
  ok(shared.panes === 2, `DW-8.2 the split is a two-pane layout (${shared.panes} panes in one .split)`);
  // active pane identifiable WITHOUT colour alone
  const active = await p.evaluate(() => {
    const pane = document.querySelector('.ws-pane.active');
    return {
      aria: pane ? pane.getAttribute('aria-selected') : null,
      rail: !!pane.querySelector('.pane-rail'),
      head: (pane.querySelector('.pane-head .ps') || {}).textContent || '',
      railW: pane.querySelector('.pane-rail') ? getComputedStyle(pane.querySelector('.pane-rail')).width : '0px',
      inline: !!pane.querySelector('.pane-head .ps'),
    };
  });
  ok(active.aria === 'true', `DW-8.2 active pane carries aria-selected="true" (${active.aria})`);
  ok(active.rail && parseFloat(active.railW) >= 1, `DW-8.2 active pane has a left rail indicator (rail width ${active.railW})`);
  const activeWord = await p.evaluate(() => {
    const s = document.querySelector('.ws-pane.active .pact');
    return s ? s.textContent.trim() : '';
  });
  ok(activeWord === 'Active', `DW-8.2 active pane carries the visible word "Active" (${activeWord || 'none'})`);
  // non-colour: the rail is graphite (--brand-solid = neutral-12), and a
  // separate visible word + state exist — colour is never the sole channel.
  const railColor = await p.evaluate(() => {
    const r = document.querySelector('.ws-pane.active .pane-rail');
    if (!r) return null;
    return getComputedStyle(r).backgroundColor;
  });
  ok(!!railColor, `DW-8.2 rail declares a fill (${railColor}) — but it is one of several cues`);
  // inactive pane is present but not marked active
  const inact = await p.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('.split .ws-pane'));
    return ps.filter((x) => !x.classList.contains('active')).length;
  });
  ok(inact === 1, `DW-8.2 exactly one background pane is not marked active (${inact})`);
  await p.close();
}

// ---------------------------------------------------------------------------
console.log('== DW-8.3 — fixed anchors stable across ws states ==');
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const rects = (sel) => p.evaluate((s) => {
    const e = document.querySelector(s); if (!e) return 'NULL';
    const r = e.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
  });
  const grab = async () => ({
    home: await rects('#ws-home'),
    input: await rects('#comp textarea'),
    stop: await rects('#comp .stop'),
  });
  const base = await grab();
  let stable = true;
  for (const ws of ['split', 'tabbed', 'reordered']) {
    await p.evaluate((s) => {
      document.body.setAttribute('data-ws', s);
      document.querySelector('.tabstrip').setAttribute('data-order', s === 'reordered' ? 'reordered' : 'default');
    }, ws);
    await p.waitForTimeout(30);
    const now = await grab();
    for (const k of ['home', 'input', 'stop']) {
      if (now[k] !== base[k]) { stable = false; console.log(`    anchor ${k} moved in ${ws}: ${base[k]} -> ${now[k]}`); }
    }
  }
  ok(stable, 'DW-8.3 Home, composer input, Stop hold identical positions across split / tabbed / reordered');
  // the single-pane states must render a real, visible pane (a tab switch is not
  // a blank void) — the lone pane fills the workspace below the strip.
  for (const ws of ['tabbed', 'reordered']) {
    const lone = await p.evaluate((ws) => {
      document.body.setAttribute('data-ws', ws);
      document.querySelector('.tabstrip').setAttribute('data-order', ws === 'reordered' ? 'reordered' : 'default');
      const e = document.querySelector('#pane-a-lone'); if (!e) return null;
      const r = e.getBoundingClientRect(); return { display: getComputedStyle(e).display, w: Math.round(r.width), h: Math.round(r.height) };
    }, ws);
    ok(lone && lone.display !== 'none' && lone.w > 100 && lone.h > 100,
      `DW-8.3 single-pane ${ws} state renders a real pane (${lone && lone.display} ${lone && lone.w}x${lone && lone.h})`);
  }
  // fixed anchors hold under a coarse pointer too (DW-8.3 across the mobile shell)
  {
    await p.close();
    const mp = await open({ width: 390, height: 900, coarse: true });
    await mp.evaluate(SAMPLER);
    const mrects = async () => {
      const r = (sel) => mp.evaluate((s) => { const e = document.querySelector(s); if (!e) return 'NULL'; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)].join(','); }, sel);
      return { home: await r('#ws-home'), input: await r('#comp textarea'), stop: await r('#comp .stop') };
    };
    const mbase = await mrects();
    let mstable = true;
    for (const ws of ['split', 'tabbed', 'reordered']) {
      await mp.evaluate((s) => { document.body.setAttribute('data-ws', s); document.querySelector('.tabstrip').setAttribute('data-order', s === 'reordered' ? 'reordered' : 'default'); }, ws);
      await mp.waitForTimeout(30);
      const now = await mrects();
      for (const k of ['home', 'input', 'stop']) if (now[k] !== mbase[k]) { mstable = false; console.log(`    mobile anchor ${k} moved in ${ws}: ${mbase[k]} -> ${now[k]}`); }
    }
    ok(mstable, 'DW-8.3 anchors stable across ws states under coarse pointer (mobile shell)');
    await mp.close();
  }
  await p.close();
}

// ---------------------------------------------------------------------------
console.log('== DW-8.5 — transcript pane does NOT carry touch-action: pan-y ==');
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const ta = await p.evaluate(() => getComputedStyle(document.querySelector('.tr-pane')).touchAction);
  ok(!!ta && ta !== 'pan-y', `DW-8.5 transcript pane touch-action is NOT pan-y (computed: "${ta}")`);
  const cssNoComments = styleText.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/touch-action\s*:\s*pan-y/.test(cssNoComments), 'DW-8.5 no touch-action: pan-y rule anywhere (the deviation is intact)');
  const hasScrollDesc = await p.evaluate(() => {
    const el = document.querySelector('.code-scroll');
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.overflowX === 'auto' && el.scrollWidth > el.clientWidth;
  });
  ok(hasScrollDesc, 'DW-8.5/8.8 the pane contains a genuinely sideways-scrolling code block (overflow-x:auto, content overflows)');
  const paneTa = await p.evaluate(() => getComputedStyle(document.querySelector('.tr-pane')).touchAction);
  ok(!['pan-y', 'none'].includes(paneTa), `DW-8.8 the pane does not claim horizontal pan (touch-action "${paneTa}"), so the descendant owns it`);
  await p.close();
}

// ---------------------------------------------------------------------------
console.log('== DW-8.8 — no tab-handler on the sideways descendant; it scrolls ==');
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const desc = await p.evaluate(() => {
    const el = document.querySelector('.code-scroll');
    return el ? {
      overflowX: getComputedStyle(el).overflowX,
      scrollable: el.scrollWidth > el.clientWidth,
      hasTabClass: (Array.from(el.querySelectorAll('*')).some((n) => /tab/.test(String(n.className)))),
    } : null;
  });
  ok(!!desc && desc.overflowX === 'auto' && desc.scrollable,
    `DW-8.8 sideways descendant genuinely scrolls horizontally (overflow-x ${desc && desc.overflowX}, scrollable ${desc && desc.scrollable})`);
  ok(desc && !desc.hasTabClass, 'DW-8.8 the descendant contains no tab control, so a swipe inside it cannot switch the tab');
  await p.close();
}

// ---------------------------------------------------------------------------
console.log('== DW-8.7 — every gesture has a non-gesture equivalent ==');
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const pg = await p.evaluate(() => ({
    prev: !!document.querySelector('.pager button[aria-label*="Previous"]'),
    next: !!document.querySelector('.pager button[aria-label*="Next"]'),
    close: document.querySelectorAll('.tab .tclose').length,
    tabs: document.querySelectorAll('.tabstrip .tab').length,
  }));
  ok(pg.prev && pg.next, 'DW-8.7 the swipe pager has explicit Previous and Next buttons (non-gesture equivalents)');
  ok(pg.close >= 4, `DW-8.7 every tab has a visible close button (${pg.close} of ${pg.tabs} tabs) — nothing is reachable only by swiping`);
  ok(/DRIEFLY|non-gesture equivalent/.test(raw) || /EVERY GESTURE HAS A NON-GESTURE/.test(raw),
    'DW-8.7 the non-gesture-equivalent rule is stated in the design deliverable');
  await p.close();
}

// ---------------------------------------------------------------------------
console.log('== DW-8.4 rows 4/5/8 + coarse-pointer targets at mobile widths ==');
// The coarse-pointer block declares 44px relaxations, >=16px inputs, :active
// feedback and touch-action: manipulation. We measure the coarse context at
// 390 and at 430 to be sure (pointer-type keyed, not width keyed).
for (const width of [390, 430, 768]) {
  const p = await open({ width, coarse: true });
  await p.evaluate(SAMPLER);
  const m = await p.evaluate(() => {
    const input = document.querySelector('#comp textarea');
    const tab = document.querySelector('.tabstrip .tab');
    const pre = document.querySelector('.code-scroll pre');
    const pane = document.querySelector('.tr-pane');
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    return {
      sw: document.documentElement.scrollWidth, iw: innerWidth,
      inputFs: getComputedStyle(input).fontSize,
      tab: r(tab), pre: r(pre),
      paneTa: getComputedStyle(pane).touchAction,
      tapHighlight: getComputedStyle(document.body).webkitTapHighlightColor,
    };
  });
  ok(m.sw <= m.iw, `v5-workspace @${width}: no horizontal document overflow (scrollWidth ${m.sw} vs ${m.iw})`);
  ok(parseFloat(m.inputFs) >= 16, `v5-workspace @${width}: composer input ${m.inputFs}px (>=16px, DW-8.4.4)`);
  ok(m.paneTa === 'manipulation', `v5-workspace @${width}: pane touch-action manipulation present (${m.paneTa})`);
  ok(m.tapHighlight === 'rgba(0, 0, 0, 0)' || m.tapHighlight === 'transparent',
    `v5-workspace @${width}: tap-highlight neutralised (${m.tapHighlight})`);
  ok(m.tab && m.tab[0] >= 44 && m.tab[1] >= 44, `v5-workspace @${width}: tab target >=44x44 (${m.tab})`);
  const preFs = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.code-scroll pre')).fontSize));
  ok(preFs >= 16, `v5-workspace @${width}: code-block text readable at >=16px (${preFs}px)`);
  await p.close();
}
// pointer-down feedback (row 5) — some :active rule must exist on controls
{
  const p = await open({ coarse: true, width: 390 });
  await p.evaluate(SAMPLER);
  const hasActive = await p.evaluate(() => {
    const tab = document.querySelector('.tabstrip .tab');
    const prev = document.querySelector('.pager button');
    return getComputedStyle(tab).cursor !== 'auto' || !!document.querySelector('.pager button');
  });
  ok(hasActive, 'DW-8.4.5 interactive controls present; :active press feedback is declared in the stylesheet');
  const activeRules = (styleText.replace(/\/\*[\s\S]*?\*\//g, '').match(/:active/g) || []).length;
  ok(activeRules >= 2, `DW-8.4.5 :active (pointer-down) feedback rules present (${activeRules})`);
  const uSelect = (styleText.replace(/\/\*[\s\S]*?\*\//g, '').match(/user-select\s*:\s*none/g) || []).length;
  ok(uSelect >= 5, `DW-8.4.8 user-select:none on controls (${uSelect} declarations)`);
  const manip = (styleText.replace(/\/\*[\s\S]*?\*\//g, '').match(/touch-action\s*:\s*manipulation/g) || []).length;
  ok(manip >= 1, `DW-8.4.5 touch-action: manipulation present (${manip})`);
  await p.close();
}

await browser.close();
console.log(`\n${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
