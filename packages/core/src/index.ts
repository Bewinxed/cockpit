// The SDK is the type system: consumers tunnel these types, never re-model them.
export type * from '@anthropic-ai/claude-agent-sdk';

/** The whole agent↔hub↔dashboard protocol. Adding a verb is a design decision. */
export type Verb =
  | 'register'
  | 'heartbeat'
  | 'spawn'
  | 'send'
  | 'stop'
  | 'control'
  | 'frames'
  | 'fs';

/**
 * Every message on every hop. `payload` is whatever the verb carries — an SDK
 * message, an `Options` object, a `Query` method call — passed through verbatim.
 */
export interface Envelope<T = unknown> {
  verb: Verb;
  machineId: string;
  instanceId?: string;
  /** SDK `requestId` when the payload correlates to a permission or dialog request. */
  requestId?: string;
  payload: T;
}

export const COCKPIT_HUB_PORT = 3456;

export const COCKPIT_ENV = {
  hubUrl: 'COCKPIT_HUB_URL',
  hubPort: 'COCKPIT_HUB_PORT',
  machineId: 'COCKPIT_MACHINE_ID',
} as const;
