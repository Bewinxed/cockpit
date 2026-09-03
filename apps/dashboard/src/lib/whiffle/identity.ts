/**
 * Project identity color — every folder/project owns a stable hue that
 * follows it across the rail, tabs, board cards, and peek pane, so the eye
 * binds work to color before reading a single word.
 *
 * The hue is hashed from the folder's cwd (registered projects hash their
 * cwd too, so renaming a project keeps its color). Ten hues, tuned to stay
 * clear of the reserved state hues' *roles*: identity renders as glyph ink,
 * tints, and underlines — never as a status dot.
 *
 * Usage: set `style={identityVar(cwd)}` on the element — from
 * `folder-prefs.svelte.ts`, which lets a hand-picked hue win over the hash —
 * then color through the `identity-ink` / `identity-tint` /
 * `identity-underline` utilities in app.css, which read `--identity-h` and
 * tune lightness per appearance.
 */

/** Ten identity hues (oklch). No hue below 40: a red folder reads as alarm. */
export const HUES = [55, 85, 115, 145, 175, 205, 235, 265, 295, 330] as const;

/** FNV-1a — tiny, stable, good spread on short path strings. */
function hash(key: string): number {
  let h = 0x81_1c_9d_c5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01_00_01_93);
  }
  return h >>> 0;
}

export function identityHue(key: string): number {
  return HUES[hash(key) % HUES.length];
}
