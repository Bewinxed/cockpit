import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from './schema';

export function createDb(dbPath: string) {
  const sqlite = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA synchronous = NORMAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;

// Singleton instance for convenience
let dbInstance: Db | null = null;

export function getDb(dbPath?: string): Db {
  if (!dbInstance) {
    if (!dbPath) {
      throw new Error('Database path required for initial connection');
    }
    dbInstance = createDb(dbPath);
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    // Access the underlying sqlite instance to close it
    // Note: Drizzle doesn't expose a direct close method,
    // but the Database will be garbage collected
    dbInstance = null;
  }
}
