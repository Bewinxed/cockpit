import type { PageLoad } from './$types';
import type {
  UsageBlocksResponse,
  UsageLimitsResponse,
  UsageSummary,
} from '$lib/cockpit/usage';

/**
 * The usage surface reads straight from the hub through the SvelteKit proxy —
 * the page renders on the server, and a hub that is down leaves a sentence to
 * read rather than a blank page (mirrors `routes/tools/+page.ts`).
 *
 * The heavy day-by-day chart and the breakdown tabs are fetched client-side,
 * where their range and tab state live; what is loaded here is what the page
 * needs to render once.
 */
export const load: PageLoad = async ({ fetch }) => {
  const read = async <T>(path: string): Promise<T | Error> =>
    fetch(path)
      .then(async (response) => {
        if (!response.ok) throw new Error(`the hub answered ${response.status}`);
        return (await response.json()) as T;
      })
      .catch((error: unknown) => error as Error);

  const [limits, claude, opencode, blocksClaude, blocksOpenCode] = await Promise.all([
    read<UsageLimitsResponse>('/api/usage/limits'),
    read<UsageSummary>('/api/usage/summary?harness=claude&groupBy=model'),
    read<UsageSummary>('/api/usage/summary?harness=opencode&groupBy=model'),
    read<UsageBlocksResponse>('/api/usage/blocks?harness=claude&recentDays=3'),
    read<UsageBlocksResponse>('/api/usage/blocks?harness=opencode&recentDays=3'),
  ]);

  return {
    limits: limits instanceof Error ? null : limits,
    claude: claude instanceof Error ? null : claude,
    opencode: opencode instanceof Error ? null : opencode,
    blocksClaude: blocksClaude instanceof Error ? [] : blocksClaude.blocks,
    blocksOpenCode: blocksOpenCode instanceof Error ? [] : blocksOpenCode.blocks,
    error: [limits, claude, opencode].every((r) => r instanceof Error)
      ? 'Could not reach the hub for usage data. Check that it is running, then try again.'
      : null,
  };
};
