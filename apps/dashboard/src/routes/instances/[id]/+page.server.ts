import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Redirect old /instances/[id] URLs to new tab-based format
 * /instances/abc123 → /?tabs=abc123&active=abc123
 */
export const load: PageServerLoad = async ({ params }) => {
  const instanceId = params.id;
  redirect(301, `/?tabs=${instanceId}&active=${instanceId}`);
};
