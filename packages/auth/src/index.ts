/**
 * Claude MAX OAuth Authentication
 *
 * Provides OAuth 2.0 authentication with PKCE for Claude Pro/Max subscriptions.
 *
 * Usage:
 * ```ts
 * import { login, logout, isAuthenticated, getValidAccessToken } from '@cockpit/auth';
 *
 * // Check if authenticated
 * if (await isAuthenticated()) {
 *   const token = await getValidAccessToken();
 *   // Use token for API calls
 * } else {
 *   // Start OAuth flow
 *   await login();
 * }
 * ```
 */

export {
  login,
  logout,
  type LoginOptions,
  type LoginResult,
} from './login';

export {
  loadCredentials,
  saveCredentials,
  deleteCredentials,
  getValidAccessToken,
  isAuthenticated,
  getCredentialsPath,
} from './credentials';

export {
  OAUTH_CONFIG,
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  isTokenExpired,
  getAuthHeaders,
  type OAuthTokens,
  type StoredCredentials,
} from './oauth';
