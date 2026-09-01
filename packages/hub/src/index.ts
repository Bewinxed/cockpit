import { Effect, Layer } from 'effect';
import { DB_PATH, HUB_PORT, HUB_VERSION } from './config';
import { Db, DbLayer } from './db';
import { advertise } from './mdns';
// The move itself lives in its own module so `whiffle deploy init` can run it
// from the checkout that actually holds the legacy file. See migrate-db.ts.
import { migrateLegacyDb } from './migrate-db';
import { Pending, PendingLayer } from './pending';
import { Registry, RegistryLayer } from './registry';
import { createServer } from './server';
import { createTelegramBridge } from './telegram';

export { migrateLegacyDb };

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
  yield* Effect.log(`whiffle hub ${HUB_VERSION} listening on :${HUB_PORT}`);
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
