/**
 * What the reader has said about a directory, over what the app inferred:
 * whether the rail draws it as a folder and which hue it wears. Both are the
 * same kind of claim — "this directory, to me, is this" — so they live in one
 * document under one key rather than two.
 *
 * Keyed by cwd, the one name a directory cannot be renamed out of, which is
 * also what `identity.ts` hashes: an override and the default it replaces are
 * always talking about the same thing.
 */
import { identityHue } from "./identity";
import { readJson, writeJson } from "./storage";

/** Whether the rail folds this directory's sessions under a header. */
export type Grouping = "grouped" | "ungrouped";

export interface FolderPref {
  grouping?: Grouping;
  /** A hue chosen by hand; without one, the cwd's hash chooses. */
  hue?: number;
}

const KEY = "whiffle-folder-prefs";

function read(): Record<string, FolderPref> {
  const stored = readJson<unknown>(KEY, {});
  return stored && typeof stored === "object"
    ? (stored as Record<string, FolderPref>)
    : {};
}

// Module scope, so every surface that draws a folder — rail, board, peek pane,
// tabs — is reading the same answer rather than its own copy of it.
const prefs = $state<Record<string, FolderPref>>(read());

const save = (): void => {
  writeJson(KEY, prefs);
};

/** Merges one field in, and drops the record once it says nothing at all. */
function edit(cwd: string, patch: FolderPref): void {
  const next: FolderPref = { ...prefs[cwd], ...patch };
  for (const [field, value] of Object.entries(next)) {
    if (value === undefined) {
      delete next[field as keyof FolderPref];
    }
  }
  if (Object.keys(next).length === 0) {
    delete prefs[cwd];
  } else {
    prefs[cwd] = next;
  }
  save();
}

export const folderPrefs = {
  /** What the reader said about grouping, if they said anything. */
  grouping: (cwd: string): Grouping | undefined => prefs[cwd]?.grouping,
  setGrouping(cwd: string, grouping: Grouping | undefined): void {
    edit(cwd, { grouping });
  },
  /** The hue this directory wears: the chosen one, else the hashed one. */
  hue: (cwd: string): number => prefs[cwd]?.hue ?? identityHue(cwd),
  /** Only the chosen one — what the picker rings, and what "auto" clears. */
  chosenHue: (cwd: string): number | undefined => prefs[cwd]?.hue,
  setHue(cwd: string, hue: number | undefined): void {
    edit(cwd, { hue });
  },
};

/**
 * Inline style assigning the directory's identity hue — the override where
 * there is one. Every surface that colours by identity goes through this.
 */
export function identityVar(cwd: string): string {
  return `--identity-h: ${folderPrefs.hue(cwd)}`;
}
