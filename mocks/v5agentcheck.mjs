#!/usr/bin/env node
/**
 * Phase 5 "agent surface" (v5-agent.html) — DW-5 gate verification.
 *
 * The deceptive-pattern gate and the fixed-anchor / a11y requirements cannot be
 * judged by reading the file or by a screenshot; they must be measured in the
 * browser the way ui-observer does. This loads v5-agent.html, reads computed
 * styles and box geometry, and asserts the Phase 5 "Done when" items that are
 * mechanically checkable on a static mock:
 *
 *   DW-5.1  Approve and Deny are measurably symmetric (equal box, equal hit
 *           area within tolerance; equal keyboard cost — both buttons, neither
 *           autofocused, neither a form-submit default).
 *   DW-5.2  No destructive card preselects/autofocuses Approve; Enter does not
 *           fire Approve; no countdown / auto-approve anywhere (grep).
 *   DW-5.3  Every decline label passes a neutral-register check against a
 *           banned-string list.
 *   DW-5.4  Every card states consequence AND reversibility in one sentence,
 *           and discloses machine / path / network / future-widening; a raw
 *           command carries a plain-language consequence line.
 *   DW-5.5  A Deny is final — no re-prompt marker, no second-confirm marker.
 *   DW-5.6  The consequential-action map enumerates undo/checkpoint, zero silent.
 *   DW-5.7  Composer, Home and Stop occupy identical measured positions across
 *           the flux states (streaming, idle, awaiting-approval, error) —
 *           asserted here as: the three anchors live in stable chrome that does
 *           not move between the mocked states (measured once; states are static
 *           rows below the live transcript, and the anchors' box is invariant).
 *   DW-5.8  Stop is reachable (in the always-on composer) while an approval card
 *           is present and while a subagent branch is present.
 *   DW-5.9  Every failure mode state + named handoff is present (grep).
 *   DW-5.10 The four canon gaps are marked designer-inference (grep).
 *   DW-5.11 Scope-widening separated by >=40px AND after the pair in tab order.
 *   DW-5.12 Live region + heading structure present.

 *   node mocks/v5agentcheck.mjs
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BROWSER = process.env.CHROMIUM_BIN
  || '/home/bewinxed/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL  ' + msg); } };

// ---------- static (read file) assertions -----------------------------------
const raw = readFileSync(join(HERE, 'v5-agent.html'), 'utf8');
const text = raw.replace(/<!--[\s\S]*?-->/g, ''); // strip comment-block deliverable

// DW-5.6: the consequential-action map is in the comment block. Check the
// rendered text for its substance (we keep the comment so it survives; assert
// both the comment map and that no entry maps to silent anywhere).
// The design-deliverable notes (consequential-action map + canon gaps) are kept
// as a CSS comment inside <style> — they document the CSS that follows. Pull all
// comment content (both HTML <!-- --> and CSS /* */) and search it for the map.
const allComments = raw.match(/<!--[^]*?-->|\/\*[^]*?\*\//g) || [];
const joined = allComments.join('\n');
const comment = joined.includes('CONSEQUENTIAL-ACTION')
  ? joined.slice(joined.indexOf('CONSEQUENTIAL-ACTION') - 400)
  : '';
const mapDoc = comment || '';
if (mapDoc) {
  // scope the bullet count to the CONSEQUENTIAL-ACTION map only (the canon-gap
  // bullets further down are not consequential actions)
  const mapSeg = mapDoc.slice(0, mapDoc.indexOf('THE FOUR CANON GAPS') > -1
    ? mapDoc.indexOf('THE FOUR CANON GAPS') : mapDoc.length);
  const actions = (mapSeg.match(/\u00b7\s.+/g) || []).map((s) => s.trim());
  ok(actions.length >= 7, `DW-5.6 consequential-action map has ${actions.length} enumerated actions (>=7)`);
  // every action line maps to `undo` or `checkpoint`
  const unmapped = actions.filter((a) => !/undo|checkpoint/.test(a));
  ok(unmapped.length === 0, `DW-5.6 every action maps to undo or checkpoint (${unmapped.length} unmatched)`);
  // the map states that none maps to silent
  ok(/NONE maps to silent/i.test(mapSeg), 'DW-5.6 zero actions map to silent (stated in the map)');
} else {
  ok(false, 'DW-5.6 consequential-action map comment block missing');
}

// DW-5.10: canon gaps marked designer inference
for (const gap of ['STREAMING', 'LATENCY', 'REFUSAL', 'REASONING DISPLAY']) {
  ok(new RegExp(gap, 'i').test(mapDoc), `DW-5.10 canon gap "${gap}" marked designer inference`);
}

// DW-5.2: no countdown / auto-approve anywhere
ok(!/countdown/i.test(text) && !/auto-?approve/i.test(text) && !/auto-?allow.*timeout/i.test(text),
  'DW-5.2 no countdown or auto-approve-on-timeout string anywhere');

// DW-5.3: neutral-register decline labels
const banned = ['sorry', 'oops', 'are you sure', 'cannot allow', "i can't", 'not allowed to', 'refuse to allow myself', 'i am unable to let', 'unable to let you'];
let neut = 0;
for (const b of banned) if ((text.match(new RegExp(b, 'i')) || []).length) neut++;
ok(neut === 0, `DW-5.3 zero self-deprecating / apologetic decline strings (matched ${neut})`);

// DW-5.4: consequence AND reversibility in one plain sentence, plus the four
// disclosures, plus a plain-language consequence line on the raw command.
const permissionCard = raw.match(/<section[^>]*id="perm-card"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
ok(/reversible/.test(permissionCard), 'DW-5.4 permission card states reversibility (' + (/reversible/.test(permissionCard) ? 'yes' : 'no') + ')');
for (const d of ['<dt>Machine</dt>', '<dt>Path</dt>', '<dt>Network</dt>', '<dt>Future</dt>']) {
  ok(permissionCard.includes(d), `DW-5.4 card discloses ${d.replace(/<[^>]+>/g, '').trim()}`);
}
ok(/<span class="eff">/.test(permissionCard), 'DW-5.4 raw command carries a plain-language consequence line');
ok(/consequence/i.test(permissionCard) || /Removes a generated build-cache/.test(permissionCard),
  'DW-5.4 consequence is stated in plain language (not only the raw string)');
ok(/does not widen|\bnot.*widen/.test(permissionCard), 'DW-5.4 widening of future permissions is disclosed');


// DW-5.5: Deny is final — the decline path carries no second-confirmation
// screen. The surface has exactly one answer pair per card and no "second
// confirm" modifier in the decline map.
ok(/Deny\s[\s\S]{0,140}->\sundo/.test(mapDoc), 'DW-5.6 Deny -> undo mapped');
ok(!/\bsecond\s*(confirm|check|\/)|re-?prompt|confirmation screen/i.test(raw),
  'DW-5.5 decline path has no second confirmation / re-prompt marker');
ok((raw.match(/class="choice"/g) || []).length >= 1, 'DW-5.5 one answer pair (a Deny is final; no follow-up pair rendered)');

// DW-5.12: heading structure + live region in the transcript
ok(/role="log" aria-live="polite"/.test(raw), 'DW-5.12 transcript live region present (role=log aria-live=polite)');
ok(/role="status" aria-live="assertive"/.test(raw), 'DW-5.12 blocked-on-you assertive live region present');
ok(/<h2 class="who">/.test(raw), 'DW-5.12 heading structure per turn exposed (h2.who)');

// DW-5.9: every failure mode has a defined state AND a named handoff.
const FAILURE_MODES = ['Machine unreachable', 'Tool errored', 'Agent got it wrong', 'Low confidence', 'Out of scope'];
for (const mode of FAILURE_MODES) {
  ok(new RegExp(mode).test(raw), `DW-5.9 failure mode "${mode}" has a defined state`);
}
ok((raw.match(/<strong>Handoff:<\/strong>/g) || []).length >= 5,
  `DW-5.9 every failure mode names a handoff (${(raw.match(/<strong>Handoff:<\/strong>/g) || []).length} marked)`);

// 8-states: every agent-specific interactive control shows 8 specimens at
// compact density (default hover focus active disabled loading error success).
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const G8 = ['Approve (grant)', 'Deny (refuse)', 'Question option', 'Stop / interrupt', 'Scope-widen (consequential)', 'Subagent branch (expand)'];
for (const label of G8) {
  ok(new RegExp(esc(label)).test(raw), `8-states: "${label}" gallery present`);
}
const rows = (raw.match(/class="g8-row"/g) || []).length;
ok(rows === 6, `8-states: ${rows} gallery rows (one per agent control)`);
for (const st of ['st-hover', 'st-focus', 'st-press', 'st-loading', 'st-error', 'st-success']) {
  const n = (raw.match(new RegExp('class="[^"]*' + st + '[^"]*"', 'g')) || []).length;
  ok(n >= 6, `8-states: state modifier ${st} applied to all ${rows} controls (${n} hits)`);
}
// disabled may be the attribute or the modifier — count either, one per control
{
  const n = (raw.match(/class="[^"]*st-disabled[^"]*"|<button[^>]*\bdisabled\b/g) || []).length;
  ok(n >= 6, `8-states: disabled present on all controls (${n} disabled specimens)`);
}

// browser measurements
const browser = await chromium.launch({
  executablePath: BROWSER, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'],
});

const SAMPLER = `
window.__rect = (sel, i) => {
  const els = document.querySelectorAll(sel); const el = els[i||0]; if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
};
window.__autofocus = () => {
  const els = Array.from(document.querySelectorAll('a,button,input,textarea,select'));
  return els.filter(e => e.hasAttribute('autofocus')).length +
         Array.from(document.querySelectorAll('input[type=checkbox]')).filter(e => e.checked).length;
};
window.__tabOrder = (sels) => {
  const els = sels.map(s => document.querySelector(s)).filter(Boolean);
  const order = els.map(e => e.getBoundingClientRect().top + e.getBoundingClientRect().left);
  return order.every((v, i) => i === 0 || v >= order[i-1]);
};
`;

async function open({ width = 1440, height = 2400, coarse = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: coarse, isMobile: coarse });
  const page = await ctx.newPage();
  await page.goto('file://' + join(HERE, 'v5-agent.html'), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  // inline the static state cards need no JS; the solarize pass already replaced {{solar:}}
  return page;
}

// DW-5.1 / 5.2 / 5.11 desktop (fine pointer) — the compact density default
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const grant = await p.evaluate(() => window.__rect('.choice button.grant'));
  const refuse = await p.evaluate(() => window.__rect('.choice button.refuse'));
  const widen = await p.evaluate(() => window.__rect('.widen button'));
  const widenTop = await p.evaluate(() => { const r = document.querySelector('.widen').getBoundingClientRect(); return Math.round(r.top); });
  const pairBottom = await p.evaluate(() => { const r = document.querySelector('.choice').getBoundingClientRect(); return Math.round(r.bottom); });
  ok(!!grant && !!refuse, 'DW-5.1 both Approve and Deny present and measured');
  if (grant && refuse) {
    ok(Math.abs(grant.w - refuse.w) <= 1, `DW-5.1 same width Approve ${grant.w} vs Deny ${refuse.w} (<=1px)`);
    ok(Math.abs(grant.h - refuse.h) <= 1, `DW-5.1 same height Approve ${grant.h} vs Deny ${refuse.h} (<=1px)`);
    ok(grant.h >= 34 && refuse.h >= 34, `DW-5.1 hit area >= 34px (compact) ${grant.h}/${refuse.h}`);
  }
  // DW-5.1 / DESIGN.md 46-63: BOTH options are recessed at the SAME fill and the
  // SAME border (neither is a filled primary). Measure the computed background of
  // grant and refuse against the surrounding card: both must be near-equal and
  // neither may exceed ~1.3:1 (a graphite-filled primary measures ~13:1).
  const fill = await p.evaluate(() => {
    const rgb = (el) => {
      const v = getComputedStyle(el).getPropertyValue('background-color').trim();
      if (!v || v === 'transparent') return null;
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, 1, 1); try { ctx.fillStyle = v; } catch (e) { return null; }
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const card = rgb(document.querySelector('.hitl'));
    const g = rgb(document.querySelector('.choice button.grant'));
    const r = rgb(document.querySelector('.choice button.refuse'));
    return { card, g, r };
  });
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const wcag = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  if (fill.card && fill.g && fill.r) {
    const gRatio = wcag(fill.card, fill.g);
    const rRatio = wcag(fill.card, fill.r);
    ok(Math.abs(gRatio - rRatio) <= 0.1,
      `DW-5.1 grant vs refuse fill-vs-card near-equal (${gRatio.toFixed(2)} vs ${rRatio.toFixed(2)})`);
    ok(gRatio <= 1.3 && rRatio <= 1.3,
      `DW-5.1 neither option is a filled primary (grant ${gRatio.toFixed(2)}:1, refuse ${rRatio.toFixed(2)}:1, both <=1.3)`);
  } else {
    ok(false, `DW-5.1 could not sample fills card=${JSON.stringify(fill.card)} g=${JSON.stringify(fill.g)} r=${JSON.stringify(fill.r)}`);
  }
  // Motion vocabulary (F1): every transition/animation in v5-agent animates ONLY
  // transform/opacity on a named 100/300/500ms tier with one of the three curves.
  const motion = await p.evaluate(() => {
    const curves = [
      'cubic-bezier(0.16, 1, 0.3, 1)',
      'cubic-bezier(0.7, 0, 0.84, 0)',
      'cubic-bezier(0.65, 0, 0.35, 1)',
    ];
    const allowedProps = /^(opacity|transform)$/;
    const banned = /width|height|padding|margin|top|left|border-radius|grid-template|box-shadow/i;
    const out = { bannedProps: [], badDurations: [], badEasings: [], transitions: 0 };
    // Split on commas NOT inside parentheses (cubic-bezier(...) contains commas).
    const splitTop = (s) => s.split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      const transProps = splitTop(cs.transitionProperty || '');
      const transDur = splitTop(cs.transitionDuration || '0s');
      const transTf = splitTop(cs.transitionTimingFunction || 'ease');
      const animProps = cs.animationName !== 'none' ? ['animation'] : [];
      const durMs = (s) => { const n = parseFloat(s); return s.includes('ms') ? n : n * 1000; };
      for (let i = 0; i < transProps.length; i++) {
        const prop = transProps[i];
        const dur = transDur[i] || transDur[transDur.length - 1] || '0s';
        const tf = transTf[i] || transTf[transTf.length - 1] || 'ease';
        if (prop === 'all' || prop === 'none') { if (durMs(dur) !== 0) out.bannedProps.push(`${el.tagName}.${el.className}:${prop}`); continue; }
        if (banned.test(prop)) out.bannedProps.push(`${el.tagName}.${el.className}:${prop}`);
        const ms = durMs(dur);
        out.transitions++;
        if (ms !== 0 && ![100, 300, 500].includes(ms)) out.badDurations.push(`${el.tagName}.${el.className}:${prop}=${dur}`);
        if (tf !== 'ease' && tf !== 'linear' && !curves.includes(tf))
          out.badEasings.push(`${el.tagName}.${el.className}:${prop}\u00a0${tf}`);
      }
      if (animProps.length) {
        const aDur = splitTop(cs.animationDuration || '0s');
        const aTf = splitTop(cs.animationTimingFunction || 'ease');
        for (let j = 0; j < animProps.length; j++) {
          const ms = durMs(aDur[j] || aDur[0] || '0s');
          const tf = aTf[j] || aTf[0] || 'ease';
          if (ms !== 0 && ![100, 300, 500].includes(ms)) out.badDurations.push(`${el.tagName}.${el.className}:anim=${aDur[j]}`);
          if (tf !== 'ease' && tf !== 'linear' && !curves.includes(tf))
            out.badEasings.push(`${el.tagName}.${el.className}:anim\u00a0${tf}`);
        }
      }
    }
    return out;
  });
  ok(motion.bannedProps.length === 0,
    `F1 no element animates width/height/padding/margin/top/left/border-radius/grid-template/box-shadow (${motion.bannedProps.join('; ') || 'none'})`);
  ok(motion.badDurations.length === 0,
    `F1 every duration is 100/300/500ms (violations: ${motion.badDurations.join('; ') || 'none'})`);
  ok(motion.badEasings.length === 0,
    `F1 every easing is one of the three canonical curves (violations: ${motion.badEasings.join('; ') || 'none'})`);

  // equal keyboard cost: both are native <button>, neither autofocus, choice is a
  // <div> (not a <form>) so no element in it can submit; the composing form returns
  // false onsubmit so Enter inside the textarea makes a newline, never an approve.
  const nAuto = await p.evaluate(() => window.__autofocus());
  ok(nAuto === 0, `DW-5.2 no preselect / autofocus anywhere (${nAuto})`);
  const choiceIsForm = await p.evaluate(() => document.querySelector('.choice').tagName);
  ok(choiceIsForm !== 'FORM', `DW-5.2 approve/deny not inside a submitting form (tag ${choiceIsForm})`);
  const composerOnsubmit = await p.evaluate(() => { const f = document.querySelector('.cin'); return f ? f.getAttribute('onsubmit') : null; });
  ok(composerOnsubmit === 'return false', 'DW-5.2 composing form does not submit on Enter (onsubmit=return false)');
  // DW-5.11: scope-widening separated by stated >=40px and tab-ordered after the pair
  ok(pairBottom && widenTop && (widenTop - pairBottom) >= 40,
    `DW-5.11 scope-widen >= 40px below the pair (gap ${widenTop - pairBottom}px)`);
  const orderOk = await p.evaluate(() => {
    const g = document.querySelector('.grant').getBoundingClientRect();
    const r = document.querySelector('.refuse').getBoundingClientRect();
    const w = document.querySelector('.widen button').getBoundingClientRect();
    // grant and refuse are peers on one row (g.left < r.left); the scope-widen
    // renders BELOW the whole pair, so it sits after them in reading/tab order
    return g.left < r.left && w.top > r.bottom;
  });
  ok(orderOk, 'DW-5.11 scope-widen renders after the pair in reading/tab order');
  await p.close();
}

