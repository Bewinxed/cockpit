/**
 * Identity mark helpers — maps a session to its Quiet Ledger item mark: an
 * identity HUE (1–8, stable per project/path) carrying a harness GLYPH. Mirrors
 * the marks in mocks/v2-fleet.html (the lead column of every board row).
 */

export type MarkHue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** A stable 1–8 hue from any seed string (project path, machine id). */
export function markHue(seed: string | null | undefined): MarkHue {
  const s = seed ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 8) + 1) as MarkHue;
}

/** The harness glyph path (24×24, stroked) — cube for Claude, chevrons for
 *  opencode/code, the pi bar for pi, cube as the safe default. */
export function harnessGlyphPath(harness: string | null | undefined): string {
  switch ((harness ?? '').toLowerCase()) {
    case 'opencode':
    case 'code':
      return 'M9 8l-4 4 4 4M15 8l4 4-4 4';
    case 'pi':
      return 'M5 7.5h14M9 7.5v9M15 7.5v6.5a2.5 2.5 0 0 0 4 0';
    default:
      return 'M12 4l7 4v8l-7 4-7-4V8z';
  }
}
