import { redirect } from '@sveltejs/kit';

// Clean-slate cutover: the legacy workspace shell SSR-fetches dead legacy hub
// endpoints. The new-spine session index is the front door now.
export function load() {
	redirect(307, '/session');
}
