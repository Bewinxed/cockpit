/**
 * Type-safe API client using Eden Treaty
 */
import { treaty } from '@elysiajs/eden';
import type { App } from '@cockpit/hub-server';

// Lazy-initialize the Eden client to ensure we're in browser context
// Uses current origin (goes through SvelteKit proxy to hub)
let _api: ReturnType<typeof treaty<App>> | null = null;

export const api = new Proxy({} as ReturnType<typeof treaty<App>>, {
  get(_, prop) {
    if (!_api) {
      const baseUrl = typeof window !== 'undefined'
        ? window.location.origin
        : 'http://localhost:3000';
      _api = treaty<App>(baseUrl);
    }
    return _api[prop as keyof typeof _api];
  }
});

// Re-export for convenience
export type { App };
