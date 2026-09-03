/**
 * What a delegate is for, in one line. The brief a delegation carries is the
 * only place that meaning exists at spawn time, and its opening line is where a
 * writer puts it — so that line, and nothing else, becomes the session's title.
 */

/** How long a title may run, the ellipsis included. */
const LIMIT = 80;

/**
 * The brief's headline: its first non-empty line with the whitespace collapsed,
 * cut at a word boundary when it runs past {@link LIMIT}. The ellipsis is the
 * point — a title that was shortened says so rather than reading as the whole
 * sentence. A brief with nothing in it has no headline, and its session goes
 * untitled rather than taking a made-up one.
 */
export function briefTitle(prompt: string): string | undefined {
  const first = prompt.split("\n").find((text) => text.trim().length > 0);
  if (!first) {
    return undefined;
  }

  const line = first.trim().replace(/\s+/g, " ");
  if (line.length <= LIMIT) {
    return line;
  }

  const cut = line.slice(0, LIMIT - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${boundary > 0 ? cut.slice(0, boundary) : cut}…`;
}
