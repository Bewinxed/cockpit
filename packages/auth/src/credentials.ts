/**
 * Credential storage for OAuth tokens
 * Compatible with Claude Code's credential format
 */

import { homedir } from 'os';
import { join } from 'path';
import type { OAuthTokens, StoredCredentials } from './oauth';
import { isTokenExpired, refreshAccessToken } from './oauth';

// Path to credentials file (same as Claude Code)
const CREDENTIALS_DIR = join(homedir(), '.claude');
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, '.credentials.json');

/**
 * Ensure the credentials directory exists
 */
async function ensureCredentialsDir(): Promise<void> {
  const dir = Bun.file(CREDENTIALS_DIR);
  if (!(await dir.exists())) {
    await Bun.write(join(CREDENTIALS_DIR, '.keep'), '');
  }
}

/**
 * Load stored credentials from disk
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const file = Bun.file(CREDENTIALS_FILE);
    if (!(await file.exists())) {
      return null;
    }
    const content = await file.text();
    return JSON.parse(content) as StoredCredentials;
  } catch (error) {
    console.error('Failed to load credentials:', error);
    return null;
  }
}

/**
 * Save credentials to disk
 */
export async function saveCredentials(tokens: OAuthTokens): Promise<void> {
  await ensureCredentialsDir();

  const credentials: StoredCredentials = {
    claudeAiOauth: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt, // Store as number (Unix timestamp in ms)
      // Include optional fields if present
      ...(tokens.scopes && { scopes: tokens.scopes }),
      ...(tokens.subscriptionType && { subscriptionType: tokens.subscriptionType }),
      ...(tokens.rateLimitTier && { rateLimitTier: tokens.rateLimitTier }),
    },
  };

  await Bun.write(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));

  // Set restrictive permissions (owner read/write only)
  const { chmod } = await import('fs/promises');
  await chmod(CREDENTIALS_FILE, 0o600);
}

/**
 * Delete stored credentials
 */
export async function deleteCredentials(): Promise<void> {
  const { unlink } = await import('fs/promises');
  try {
    await unlink(CREDENTIALS_FILE);
  } catch {
    // File might not exist
  }
}

/**
 * Get valid access token, refreshing if necessary
 */
export async function getValidAccessToken(): Promise<string | null> {
  const credentials = await loadCredentials();
  if (!credentials?.claudeAiOauth) {
    return null;
  }

  const { accessToken, refreshToken, expiresAt } = credentials.claudeAiOauth;

  // Check if token is expired (expiresAt is already a number in ms)
  if (isTokenExpired(expiresAt)) {
    console.log('Access token expired, refreshing...');
    try {
      const newTokens = await refreshAccessToken(refreshToken);
      await saveCredentials(newTokens);
      return newTokens.accessToken;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      return null;
    }
  }

  return accessToken;
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await getValidAccessToken();
  return token !== null;
}

/**
 * Get credential file path (for display purposes)
 */
export function getCredentialsPath(): string {
  return CREDENTIALS_FILE;
}
