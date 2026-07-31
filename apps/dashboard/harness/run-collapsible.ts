/** SSR proof for fn-33 Phase 1: lazy-mount, inert-when-closed, grid-rows CSS. */
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

const { render } = await server.ssrLoadModule('svelte/server');
const { default: Probe } = await server.ssrLoadModule('/harness/CollapsibleProbe.svelte');

const closed = render(Probe, { props: { open: false } }).body;
const open = render(Probe, { props: { open: true } }).body;

// The motion is the library's now: tw-animate-css supplies the keyframes, and its
// own definition is what the utility classes below resolve to.
const animateCss = readFileSync('node_modules/tw-animate-css/dist/tw-animate.css', 'utf8');
const ownCss = compile(
  readFileSync('src/lib/components/ui/collapsible/collapsible-content.svelte', 'utf8'),
  { generate: 'server', filename: 'collapsible-content.svelte' }
).css?.code;

const checks: [string, boolean][] = [
  ['closed: no child content (lazy)', !closed.includes('SECRET_CHILD_PAYLOAD')],
  ['closed: carries inert', /<div[^>]*\binert\b/.test(closed)],
  ['closed: data-state="closed"', closed.includes('data-state="closed"')],
  ['open: renders children', open.includes('SECRET_CHILD_PAYLOAD')],
  ['open: not inert', !/<div[^>]*\binert\b/.test(open)],
  ['no hand-written CSS left in the component', !ownCss],
  ['open: animate-collapsible-down applied', open.includes('data-[state=open]:animate-collapsible-down')],
  ['closed: animate-collapsible-up applied', closed.includes('data-[state=closed]:animate-collapsible-up')],
  ['closed: fill-mode-forwards holds it collapsed', closed.includes('data-[state=closed]:fill-mode-forwards')],
  ['overflow-hidden clips the animating box', closed.includes('overflow-hidden')],
  ['tw-animate-css defines collapsible-down/up', animateCss.includes('@keyframes collapsible-down') && animateCss.includes('@keyframes collapsible-up')],
  ['keyframes use bits-ui content height var', animateCss.includes('--bits-collapsible-content-height')],
];

console.log('--- CLOSED ---\n' + closed.trim());
console.log('--- OPEN ---\n' + open.trim());
console.log('--- COMPONENT CSS ---\n' + (ownCss ?? '(none — motion comes from tw-animate-css)'));
console.log('--- CHECKS ---');
let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

await server.close();
process.exit(failed === 0 ? 0 : 1);
