import { WHIFFLE_ENV, WHIFFLE_HUB_PORT, readEnv } from '@whiffle/core';

/** Reported by `GET /health`; keep in sync with package.json. */
export const HUB_VERSION = '0.1.0';

export const HUB_PORT = Number(readEnv(WHIFFLE_ENV.hubPort) ?? WHIFFLE_HUB_PORT);

/**
 * Where the hub's sqlite file lives. The production path comes from the CLI
 * through the environment; the relative default is the bare `bun run hub` case.
 */
export const DB_PATH = readEnv(WHIFFLE_ENV.dbPath) ?? './whiffle.db';
