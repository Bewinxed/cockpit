import { query, type AccountInfo, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AuthState } from '@cockpit/core';
import { platform } from 'node:os';

/** The keychain item Claude Code keeps its OAuth credentials in on macOS. */
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

/** `errSecInteractionNotAllowed`: the item is there, this session may not read it. */
const SEC_INTERACTION_NOT_ALLOWED = 36;

/** Long enough for the CLI to boot and answer, short enough to not hold a start-up. */
const PROBE_TIMEOUT_MS = 20_000;

/**
 * A prompt that never yields. `query()` starts the CLI and its control channel
 * without it, which is the whole point: the probe is a control call, so it costs
 * a process and no tokens.
 */
const idle: AsyncIterable<SDKUserMessage> = {
  [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
};

/**
 * Whether the account the CLI reports is one it can actually authenticate with.
 *
 * Observed shapes, from `accountInfo()` on real machines:
 *   logged in     `{ email, organization, subscriptionType, apiProvider: 'firstParty' }`
 *   env token     `{ tokenSource: 'CLAUDE_CODE_OAUTH_TOKEN', apiProvider: 'firstParty' }`
 *   api key       `{ tokenSource: 'none', apiKeySource: 'ANTHROPIC_API_KEY', … }`
 *   nothing       `{ tokenSource: 'none', apiProvider: 'firstParty' }`
 *
 * so the test is for positive evidence of a credential rather than for the empty
 * case. A third-party provider carries none of these fields and authenticates
 * outside Claude Code entirely — AWS credentials, gcloud ADC — so it is taken at
 * its word. This says a credential is *reachable*, not that the server accepts
 * it; a stale token still reads as authenticated until it is used.
 */
const credentialed = (account: AccountInfo): boolean => {
  if (account.apiProvider && account.apiProvider !== 'firstParty') return true;
  const token = account.tokenSource;
  return Boolean(account.email ?? account.apiKeySource ?? (token && token !== 'none'));
};

/**
 * Whether macOS is holding credentials this process is not allowed to read.
 * Exit 36 is the whole signal — a missing item exits 44 instead.
 */
const keychainRefused = async (): Promise<boolean> => {
  if (platform() !== 'darwin') return false;
  const secret = await Bun.$`security find-generic-password -s ${KEYCHAIN_SERVICE} -w`
    .quiet()
    .nothrow();
  return secret.exitCode === SEC_INTERACTION_NOT_ALLOWED;
};

/**
 * What this machine can do about Claude Code credentials, asked of the SDK
 * rather than guessed from a file: `accountInfo()` is the CLI's own answer, and
 * it is the same answer a session would get. Only when it comes back empty is
 * the platform asked to tell apart "nobody has logged in here" from "somebody
 * has, and this process cannot reach it".
 *
 * A probe that cannot get an answer at all reports `unauthenticated`: whatever
 * stopped it would stop a session too, and the fleet is better off saying so.
 */
export const probeAuth = async (): Promise<AuthState> => {
  const handle = query({ prompt: idle });
  const account = await Promise.race([
    handle.accountInfo(),
    Bun.sleep(PROBE_TIMEOUT_MS).then(() => undefined),
  ]).catch(() => undefined);
  handle.close();

  if (account && credentialed(account)) return 'authenticated';
  return (await keychainRefused()) ? 'unreadable-credentials' : 'unauthenticated';
};
