/**
 * What the reader has said about a directory, over what the app inferred:
 * whether the rail draws it as a folder, which hue it wears, and which mark.
 * All three are the same kind of claim — "this directory, to me, is this" —
 * so they live in one document under one key rather than three.
 *
 * Keyed by cwd, the one name a directory cannot be renamed out of, which is
 * also what `identity.ts` hashes: an override and the default it replaces are
 * always talking about the same thing.
 */
import { browser } from '$app/environment';
import {
  IconBoltDuo,
  IconBookDuo,
  IconBoxDuo,
  IconCpuDuo,
  IconDatabaseDuo,
  IconFireDuo,
  IconFolderDuo,
  IconGhostDuo,
  IconGlobeDuo,
  IconLabDuo,
  IconLeafDuo,
  IconPaletteDuo,
  IconPlanetDuo,
  IconRocketDuo,
  IconSparklesDuo,
  IconTerminalDuo,
} from '$lib/icons';
import { identityHue } from './identity';

/** Whether the rail folds this directory's sessions under a header. */
export type Grouping = 'grouped' | 'ungrouped';

export interface FolderPref {
  grouping?: Grouping;
  /** A hue chosen by hand; without one, the cwd's hash chooses. */
  hue?: number;
  /** A key into `FOLDER_MARKS`; without one, the folder mark. */
  icon?: string;
}

const KEY = 'outpost-folder-prefs';

/** The marks a folder can wear. The folder is first because it is the default. */
export const FOLDER_MARKS = [
  { key: 'folder', label: 'Folder', Icon: IconFolderDuo },
  { key: 'sparkles', label: 'Sparkles', Icon: IconSparklesDuo },
  { key: 'rocket', label: 'Rocket', Icon: IconRocketDuo },
  { key: 'box', label: 'Box', Icon: IconBoxDuo },
  { key: 'globe', label: 'Globe', Icon: IconGlobeDuo },
  { key: 'terminal', label: 'Terminal', Icon: IconTerminalDuo },
  { key: 'book', label: 'Book', Icon: IconBookDuo },
  { key: 'lab', label: 'Lab', Icon: IconLabDuo },
  { key: 'database', label: 'Database', Icon: IconDatabaseDuo },
  { key: 'cpu', label: 'Chip', Icon: IconCpuDuo },
  { key: 'bolt', label: 'Bolt', Icon: IconBoltDuo },
  { key: 'leaf', label: 'Leaf', Icon: IconLeafDuo },
  { key: 'planet', label: 'Planet', Icon: IconPlanetDuo },
  { key: 'fire', label: 'Fire', Icon: IconFireDuo },
  { key: 'ghost', label: 'Ghost', Icon: IconGhostDuo },
  { key: 'palette', label: 'Palette', Icon: IconPaletteDuo },
] as const;

export type FolderMark = (typeof FOLDER_MARKS)[number]['Icon'];

const MARKS = new Map<string, FolderMark>(FOLDER_MARKS.map((mark) => [mark.key, mark.Icon]));

function read(): Record<string, FolderPref> {
  if (!browser) return {};
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return stored && typeof stored === 'object' ? (stored as Record<string, FolderPref>) : {};
  } catch {
    return {};
  }
}

// Module scope, so every surface that draws a folder — rail, board, peek pane,
// tabs — is reading the same answer rather than its own copy of it.
const prefs = $state<Record<string, FolderPref>>(read());

const save = (): void => {
  if (browser) localStorage.setItem(KEY, JSON.stringify(prefs));
};

/** Merges one field in, and drops the record once it says nothing at all. */
function edit(cwd: string, patch: FolderPref): void {
  const next: FolderPref = { ...prefs[cwd], ...patch };
  for (const [field, value] of Object.entries(next)) {
    if (value === undefined) delete next[field as keyof FolderPref];
  }
  if (Object.keys(next).length === 0) delete prefs[cwd];
  else prefs[cwd] = next;
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
  /** The mark this directory wears; the folder, unless one was picked. */
  mark: (cwd: string): FolderMark => MARKS.get(prefs[cwd]?.icon ?? '') ?? IconFolderDuo,
  chosenMark: (cwd: string): string => prefs[cwd]?.icon ?? 'folder',
  setMark(cwd: string, icon: string | undefined): void {
    edit(cwd, { icon: icon === 'folder' ? undefined : icon });
  },
};

/**
 * Inline style assigning the directory's identity hue — the override where
 * there is one. Every surface that colours by identity goes through this.
 */
export function identityVar(cwd: string): string {
  return `--identity-h: ${folderPrefs.hue(cwd)}`;
}
