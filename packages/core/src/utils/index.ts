// ID generation utilities
export {
  generateId,
  generateShortId,
  generatePrefixedId,
  generateMachineId,
  getMachineFingerprint,
  generateSessionId,
  generateRequestId,
  isValidUuid,
  isValidPrefixedId,
  getIdPrefix,
  IdPrefix,
  type IdPrefixValue,
  generateAgentId,
  generateInstanceId,
  generateProjectId,
  generateTaskId,
} from './id.js';

// Tailscale utilities
export {
  type TailscaleStatus,
  type TailscalePeer,
  type TailscalePeerInfo,
  getTailscaleStatus,
  getTailscaleIp,
  getTailscaleHostname,
  getOnlinePeers,
  getAllPeers,
  isTailscaleAvailable,
  getTailnetName,
} from './tailscale.js';

// mDNS discovery utilities
export {
  COCKPIT_SERVICE_TYPE,
  COCKPIT_DEFAULT_PORT,
  type CockpitService,
  type DiscoveryEvents,
  type DiscoveryOptions,
  DiscoveryService,
  discoverHub,
  discoverAll,
} from './discovery.js';

// General utilities
import { randomUUID } from 'crypto';

/**
 * Sleep for a given number of milliseconds
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 * @param attempt - The attempt number (0-indexed)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @param maxDelay - Maximum delay in milliseconds (default: 30000)
 * @returns The calculated delay with jitter
 */
export function exponentialBackoff(attempt: number, baseDelay = 1000, maxDelay = 30000): number {
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  // Add jitter (up to 1 second)
  return delay + Math.random() * 1000;
}

/**
 * Retry a function with exponential backoff
 * @param fn - The async function to retry
 * @param maxAttempts - Maximum number of attempts (default: 3)
 * @param baseDelay - Base delay between attempts in milliseconds (default: 1000)
 * @returns The result of the function
 * @throws The last error if all attempts fail
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        await sleep(exponentialBackoff(attempt, baseDelay));
      }
    }
  }

  throw lastError;
}

/**
 * Deferred promise with external resolve/reject
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/**
 * Create a deferred promise that can be resolved/rejected externally
 * @returns A deferred object with promise, resolve, and reject
 */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Wrap a promise with a timeout
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds
 * @param message - Optional error message on timeout
 * @returns The promise result
 * @throws Error if the timeout is reached
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = 'Operation timed out'
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeout]);
}

/**
 * Safely parse JSON without throwing
 * @param str - The JSON string to parse
 * @returns The parsed object or null if parsing fails
 */
export function safeJsonParse<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

/**
 * Get the system hostname
 * @returns The hostname
 */
export function getHostname(): string {
  return process.env.HOSTNAME || require('os').hostname();
}

/**
 * Get the current platform
 * @returns The platform string (e.g., 'linux', 'darwin', 'win32')
 */
export function getPlatform(): NodeJS.Platform {
  return process.platform;
}

/**
 * Normalize a platform string to AgentOS type
 * @param platform - The platform string
 * @returns The normalized OS type
 */
export function normalizeOS(platform: string): 'windows' | 'darwin' | 'linux' {
  switch (platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'darwin';
    default:
      return 'linux';
  }
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return process.platform === 'linux';
}
