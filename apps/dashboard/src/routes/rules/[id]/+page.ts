import { error } from '@sveltejs/kit';
import type { RuleRow, RulesPayload } from '$lib/whiffle/rules';
import type { PageLoad } from './$types';

/**
 * One rule, or the blank one. `new` is the id of a rule that does not exist
 * yet, so composing and editing are the same screen with the same URL shape —
 * and a half-written rule survives a reload only insofar as it was saved,
 * which is the honest behaviour for a thing the whole fleet obeys.
 *
 * The whole table is fetched rather than a by-id endpoint: it is a handful of
 * rows, and the list of names is needed anyway to refuse a duplicate.
 */
export const load: PageLoad = async ({ fetch, params }) => {
  const payload = await fetch('/api/rules')
    .then(async (response) => {
      if (!response.ok) throw new Error(`the hub answered ${response.status}`);
      return (await response.json()) as RulesPayload;
    })
    .catch((caught: unknown) => caught as Error);

  if (payload instanceof Error) {
    return {
      rule: null as RuleRow | null,
      taken: [] as string[],
      composing: params.id === 'new',
      error: `Could not read the rules — ${payload.message}.`,
    };
  }

  const rule = payload.rules.find((candidate) => candidate.id === params.id) ?? null;
  if (params.id !== 'new' && !rule) {
    error(404, 'That rule is gone — it was deleted, or the link is from another hub.');
  }

  return {
    rule,
    taken: payload.rules.filter((other) => other.id !== params.id).map((other) => other.name),
    composing: params.id === 'new',
    error: null as string | null,
  };
};
