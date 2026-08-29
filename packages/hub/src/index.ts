import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Layer } from 'effect';
import { DB_PATH, HUB_PORT, HUB_VERSION } from './config';
import { Db, DbLayer } from './db';
import { advertise } from './mdns';
import { Pending, PendingLayer } from './pending';
import { Registry, RegistryLayer } from './registry';
import { createServer } from './server';
import { createTelegramBridge } from './telegram';

/**
 * Where every hub before C9 wrote its sqlite file: straight into the checkout,
 * next to this package's `package.json`. Found relative to this module rather
 * than to `process.cwd()` so the check is the same whether the hub was started
 * by hand, by `bun --watch`, or as a service — none of which are guaranteed to
 * be run from this directory.
 */
const LEGACY_DB_PATH = fileURLToPath(new URL('../cockpit.db', import.meta.url));

/**
 * The one-time C9 cutover. Older units (and bare `bun run hub`) left the fleet's
 * whole memory sitting inside a git checkout, where a single `git clean -fdx`
 * could delete it. If nothing has been written to the new location yet but the
 * old file is still in the tree, move it — and its `-wal`/`-shm` companions, so
 * a hub mid-checkpoint doesn't lose uncommitted writes — before anything opens
 * either path. Once a target file exists this is forever a no-op, so a legacy
 * file reappearing later (a restored backup, a stray checkout) is left alone
 * rather than clobbering a live target.
 */
export const migrateLegacyDb = (target: string, legacy: string = LEGACY_DB_PATH): void => {
  if (existsSync(target) || !existsSync(legacy)) return;
  mkdirSync(dirname(target), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${legacy}${suffix}`;
    if (existsSync(from)) renameSync(from, `${target}${suffix}`);
  }
};

const main = Effect.gen(function* () {
  const registry = yield* Registry;
  const db = yield* Db;
  const pending = yield* Pending;
  const telegram = createTelegramBridge({ registry, db, pending }) ?? undefined;
  // `idleTimeout` past Bun's 10s default: a skill refresh re-downloads and
  // hashes the whole skill before it says anything (impeccable is 3.2MB /
  // 147 files), and the socket is silent that whole time. 120s clears the
  // resolver's own 60s fetch timeout with room for the hash.
  createServer({ registry, db, pending, telegram }).listen({ port: HUB_PORT, idleTimeout: 120 });
  yield* Effect.log(`cockpit hub ${HUB_VERSION} listening on :${HUB_PORT}`);
  advertise(HUB_PORT);
  // After `listen`, so the first ask the bridge can be handed is one this hub
  // is already able to receive.
  telegram?.start();
});

// Guarded so a test can import `migrateLegacyDb` above without booting a real
// hub — `bun test` loads every file in one process, and this module is also
// the actual entry point every service spec (`packages/cli/src/service.ts`)
// and `bun --watch` run directly, where `import.meta.main` is true.
if (import.meta.main) {
  migrateLegacyDb(DB_PATH);
  await Effect.runPromise(Effect.provide(main, Layer.mergeAll(RegistryLayer, DbLayer, PendingLayer)));
}