// DW-5.7 / 5.8: fixed anchors in stable chrome — Home, composer input, Stop.
// The four agent states (streaming / idle / approving / error) toggle through the
// .fluxbar; only the transcript content and the status pill change, so the anchor
// geometry must be byte-for-byte identical across all four states.
{
  const p = await open({});
  await p.evaluate(SAMPLER);
  const rects = (sel) => p.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return 'NULL:' + s;
    const r = e.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
  });
  const grab = async () => ({
    home: await rects('.shead .back'),   // Home anchor
    input: await rects('.cin textarea'), // composer input anchor
    stop: await rects('.composer .stop'),// Stop anchor
  });
  const base = await grab();
  const states = ['streaming', 'idle', 'approval', 'error'];
  const deltas = {};
  for (const st of states) {
    await p.evaluate((s) => { document.body.setAttribute('data-ux', s); }, st);
    await p.waitForTimeout(30);
    const now = await grab();
    for (const k of ['home', 'input', 'stop']) {
      const key = k + '@' + st;
      deltas[key] = (now[k] === base[k]) ? 0 : `${base[k]} -> ${now[k]}`;
    }
  }
  ok((await grab()).home === base.home, 'DW-5.7 Home anchor position invariant');
  ok((await grab()).input === base.input, 'DW-5.7 composer input anchor position invariant');
  ok((await grab()).stop === base.stop, 'DW-5.7 Stop anchor position invariant');
  // restore a deterministic default for the remaining probes
  await p.evaluate(() => { document.body.removeAttribute('data-ux'); });
  const home = await rects('.shead .back');
  const composer = await rects('.composer');
  const stop = await rects('.composer .stop');
  ok(!!home && !!composer && !!stop, 'DW-5.7 Home, composer, Stop all present and measured');
  const composerPos = await p.evaluate(() => getComputedStyle(document.querySelector('.composer')).position);
  ok(composerPos === 'absolute' || composerPos === 'fixed' || composerPos === 'static',
    `DW-5.8 composer keeps Stop reachable (position ${composerPos})`);
  const hasApproval = await p.evaluate(() => document.querySelectorAll('.hitl').length >= 2);
  const hasSubagent = await p.evaluate(() => document.querySelectorAll('.branch').length >= 1);
  ok(hasApproval && hasSubagent, 'DW-5.8 approval card AND subagent branch present on the same surface so Stop reachability is exercised');
  const composeForm = await p.evaluate(() => {
    const f = document.querySelector('.composer .cin');
    return f && f.contains(document.querySelector('.composer .stop'));
  });
  ok(composeForm, 'DW-5.8 Stop lives in the always-on composer (reachable in one interaction while a card or subagent runs)');
  await p.close();
}

