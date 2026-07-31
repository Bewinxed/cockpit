/** SSR proof for fn-33 Phase 2: machine identity formatting and the rail splitter. */
import { createServer, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';

const stubs: Plugin = {
  name: 'harness-stubs',
  enforce: 'pre',
  resolveId(source) {
    if (source === '$app/state') return '\0harness:app-state';
    return null;
  },
  load(id) {
    if (id === '\0harness:app-state') {
      return `export const page = { url: new URL('http://localhost/session') };
export const navigating = null;`;
    }
    return null;
  },
  transform(_code, id) {
    // The rail's data source: replaced wholesale so no socket is needed.
    if (id.endsWith('/lib/cockpit/client.svelte.ts')) {
      return readFileSync(new URL('./stub-client.js', import.meta.url), 'utf8');
    }
    return null;
  },
};

const server = await createServer({
  configFile: 'vite.config.ts',
  plugins: [stubs],
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

const { render } = await server.ssrLoadModule('svelte/server');
const { default: Probe } = await server.ssrLoadModule('/harness/ShellProbe.svelte');
const icons = await server.ssrLoadModule('/src/lib/icons.ts');

const body: string = render(Probe).body;

/** unplugin-icons inlines the glyph, so the icon in use is identifiable by its path data. */
const firstPath = (Icon: unknown) => {
  const svg = render(Icon as never).body;
  return svg.match(/ d="([^"]+)"/)?.[1] ?? '';
};
const laptop = firstPath(icons.IconLaptop);
const monitor = firstPath(icons.IconMonitor);
const server2 = firstPath(icons.IconServer);

const hostnames = [...body.matchAll(/class="min-w-0 truncate text-\[13px\] font-medium[^"]*">([^<]*)</g)]
  .map((m) => m[1].trim())
  .filter(Boolean);
const osLabels = [...body.matchAll(/class="shrink-0 text-\[10px\] text-muted-foreground\/60">([^<]*)</g)]
  .map((m) => m[1].trim())
  .filter(Boolean);

const checks: [string, boolean][] = [
  ['mac: hostname cleaned to "Omars-MacBook-Pro"', hostnames.includes('Omars-MacBook-Pro')],
  ['mac: no ".local" left in the visible name', !hostnames.some((h) => h.endsWith('.local'))],
  ['mac: full name kept in title', body.includes('title="Omars-MacBook-Pro.local · darwin-arm64"')],
  ['mac: OS label reads "macOS"', osLabels.includes('macOS')],
  ['mac: laptop icon rendered', laptop !== '' && body.includes(laptop)],
  ['linux: hostname "obelisk-of-light"', hostnames.includes('obelisk-of-light')],
  ['linux: full name kept in title', body.includes('title="obelisk-of-light · linux-x64"')],
  ['linux: OS label reads "Linux"', osLabels.includes('Linux')],
  ['linux: monitor icon rendered', monitor !== '' && body.includes(monitor)],
  ['no generic Server glyph on either machine', server2 !== '' && !body.includes(server2)],
  ['no uppercase raw os string', !/DARWIN-ARM64|LINUX-X64/.test(body)],
  ['no uppercase/mono class on the OS label', !/text-\[10px\][^"]*uppercase/.test(body)],
  ['reload affordance survives', body.includes('title="Reload sessions"')],
  ['online dot rendered', body.includes('bg-success')],
  ['splitter: role="separator"', body.includes('role="separator"')],
  ['splitter: aria-orientation="vertical"', body.includes('aria-orientation="vertical"')],
  ['splitter: aria-valuenow=288', body.includes('aria-valuenow="288"')],
  ['splitter: aria-valuemin=216', body.includes('aria-valuemin="216"')],
  ['splitter: aria-valuemax=520', body.includes('aria-valuemax="520"')],
  ['splitter: focusable', /role="separator"[\s\S]{0,400}?tabindex="0"/.test(body)],
  ['rail width driven by --sidebar-width', body.includes('--sidebar-width: 288px')],
];

console.log('hostnames rendered:', hostnames);
console.log('os labels rendered:', osLabels);
console.log(
  'machine header:\n' + (body.match(/<header class="flex items-center">[\s\S]*?<\/header>/)?.[0] ?? '(not found)')
);
console.log(
  'splitter:\n' + (body.match(/<div role="separator"[^>]*><\/div>/)?.[0] ?? '(not found)')
);
console.log('--- CHECKS ---');
let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

await server.close();
process.exit(failed === 0 ? 0 : 1);
