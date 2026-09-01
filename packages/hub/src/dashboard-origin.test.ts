import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { Registry, RegistryLayer, type RegistryShape } from './registry';

/**
 * The `Origin` of a dashboard's websocket is what a Telegram link is built
 * from, and it is written by the client — so what the registry refuses matters
 * as much as what it keeps.
 */
const registry = (): RegistryShape => Effect.runSync(Effect.provide(Registry, RegistryLayer));

test('a real origin is kept, path and all else stripped', () => {
  const it = registry();
  it.noteDashboardOrigin('https://box.tail1234.ts.net:3000/session/abc');
  expect(it.dashboardOrigin()).toBe('https://box.tail1234.ts.net:3000');
});

test('nothing has connected: no origin to offer', () => {
  expect(registry().dashboardOrigin()).toBeUndefined();
});

test('loopback is refused — a link to it is useless on a phone', () => {
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
    const it = registry();
    it.noteDashboardOrigin(origin);
    expect(it.dashboardOrigin()).toBeUndefined();
  }
});

test('junk and non-http schemes are refused', () => {
  for (const origin of [undefined, '', 'null', 'not a url', 'file:///etc/passwd', 'javascript:alert(1)']) {
    const it = registry();
    it.noteDashboardOrigin(origin);
    expect(it.dashboardOrigin()).toBeUndefined();
  }
});

test('a refused origin does not displace a good one already seen', () => {
  const it = registry();
  it.noteDashboardOrigin('https://box.example:3000');
  it.noteDashboardOrigin('http://localhost:3000');
  expect(it.dashboardOrigin()).toBe('https://box.example:3000');
});

test('the newest usable origin wins — the operator moved', () => {
  const it = registry();
  it.noteDashboardOrigin('http://old.example:3000');
  it.noteDashboardOrigin('https://new.example');
  expect(it.dashboardOrigin()).toBe('https://new.example');
});
