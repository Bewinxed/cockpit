import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Redirect old /agents/[id] to root (agents are now in sidebar)
 */
export const load: PageServerLoad = async () => {
  redirect(301, '/');
};
