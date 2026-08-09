import { Effect, Layer } from 'effect';
import { HUB_PORT, HUB_VERSION } from './config';
import { Db, DbLayer } from './db';
import { advertise } from './mdns';
import { Pending, PendingLayer } from './pending';
import { Registry, RegistryLayer } from './registry';
import { createServer } from './server';
import { createTelegramBridge } from './telegram';

const main = Effect.gen(function* () {
  const registry = yield* Registry;
  const db = yield* Db;
  const pending = yield* Pending;
  const telegram = createTelegramBridge({ registry, db, pending }) ?? undefined;
  createServer({ registry, db, pending, telegram }).listen(HUB_PORT);
  yield* Effect.log(`cockpit hub ${HUB_VERSION} listening on :${HUB_PORT}`);
  advertise(HUB_PORT);
  // After `listen`, so the first ask the bridge can be handed is one this hub
  // is already able to receive.
  telegram?.start();
});

await Effect.runPromise(Effect.provide(main, Layer.mergeAll(RegistryLayer, DbLayer, PendingLayer)));
