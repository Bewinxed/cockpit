/**
 * The machine half of carrying a plugin as bytes.
 *
 * What is proved here is the contract the CLI is handed: a marketplace
 * directory whose every plugin `source` is a path inside it, so the install
 * that follows reads from disk and reaches the network for nothing. And the
 * refusal — a payload arrives over a socket, so a path that climbs out of the
 * directory is a file the fleet would write somewhere nobody asked it to.
 */
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FleetPluginPayload } from '@cockpit/core';
import { writeVendoredMarketplace } from './fleet';

/**
 * A scratch directory, never `~/.claude/cockpit-marketplace`: this machine runs
 * the operator's live sessions, and a test is not allowed to touch what they
 * are running out of.
 */
const VENDOR_DIR = mkdtempSync(join(tmpdir(), 'cockpit-vendor-'));

const b64 = (text: string): string => Buffer.from(text).toString('base64');

const payload = (name: string, files: Record<string, string>): FleetPluginPayload => ({
  name,
  marketplace: 'rtd',
  hash: `hash-${name}`,
  bytes: 0,
  files: Object.entries(files).map(([path, content]) => ({ path, contentBase64: b64(content) })),
});

afterEach(() => {
  rmSync(VENDOR_DIR, { recursive: true, force: true });
});

test('writes a marketplace whose plugins are vendored beside it', async () => {
  await writeVendoredMarketplace(
    [
      payload('design-for-ai', { '.claude-plugin/plugin.json': '{"name":"design-for-ai"}' }),
      payload('code-foundations', { 'skills/a/SKILL.md': '# a' }),
    ],
    VENDOR_DIR
  );

  const manifest = await Bun.file(join(VENDOR_DIR, '.claude-plugin', 'marketplace.json')).json();
  expect(manifest.name).toBe('cockpit');
  // Every source is relative, which is what makes the install a local read.
  expect(manifest.plugins.map((p: { source: string }) => p.source)).toEqual([
    './plugins/design-for-ai',
    './plugins/code-foundations',
  ]);
  expect(await Bun.file(join(VENDOR_DIR, 'plugins/code-foundations/skills/a/SKILL.md')).text()).toBe(
    '# a'
  );
});

test('a plugin the fleet stopped carrying is gone, not merely unlisted', async () => {
  await writeVendoredMarketplace([payload('old', { 'f.md': 'x' })], VENDOR_DIR);
  await writeVendoredMarketplace([payload('new', { 'f.md': 'y' })], VENDOR_DIR);
  expect(await readdir(join(VENDOR_DIR, 'plugins'))).toEqual(['new']);
});

test('a path that climbs out of the directory is refused', async () => {
  await expect(
    writeVendoredMarketplace([payload('escape', { '../../evil.sh': 'rm -rf /' })], VENDOR_DIR)
  ).rejects.toThrow(/unsafe path/);
});
