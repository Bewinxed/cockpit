import { Effect, Layer } from 'effect';
import { HUB_PORT, HUB_VERSION } from './config';
import { Db, DbLayer } from './db';
import { Pending, PendingLayer } from './pending';
import { Registry, RegistryLayer } from './registry';
import { createServer } from './server';

const main = Effect.gen(function* () {
  const registry = yield* Registry;
  const db = yield* Db;
  const pending = yield* Pending;
  createServer({ registry, db, pending }).listen(HUB_PORT);
  yield* Effect.log(`cockpit hub ${HUB_VERSION} listening on :${HUB_PORT}`);
});

await Effect.runPromise(Effect.provide(main, Layer.mergeAll(RegistryLayer, DbLayer, PendingLayer)));
