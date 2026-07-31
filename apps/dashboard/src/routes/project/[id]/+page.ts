import type { ProjectRow } from '$lib/cockpit/client.svelte';
import type { PageLoad } from './$types';

/**
 * The project is read through the hub proxy rather than the app socket, so the
 * page renders on the server and a shared link opens straight into it.
 */
export const load: PageLoad = async ({ fetch, params }) => {
  const response = await fetch('/api/projects');
  const projects: unknown = response.ok ? await response.json() : [];
  const project = Array.isArray(projects)
    ? ((projects as ProjectRow[]).find((row) => row.id === params.id) ?? null)
    : null;
  return { project };
};
