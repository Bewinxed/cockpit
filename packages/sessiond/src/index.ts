/**
 * The sessiond package's surface: the daemon class and its constants. The
 * protocol types themselves live in `@cockpit/core` (`core/src/sessiond.ts`),
 * because both sides of the socket need them and neither side owns them.
 */
export * from './server';
