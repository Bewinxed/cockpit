import { Effect, Fiber } from 'effect';
import { startDaemon } from './daemon';

const daemon = Effect.runFork(startDaemon);

/**
 * A signal is how this process normally ends — a deliberate restart, a machine
 * going down. Interrupting the fiber runs the supervisor's drain first, so the
 * sessions it owns stop between turns instead of mid-tool. A second signal
 * arrives with the handler already gone, and kills the daemon the usual way.
 */
const drain = (signal: NodeJS.Signals): void => {
  process.off(signal, drain);
  void Effect.runPromise(Fiber.interrupt(daemon)).then(() => process.exit(0));
};

process.on('SIGINT', drain).on('SIGTERM', drain);
