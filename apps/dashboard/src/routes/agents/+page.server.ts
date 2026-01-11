import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Redirect old /agents list to root (sidebar shows agents now)
 */
export const load: PageServerLoad = async () => {
  redirect(301, '/');
};
