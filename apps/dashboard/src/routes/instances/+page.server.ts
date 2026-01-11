import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Redirect old /instances list to root (sidebar shows instances now)
 */
export const load: PageServerLoad = async () => {
  redirect(301, '/');
};
