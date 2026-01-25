import { Elysia, t } from 'elysia';
import type { Db } from '@agentdeck/db';
import { credentials, eq, desc } from '@agentdeck/db';
import { generateId } from '@agentdeck/core/utils';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  isTokenExpired,
} from '@agentdeck/auth';

// In-memory store for PKCE verifiers (with 10 min expiration)
const pendingAuth = new Map<string, { verifier: string; expiresAt: number }>();

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of pendingAuth) {
    if (data.expiresAt < now) {
      pendingAuth.delete(state);
    }
  }
}, 60_000);

/**
 * Auth routes for OAuth and API key management
 */
export function createAuthRoutes(db: Db) {
  return new Elysia({ prefix: '/auth' })
    // Check authentication status
    .get('/status', async () => {
      const result = await db
        .select()
        .from(credentials)
        .where(eq(credentials.isDefault, true))
        .limit(1);

      if (result.length === 0) {
        return {
          success: true,
          authenticated: false,
        };
      }

      const cred = result[0];

      // Check if OAuth token is expired
      if (cred.type === 'oauth' && cred.expiresAt) {
        const isExpired = isTokenExpired(cred.expiresAt);
        if (isExpired && cred.refreshToken) {
          // Try to refresh
          try {
            const tokens = await refreshAccessToken(cred.refreshToken);
            await db
              .update(credentials)
              .set({
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresAt: tokens.expiresAt,
                updatedAt: new Date(),
              })
              .where(eq(credentials.id, cred.id));

            return {
              success: true,
              authenticated: true,
              type: cred.type,
              label: cred.label,
            };
          } catch {
            // Refresh failed, credential is invalid
            return {
              success: true,
              authenticated: false,
              expired: true,
            };
          }
        } else if (isExpired) {
          return {
            success: true,
            authenticated: false,
            expired: true,
          };
        }
      }

      return {
        success: true,
        authenticated: true,
        type: cred.type,
        label: cred.label,
      };
    })

    // Start OAuth flow - returns auth URL
    .post('/oauth/start', async () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      const state = generateId();

      // Store verifier for later (10 min expiration)
      pendingAuth.set(state, {
        verifier,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      const authUrl = buildAuthorizationUrl(challenge, state);

      return {
        success: true,
        data: {
          authUrl,
          state,
        },
      };
    })

    // Complete OAuth flow - exchange code for tokens
    .post(
      '/oauth/callback',
      async ({ body, set }) => {
        console.log('[Auth] OAuth callback received:', { code: body.code.slice(0, 10) + '...', state: body.state });
        console.log('[Auth] Pending states:', [...pendingAuth.keys()]);

        const pending = pendingAuth.get(body.state);
        if (!pending) {
          set.status = 400;
          return {
            success: false,
            error: `Invalid or expired state "${body.state}". Available: ${[...pendingAuth.keys()].join(', ') || 'none'}`,
          };
        }

        // Remove from pending
        pendingAuth.delete(body.state);

        try {
          console.log('[Auth] Exchanging code for tokens with verifier:', pending.verifier.slice(0, 10) + '...');
          const tokens = await exchangeCodeForTokens(body.code, pending.verifier);
          console.log('[Auth] Token exchange successful!');

          const now = new Date();
          const id = generateId();

          // Clear any existing default credentials
          await db
            .update(credentials)
            .set({ isDefault: false, updatedAt: now })
            .where(eq(credentials.isDefault, true));

          // Store new credentials
          await db.insert(credentials).values({
            id,
            type: 'oauth',
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
            label: body.label || 'Claude MAX',
            isDefault: true,
            createdAt: now,
            updatedAt: now,
          });

          return {
            success: true,
            data: {
              id,
              type: 'oauth',
              label: body.label || 'Claude MAX',
            },
          };
        } catch (err) {
          console.error('[Auth] Token exchange failed:', err);
          set.status = 400;
          return {
            success: false,
            error: err instanceof Error ? err.message : 'Token exchange failed',
          };
        }
      },
      {
        body: t.Object({
          code: t.String({ minLength: 1 }),
          state: t.String({ minLength: 1 }),
          label: t.Optional(t.String()),
        }),
      }
    )

    // Store tokens that were exchanged client-side (browser)
    .post(
      '/oauth/store',
      async ({ body }) => {
        const now = new Date();
        const id = generateId();

        // Clear any existing default credentials
        await db
          .update(credentials)
          .set({ isDefault: false, updatedAt: now })
          .where(eq(credentials.isDefault, true));

        // Store the tokens
        await db.insert(credentials).values({
          id,
          type: 'oauth',
          accessToken: body.accessToken,
          refreshToken: body.refreshToken,
          expiresAt: body.expiresAt,
          label: body.label || 'Claude MAX',
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        });

        return {
          success: true,
          data: {
            id,
            type: 'oauth',
            label: body.label || 'Claude MAX',
          },
        };
      },
      {
        body: t.Object({
          accessToken: t.String({ minLength: 1 }),
          refreshToken: t.String({ minLength: 1 }),
          expiresAt: t.Number(),
          label: t.Optional(t.String()),
        }),
      }
    )

    // Store API key
    .post(
      '/api-key',
      async ({ body }) => {
        const now = new Date();
        const id = generateId();

        // Clear any existing default credentials
        await db
          .update(credentials)
          .set({ isDefault: false, updatedAt: now })
          .where(eq(credentials.isDefault, true));

        // Store new API key
        await db.insert(credentials).values({
          id,
          type: 'api_key',
          apiKey: body.apiKey,
          label: body.label || 'API Key',
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        });

        return {
          success: true,
          data: {
            id,
            type: 'api_key',
            label: body.label || 'API Key',
          },
        };
      },
      {
        body: t.Object({
          apiKey: t.String({ minLength: 1 }),
          label: t.Optional(t.String()),
        }),
      }
    )

    // Get credentials for agent spawning (returns actual tokens/keys)
    .get('/credentials', async ({ set }) => {
      const result = await db
        .select()
        .from(credentials)
        .where(eq(credentials.isDefault, true))
        .limit(1);

      if (result.length === 0) {
        set.status = 404;
        return {
          success: false,
          error: 'No credentials configured',
        };
      }

      const cred = result[0];

      // Auto-refresh OAuth tokens if needed
      if (cred.type === 'oauth' && cred.expiresAt && isTokenExpired(cred.expiresAt)) {
        if (cred.refreshToken) {
          try {
            const tokens = await refreshAccessToken(cred.refreshToken);
            await db
              .update(credentials)
              .set({
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresAt: tokens.expiresAt,
                updatedAt: new Date(),
              })
              .where(eq(credentials.id, cred.id));

            return {
              success: true,
              data: {
                type: 'oauth',
                accessToken: tokens.accessToken,
              },
            };
          } catch {
            set.status = 401;
            return {
              success: false,
              error: 'Token expired and refresh failed',
            };
          }
        } else {
          set.status = 401;
          return {
            success: false,
            error: 'Token expired',
          };
        }
      }

      if (cred.type === 'oauth') {
        return {
          success: true,
          data: {
            type: 'oauth',
            accessToken: cred.accessToken,
          },
        };
      } else {
        return {
          success: true,
          data: {
            type: 'api_key',
            apiKey: cred.apiKey,
          },
        };
      }
    })

    // List all credentials (without sensitive data)
    .get('/list', async () => {
      const result = await db
        .select({
          id: credentials.id,
          type: credentials.type,
          label: credentials.label,
          isDefault: credentials.isDefault,
          createdAt: credentials.createdAt,
        })
        .from(credentials)
        .orderBy(desc(credentials.createdAt));

      return {
        success: true,
        data: result,
      };
    })

    // Logout - delete credentials
    .delete('/logout', async () => {
      // Delete default credential
      await db.delete(credentials).where(eq(credentials.isDefault, true));

      return {
        success: true,
        data: { loggedOut: true },
      };
    })

    // Delete specific credential
    .delete(
      '/:id',
      async ({ params, set }) => {
        const existing = await db
          .select()
          .from(credentials)
          .where(eq(credentials.id, params.id))
          .limit(1);

        if (existing.length === 0) {
          set.status = 404;
          return {
            success: false,
            error: 'Credential not found',
          };
        }

        await db.delete(credentials).where(eq(credentials.id, params.id));

        return {
          success: true,
          data: { id: params.id, deleted: true },
        };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    );
}
