// Schema exports
export * from './schema';

// Client exports
export { createDb, getDb, closeDb } from './client';
export type { Db } from './client';

// Re-export commonly used drizzle utilities for convenience
export { eq, and, or, desc, asc, sql, like, inArray, isNull, isNotNull } from 'drizzle-orm';
