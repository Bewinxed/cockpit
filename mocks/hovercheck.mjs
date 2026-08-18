#!/usr/bin/env node
/**
 * Hover behaviour x pointer type.
 *
 * WHY THIS EXISTS — the crossing rule this suite states declares POINTER a
 * structural axis and requires every behavioural property to be crossed with
 * every structural axis. Pointer was crossed with target size only. Hover
 * behaviour was never crossed with it, and that is exactly the gap that hid the
 * defect: `@media (hover: none)` suppressed 4 of the 9 selectors that take
 * `--surface-hover`, so on touch the filter selects, pagination, icon buttons,
 * Export CSV, **every status pill** and **both permission-gate buttons** kept a
 * hover state that sticks after a tap.
 *
 * A status chip that changes fill on tap and stays changed is a false state
 * report, on the surface whose whole job is reporting state truthfully.
 *
 * The assertion: on a device that cannot hover, hovering changes NOTHING.
 * Selectors are read out of the stylesheet rather than hard-coded, so a hover
 * rule added later is covered without editing this file.
 *
 *   node mocks/hovercheck.mjs
 */
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ['v2-fleet.html', 'v3-assistant.html', 'v4-transcript.html'];
const WIDTHS = [390, 1440];   // touch phones and touch laptops both exist

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN
    || '/home/bewinxed/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'],
});

let fails = 0;
for (const file of FILES) {
  // parse once per file
  const css = readFileSync(join(HERE, file), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const hoverSelectors = [...new Set(
    [...css.matchAll(/([^{}]*:hover[^{}]*)\{/g)]
      .flatMap((m) => m[1].split(','))
      .map((t) => t.trim().replace(/:hover\b/g, '').trim())
      .filter((t) => t && !t.includes(':where') && !t.includes('::') && !t.startsWith('@'))
  )];
  if (!hoverSelectors.length) {
    console.log(`  FAIL  ${file} — parsed ZERO hover selectors; the gate cannot pass vacuously`);
    fails++;
  }
  for (const width of WIDTHS) {
    for (const dark of [false, true]) {
      const page = await browser.newPage({
        viewport: { width, height: 1023 }, deviceScaleFactor: 1,
        hasTouch: true, isMobile: true,          // => pointer: coarse, hover: none
      });
      await page.goto(pathToFileURL(join(HERE, file)).href, { waitUntil: 'load' });
      if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
      await page.evaluate(() => document.fonts.ready);


      // Selectors are parsed from the stylesheet TEXT in node, not read from
      // the CSSOM: `cssRules` throws SecurityError on the file:// linked sheets
      // and proved unreliable for the inline one, and a silent empty list reads
      // as a clean pass — the same "0 findings means it worked" trap that hid
      // the token census. Parsing the source cannot come back empty by accident.
      const targets = hoverSelectors;

      const problems = [];
      for (const sel of targets) {
        const probe = await page.evaluate((s) => {
          const el = document.querySelector(s);
          if (!el) return null;
          if (el.closest('[inert]')) return null;
          const r = el.getBoundingClientRect();
          if (r.width < 3 || r.height < 3 || r.right <= 0 || r.left >= window.innerWidth) return null;
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) return null;
          const cs = getComputedStyle(el);
          return { bg: cs.backgroundColor, filter: cs.filter, shadow: cs.boxShadow };
        }, sel);
        if (!probe) continue;
        await page.hover(sel).catch(() => {});
        await page.waitForTimeout(30);
        const after = await page.evaluate((s) => {
          const cs = getComputedStyle(document.querySelector(s));
          return { bg: cs.backgroundColor, filter: cs.filter, shadow: cs.boxShadow };
        }, sel);
        const changed = Object.keys(probe).filter((k) => probe[k] !== after[k]);
        if (changed.length) {
          problems.push(`${sel} changes ${changed.join('+')} on a device that cannot hover`);
        }
        await page.mouse.move(0, 0);
        await page.waitForTimeout(10);
      }

      const tag = `${file.replace('.html', '')} @${width} ${dark ? 'dark ' : 'light'} coarse`;
      console.log(`  ${problems.length ? 'FAIL' : 'PASS'}  ${tag.padEnd(38)}`
        + ` ${targets.length} hover selectors, ${problems.length} unsuppressed`);
      for (const p of problems) { fails++; console.log(`          ${p}`); }
      await page.close();
    }
  }
}
await browser.close();
console.log(fails ? `  ${fails} hover states survive on a touch device`
  : '  no hover state survives on a device that cannot hover');
process.exit(fails ? 1 : 0);
