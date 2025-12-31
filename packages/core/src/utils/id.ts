import { randomUUID, randomBytes, createHash } from 'crypto';
import { hostname } from 'os';

/**
 * Generate a unique UUID v4
 * @returns A new UUID string
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Generate a short ID (first 8 characters of a UUID)
 * @returns A short unique identifier
 */
export function generateShortId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Generate a prefixed ID for easier identification
 * @param prefix - The prefix to use (e.g., 'inst', 'task', 'proj')
 * @returns A prefixed unique identifier
 */
export function generatePrefixedId(prefix: string): string {
  return `${prefix}_${generateShortId()}`;
}

/**
 * Generate a machine ID based on hostname and random bytes
 * This creates a consistent ID for the machine that persists across restarts
 * @returns A machine identifier string
 */
export function generateMachineId(): string {
  const host = hostname();
  const random = randomBytes(8).toString('hex');
  const hash = createHash('sha256')
    .update(`${host}-${random}`)
    .digest('hex')
    .substring(0, 16);
  return hash;
}

/**
 * Generate a deterministic machine ID based on hostname only
 * This creates the same ID on every call for the same machine
 * @returns A deterministic machine identifier
 */
export function getMachineFingerprint(): string {
  const host = hostname();
  // Include platform for additional uniqueness
  const platform = process.platform;
  const hash = createHash('sha256')
    .update(`${host}-${platform}`)
    .digest('hex')
    .substring(0, 16);
  return hash;
}

/**
 * Generate a session-style ID (longer, more unique)
 * @returns A session identifier
 */
export function generateSessionId(): string {
  return `sess_${randomBytes(16).toString('hex')}`;
}

/**
 * Generate a request ID for JSON-RPC
 * @returns A request identifier
 */
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${generateShortId()}`;
}

/**
 * Validate if a string is a valid UUID
 * @param id - The string to validate
 * @returns True if the string is a valid UUID
 */
export function isValidUuid(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Validate if a string is a valid prefixed ID
 * @param id - The string to validate
 * @param prefix - Optional prefix to check for
 * @returns True if the string is a valid prefixed ID
 */
export function isValidPrefixedId(id: string, prefix?: string): boolean {
  if (prefix) {
    return id.startsWith(`${prefix}_`) && id.length > prefix.length + 1;
  }
  return /^[a-z]+_[a-f0-9]{8}$/.test(id);
}

/**
 * Extract the prefix from a prefixed ID
 * @param id - The prefixed ID
 * @returns The prefix or null if not a valid prefixed ID
 */
export function getIdPrefix(id: string): string | null {
  const match = id.match(/^([a-z]+)_/);
  return match ? match[1] : null;
}

/**
 * ID prefixes used in Cockpit
 */
export const IdPrefix = {
  AGENT: 'agt',
  INSTANCE: 'inst',
  PROJECT: 'proj',
  TASK: 'task',
  SESSION: 'sess',
  REQUEST: 'req',
} as const;

export type IdPrefixValue = (typeof IdPrefix)[keyof typeof IdPrefix];

/**
 * Generate an agent ID
 */
export function generateAgentId(): string {
  return generatePrefixedId(IdPrefix.AGENT);
}

/**
 * Generate an instance ID
 */
export function generateInstanceId(): string {
  return generatePrefixedId(IdPrefix.INSTANCE);
}

/**
 * Generate a project ID
 */
export function generateProjectId(): string {
  return generatePrefixedId(IdPrefix.PROJECT);
}

/**
 * Generate a task ID
 */
export function generateTaskId(): string {
  return generatePrefixedId(IdPrefix.TASK);
}
