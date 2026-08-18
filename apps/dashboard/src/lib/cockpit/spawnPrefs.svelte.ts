import type { EffortLevel, PermissionMode } from '@cockpit/core';
import { MODEL_DEFAULT } from './models.svelte';

/**
 * What the new-session form was last set to. A user who picks Fable and a
 * permission mode is telling us how they work, not just how this one session
 * starts — a form that resets to the defaults every visit makes them say it
 * again for every session. Kept out of the model store because a permission
 * mode is not a model concern.
 */
const KEY = 'outpost-spawn-prefs';

interface SpawnPrefs {
  model: string;
  permissionMode: PermissionMode;
  /**
   * `null` is a choice too, and the one to start from: only the model knows
   * which stops it has, so a form that opened on a level would be asserting one
   * before it has anything to assert it against.
   */
  effort: EffortLevel | null;
}

const FALLBACK: SpawnPrefs = { model: MODEL_DEFAULT, permissionMode: 'default', effort: null };

const load = (): SpawnPrefs => {
  if (typeof localStorage === 'undefined') return FALLBACK;
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return FALLBACK;
    const parsed = JSON.parse(stored) as Partial<SpawnPrefs>;
    return {
      model: typeof parsed.model === 'string' ? parsed.model : FALLBACK.model,
      permissionMode:
        typeof parsed.permissionMode === 'string'
          ? (parsed.permissionMode as PermissionMode)
          : FALLBACK.permissionMode,
      effort: typeof parsed.effort === 'string' ? (parsed.effort as EffortLevel) : FALLBACK.effort,
    };
  } catch {
    return FALLBACK;
  }
};

const store = $state<SpawnPrefs>(load());

export const spawnPrefs = {
  get model(): string {
    return store.model;
  },
  get permissionMode(): PermissionMode {
    return store.permissionMode;
  },
  get effort(): EffortLevel | null {
    return store.effort;
  },
};

/** Called when a spawn actually goes out, so a form the user abandoned teaches nothing. */
export function rememberSpawn(prefs: SpawnPrefs): void {
  store.model = prefs.model;
  store.permissionMode = prefs.permissionMode;
  store.effort = prefs.effort;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // A browser that refuses to store just starts from the defaults next time.
  }
}
