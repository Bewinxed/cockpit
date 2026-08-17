/**
 * The model list, once for the whole app. `supportedModels()` is a `Query`
 * method, so it can only be asked through a session that is already up — and
 * each harness type returns its own list (Claude models from a Claude session,
 * opencode models from an opencode session). One session per unique harness is
 * queried and the results are merged, so the picker shows everything the fleet
 * can run. Kept in localStorage across visits.
 */
import type { InstanceRow, ModelInfo } from '@cockpit/core';
import { cockpit, loadModels } from './client.svelte';
import { readJson, writeJson } from './storage';

/**
 * Both keys hang off one prefix so the imminent product rename is one edit.
 * Nothing else may write the literal.
 */
export const MODEL_STORAGE_PREFIX = 'outpost-models';
const OFFERED_KEY = MODEL_STORAGE_PREFIX;
const RECENT_KEY = `${MODEL_STORAGE_PREFIX}:recent`;

/** How many typed-in model ids are remembered — a shortlist, not a history. */
const RECENT_LIMIT = 5;

/** Whether this id is known — it matches an offered model by value or resolvedModel. */
const isKnownModel = (id: string): boolean =>
  store.offered.some((row) => covers(row, id));

/** What the form sends when the user has not chosen: nothing, and the SDK picks. */
export const MODEL_DEFAULT = '';

const store = $state({
  offered: [] as ModelInfo[],
  recent: [] as string[],
  loading: false,
  /** Why the last read failed, for the picker to say instead of showing nothing. */
  error: null as string | null,
});

// What the last visit learned, read once as the module loads rather than from a
// getter — a read that writes is a render that mutates. Nothing to read on the
// server, where the picker is a trigger and no more.
if (typeof localStorage !== 'undefined') {
  store.offered = readJson<ModelInfo[]>(OFFERED_KEY, []);
  store.recent = readJson<string[]>(RECENT_KEY, []);

  // A past session may have remembered an id that no offered model covers — a
  // typo, a dot where a hyphen belongs, or a model that was removed. Drop those
  // once so they stop being offered, rather than lingering in localStorage.
  // Guard: if the offered list itself is empty (first visit, no session yet),
  // keep everything — nothing to validate against.
  if (store.offered.length > 0) {
    const cleaned = store.recent.filter((id) => isKnownModel(id));
    if (cleaned.length !== store.recent.length) {
      store.recent = cleaned;
      writeJson(RECENT_KEY, cleaned);
    }
  }
}

/** One running session per unique harness, so each harness type is queried. */
function liveByHarness(): InstanceRow[] {
  const seen = new Set<string>();
  const result: InstanceRow[] = [];
  for (const row of cockpit.runningInstances) {
    const harness = row.harness ?? 'claude';
    if (seen.has(harness)) continue;
    seen.add(harness);
    result.push(row);
  }
  return result;
}

/** Whether any running session can answer a `supportedModels` call. */
const hasLiveSession = () => cockpit.runningInstances.length > 0;

async function ask(): Promise<void> {
  const rows = liveByHarness();
  if (rows.length === 0) throw new Error('A session has to be running to ask what models it offers.');
  store.loading = true;
  store.error = null;
  try {
    const lists = await Promise.all(
      rows.map((row) => loadModels(row.id, row.machineId).catch((): ModelInfo[] => []))
    );
    // Merge and deduplicate by value — first occurrence wins (preserves order).
    const seen = new Set<string>();
    const merged: ModelInfo[] = [];
    for (const list of lists) {
      for (const model of list) {
        if (seen.has(model.value)) continue;
        seen.add(model.value);
        merged.push(model);
      }
    }
    store.offered = merged;
    writeJson(OFFERED_KEY, merged);
  } finally {
    store.loading = false;
  }
}

export const models = {
  get offered(): ModelInfo[] {
    return store.offered;
  },
  /** Typed-in ids the offered list does not cover, newest first. */
  get recent(): string[] {
    return store.recent.filter((id) => !store.offered.some((row) => covers(row, id)));
  },
  get loading(): boolean {
    return store.loading;
  },
  get error(): string | null {
    return store.error;
  },
  /** Whether a session is up to ask through — what the refresh item is gated on. */
  get askable(): boolean {
    return hasLiveSession();
  },
};

/**
 * Fills the list if this browser has never seen one. Silent about there being no
 * session to ask through: opening a picker is not the moment to complain that
 * nothing is running.
 */
export function ensureModels(): void {
  if (store.offered.length > 0 || store.loading || !hasLiveSession()) return;
  void ask().catch((error: unknown) => {
    store.error = error instanceof Error ? error.message : String(error);
  });
}

/** Asks again and replaces what was cached — the picker's "Refresh models". */
export async function refreshModels(): Promise<void> {
  try {
    await ask();
  } catch (error) {
    store.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

/**
 * An offered row stands for a model id if either name matches: `system.init`
 * reports the wire id (`claude-sonnet-5`) while the row that offers it is keyed
 * by its alias (`sonnet`).
 */
export const covers = (row: ModelInfo, model: string): boolean =>
  row.value === model || row.resolvedModel === model;

/** What to call a model in a trigger: the offered name, or the id as typed. */
export function modelLabel(model: string): string {
  if (!model) return 'Default';
  return models.offered.find((row) => covers(row, model))?.displayName ?? model;
}

/**
 * Which lab makes a model, for the logo in a picker row or a delegate's header.
 * An id may carry a route prefix (`opencode-go/deepseek-v4-pro`), so the part
 * after the last `/` is what matches. Prefix-first and case-insensitive: a
 * single token decides a whole family, and anything else is not our call.
 *
 * Pure string work, so it lives in a plain module — `models.svelte.ts` is full
 * of Svelte runes and `$app/*` imports, which no plain `bun test` can load.
 */
export { providerOf } from './provider';

/**
 * Remembers an id the user typed, so the next session can pick it off a list.
 * Only ids that match an offered model are stored — anything else would persist
 * typos and invalid ids that force themselves into the picker on every load.
 * When the offered list is empty (no session has reported models yet), the id is
 * stored optimistically and cleaned on the next load that has a list.
 */
export function rememberModel(model: string): void {
  const id = model.trim();
  if (!id) return;
  if (store.offered.length > 0 && !isKnownModel(id)) return;
  store.recent = [id, ...store.recent.filter((seen) => seen !== id)].slice(0, RECENT_LIMIT);
  writeJson(RECENT_KEY, store.recent);
}
