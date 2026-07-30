import { COCKPIT_ENV, COCKPIT_HUB_PORT } from '@cockpit/core';

/** Reported by `GET /health`; keep in sync with package.json. */
export const HUB_VERSION = '0.1.0';

export const HUB_PORT = Number(Bun.env[COCKPIT_ENV.hubPort] ?? COCKPIT_HUB_PORT);

/** The hub owns the sqlite file; `COCKPIT_ENV` has no key for it yet. */
export const DB_PATH = Bun.env.COCKPIT_DB_PATH ?? './cockpit.db';