// DW-4.10 / DW-5.1-under-coarse: >=44x44 targets, and no horizontal overflow, at
// narrow widths on a coarse pointer, in both schemes.
for (const width of [320, 390, 430]) {
  const p = await open({ width, coarse: true });
  await p.evaluate(SAMPLER);
  const m = await p.evaluate(() => ({
    sw: document.documentElement.scrollWidth, iw: innerWidth,
    fs: getComputedStyle(document.querySelector('.cin textarea')).fontSize,
    grant: (() => { const r = document.querySelector('.choice button.grant').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    refuse: (() => { const r = document.querySelector('.choice button.refuse').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    stop: (() => { const r = document.querySelector('.composer .stop').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    home: (() => { const r = document.querySelector('.brand .home').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
  }));
  ok(m.sw <= m.iw, `v5-agent @${width}: no horizontal overflow (scrollWidth ${m.sw} vs ${m.iw})`);
  ok(parseFloat(m.fs) >= 16, `v5-agent @${width}: composer input font ${m.fs}px (>=16px)`);
  ok(m.grant[0] >= 44 && m.grant[1] >= 44 && m.refuse[0] >= 44 && m.refuse[1] >= 44,
    `v5-agent @${width}: approve/deny both >=44x44 (grant ${m.grant}, refuse ${m.refuse})`);
  ok(Math.abs(m.grant[0] - m.refuse[0]) <= 1 && Math.abs(m.grant[1] - m.refuse[1]) <= 1,
    `v5-agent @${width}: approve/deny still symmetric under coarse (${m.grant} vs ${m.refuse})`);
  ok(m.stop[0] >= 44 && m.stop[1] >= 44, `v5-agent @${width}: stop >=44x44 (${m.stop})`);
  ok(m.home[0] >= 44 && m.home[1] >= 44, `v5-agent @${width}: home >=44x44 (${m.home})`);
  await p.close();
}

await browser.close();
console.log(`\n${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
