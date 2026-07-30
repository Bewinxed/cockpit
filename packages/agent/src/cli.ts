import { Effect } from 'effect';
import { startDaemon } from './daemon';

await Effect.runPromise(startDaemon);
