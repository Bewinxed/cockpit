import { Effect } from 'effect';
import { HUB_PORT, HUB_VERSION } from './config';
import { Registry, RegistryLayer } from './registry';
import { createServer } from './server';

const main = Effect.gen(function* () {
  const registry = yield* Registry;
  createServer(registry).listen(HUB_PORT);
  yield* Effect.log(`cockpit hub ${HUB_VERSION} listening on :${HUB_PORT}`);
});

await Effect.runPromise(Effect.provide(main, RegistryLayer));
