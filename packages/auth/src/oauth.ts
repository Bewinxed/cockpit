/**
 * Claude MAX OAuth Implementation
 * Uses PKCE flow for secure authentication
 */

import { createHash, randomBytes } from "node:crypto";

// OAuth Configuration for Claude MAX
// Uses the same client ID as OpenCode/Claude Code for PKCE flow
export const OAUTH_CONFIG = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizeUrl: "https://claude.ai/oauth/authorize",
  // Use /v1/oauth/token with JSON body (like OpenCode does)
  tokenUrl: "https://console.anthropic.com/v1/oauth/token",
  scopes: ["org:create_api_key", "user:profile", "user:inference"],
  // For 3rd party apps, we use a special redirect URI that shows the code
  // The user copies and pastes the code back to the CLI
  redirectUri: "https://console.anthropic.com/oauth/code/callback",
} as const;

/**
 * OAuth tokens returned from authentication
 */
export interface OAuthTokens {
  accessToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  rateLimitTier?: string;
  refreshToken: string;
  // Additional fields that may come from token exchange or profile endpoint
  scopes?: string[];
  subscriptionType?: string;
  tokenType: string;
}

/**
 * Stored credentials format (compatible with Claude Code)
 */
export interface StoredCredentials {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // Unix timestamp in milliseconds
    scopes?: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
}

/**
 * Generate a cryptographically random code verifier for PKCE
 */
export function generateCodeVerifier(): string {
  // Generate 96 random bytes and encode as base64url (128 chars)
  return randomBytes(96).toString("base64url").slice(0, 128);
}

/**
 * Generate code challenge from verifier using S256 method
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Build the authorization URL with PKCE parameters
 */
export function buildAuthorizationUrl(
  codeChallenge: string,
  state: string
): string {
  const params = new URLSearchParams({
    code: "true", // Required for code-based flow
    client_id: OAUTH_CONFIG.clientId,
    response_type: "code",
    redirect_uri: OAUTH_CONFIG.redirectUri,
    scope: OAUTH_CONFIG.scopes.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  return `${OAUTH_CONFIG.authorizeUrl}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 * Uses JSON body format like OpenCode (which is whitelisted by Anthropic)
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  state?: string
): Promise<OAuthTokens> {
  // Parse code#state format if code contains #
  let actualCode = code;
  let actualState = state;
  if (code.includes("#")) {
    const [codePart, statePart] = code.split("#");
    actualCode = codePart;
    actualState = statePart || state;
  }

  const body = {
    code: actualCode,
    state: actualState,
    grant_type: "authorization_code",
    client_id: OAUTH_CONFIG.clientId,
    redirect_uri: OAUTH_CONFIG.redirectUri,
    code_verifier: codeVerifier,
  };

  console.log("[OAuth] Token exchange request:", {
    ...body,
    code: `${actualCode.slice(0, 10)}...`,
    code_verifier: `${codeVerifier.slice(0, 10)}...`,
  });

  // Use JSON body format (like OpenCode does)
  const response = await fetch(OAUTH_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    // Additional fields that may be returned
    scope?: string;
    scopes?: string[];
    subscription_type?: string;
    rate_limit_tier?: string;
  };

  console.log("[OAuth] Token exchange response fields:", Object.keys(data));

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    // Additional fields if present
    scopes: data.scopes || (data.scope ? data.scope.split(" ") : undefined),
    subscriptionType: data.subscription_type,
    rateLimitTier: data.rate_limit_tier,
  };
}

/**
 * Refresh an expired access token
 * Uses JSON body format like OpenCode
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<OAuthTokens> {
  const response = await fetch(OAUTH_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: OAUTH_CONFIG.clientId,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
  };
}

/**
 * Check if tokens are expired (with 5 minute buffer)
 */
export function isTokenExpired(expiresAt: number): boolean {
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return Date.now() >= expiresAt - bufferMs;
}

/**
 * Get headers required for authenticated API requests
 */
export function getAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "anthropic-beta": "oauth-2025-04-20",
    "anthropic-version": "2023-06-01",
  };
}
