import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Redirect old /projects list to root (projects are now in sidebar grouping)
 */
export const load: PageServerLoad = async () => {
  redirect(301, '/');
};
