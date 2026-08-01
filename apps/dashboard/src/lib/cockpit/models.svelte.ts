/**
 * The model list, once for the whole app. `supportedModels()` is a `Query`
 * method, so it can only be asked through a session that is already up — but the
 * answer is the same everywhere, because it is the same account and the same
 * Claude Code behind every machine. So it is asked through whichever live
 * session answers first, kept in localStorage, and read by both pickers: the
 * header's, and the one on the form for a session that does not exist yet.
 */
import type { ModelInfo } from '@cockpit/core';
import { cockpit, loadModels } from './client.svelte';

/**
 * Both keys hang off one prefix so the imminent product rename is one edit.
 * Nothing else may write the literal.
 */
export const MODEL_STORAGE_PREFIX = 'outpost-models';
const OFFERED_KEY = MODEL_STORAGE_PREFIX;
const RECENT_KEY = `${MODEL_STORAGE_PREFIX}:recent`;

/** How many typed-in model ids are remembered — a shortlist, not a history. */
const RECENT_LIMIT = 5;

/** What the form sends when the user has not chosen: nothing, and the SDK picks. */
export const MODEL_DEFAULT = '';

const read = <T>(key: string, fallback: T): T => {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A browser that refuses to store just asks again next time.
  }
};

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
  store.offered = read<ModelInfo[]>(OFFERED_KEY, []);
  store.recent = read<string[]>(RECENT_KEY, []);
}

/** Any session that could answer a `supportedModels` call right now. */
const liveSession = () =>
  cockpit.runningInstances.find((row) => row.status === 'running') ??
  cockpit.runningInstances[0];

async function ask(): Promise<void> {
  const row = liveSession();
  if (!row) throw new Error('A session has to be running to ask what models it offers.');
  store.loading = true;
  store.error = null;
  try {
    store.offered = await loadModels(row.id, row.machineId);
    write(OFFERED_KEY, store.offered);
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
    return Boolean(liveSession());
  },
};

/**
 * Fills the list if this browser has never seen one. Silent about there being no
 * session to ask through: opening a picker is not the moment to complain that
 * nothing is running.
 */
export function ensureModels(): void {
  if (store.offered.length > 0 || store.loading || !liveSession()) return;
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

/** Remembers an id the user typed, so the next session can pick it off a list. */
export function rememberModel(model: string): void {
  const id = model.trim();
  if (!id) return;
  store.recent = [id, ...store.recent.filter((seen) => seen !== id)].slice(0, RECENT_LIMIT);
  write(RECENT_KEY, store.recent);
}
