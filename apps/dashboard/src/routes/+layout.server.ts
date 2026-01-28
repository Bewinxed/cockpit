import type { LayoutServerLoad } from './$types';
import type { CanonicalMessage } from '@agentdeck/core/dashboard';

const HUB_URL = process.env.HUB_URL || 'http://localhost:3456';

async function fetchFromHub<T>(path: string): Promise<T[]> {
  try {
    const response = await fetch(`${HUB_URL}/api/${path}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.success && data.data ? (data.data as T[]) : [];
  } catch (error) {
    console.error(`[SSR] Error fetching ${path}:`, error);
    return [];
  }
}

export const load: LayoutServerLoad = async ({ url }) => {
  // Fire all fetches in parallel
  const tabsParam = url.searchParams.get('tabs');
  const tabIds = tabsParam ? tabsParam.split(',').filter(Boolean) : [];

  const [agents, instances, projects, tabMessageResults] = await Promise.all([
    fetchFromHub<any>('agents'),
    fetchFromHub<any>('instances'),
    fetchFromHub<any>('projects'),
    Promise.all(
      tabIds.map(async (id) => ({
        id,
        messages: await fetchFromHub<CanonicalMessage>(`instances/${id}/messages`),
      }))
    ),
  ]);

  const tabMessages: Record<string, CanonicalMessage[]> = {};
  for (const { id, messages } of tabMessageResults) {
    tabMessages[id] = messages;
  }

  return { agents, instances, projects, tabMessages };
};
