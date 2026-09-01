import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    // A plain read rather than core's `readEnv`: drizzle-kit bundles this
    // config on its own and never sees the workspace's TypeScript sources.
    url: process.env.WHIFFLE_DB_PATH ?? './whiffle.db',
  },
});
