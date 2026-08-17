/**
 * Which pages a turn actually read. Every web fact in this fleet arrives
 * through two MCP families — Exa's search and fetch, firecrawl's search,
 * scrape, map and crawl — so an answer's sources are exactly what those calls
 * named between the previous turn boundary and the answer itself.
 *
 * Extraction only, and only from shapes those tools really print: a URL that
 * was neither in a call's input nor in its own output is not a source. An
 * answer with nothing to cite cites nothing, because a guessed citation is
 * worse than a missing one.
 */
import type { JsonValue, Message } from './types';

export interface SourceRef {
  url: string;
  title: string | null;
  host: string;
}

/** Past this the strip is a bibliography, and the answer above it is not. */
const MAX_SOURCES = 12;

const MCP_NAME = /^mcp__(.+?)__(.+)$/;

/**
 * Matched on the tool's own name, the way `familyId()` reads through an
 * `mcp__server__tool`: the same call is `mcp__Exa_ai__web_search_exa` here and
 * `mcp__exa__web_search_exa` on a machine that named the server differently,
 * and the leaf is the part that does not drift.
 */
const EXA_TOOL = /^web_(search|fetch)_exa$/i;
const FIRECRAWL_TOOL = /^firecrawl_(search|scrape|map|crawl)$/i;

function webTool(toolName: string | undefined): string | null {
  const raw = toolName ?? '';
  const leaf = MCP_NAME.exec(raw)?.[2] ?? raw;
  return EXA_TOOL.test(leaf) || FIRECRAWL_TOOL.test(leaf) ? leaf.toLowerCase() : null;
}

/** The site's icon at chip scale, the one the transcript's tool rows already use. */
export function faviconFor(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
}

const textOf = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '');

const inputUrl = (input: JsonValue | undefined): string | undefined => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const url = input.url;
  return typeof url === 'string' ? url : undefined;
};

/** A source, or nothing when the text that looked like a URL is not one. */
function ref(url: string, title: string | null): SourceRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  parsed.hash = '';
  return {
    url: parsed.toString().replace(/\/$/, ''),
    title: title?.trim() || null,
    host: parsed.hostname.replace(/^www\./, ''),
  };
}

function add(found: SourceRef[], source: SourceRef | null): void {
  if (source) found.push(source);
}

const EXA_TITLE = /^Title:\s*(.+)$/;
const EXA_URL = /^URL:\s*(\S+)$/;

/** `web_search_exa` prints one `Title:` / `URL:` pair per result, in that order. */
function exaSearchSources(result: string): SourceRef[] {
  const found: SourceRef[] = [];
  let title: string | null = null;
  for (const line of result.split('\n')) {
    const trimmed = line.trim();
    const named = EXA_TITLE.exec(trimmed);
    if (named) {
      title = named[1];
      continue;
    }
    const url = EXA_URL.exec(trimmed);
    if (url) {
      add(found, ref(url[1], title));
      // Spent: the next result's URL is not this one's title.
      title = null;
    }
  }
  return found;
}

const BARE_URL = /^(https?:\/\/\S+)$/;
const MARKDOWN_LINK = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;

/** `N. <title>` and `Title: <title>` are the two ways a result names itself. */
const titleLine = (line: string): string | null =>
  line
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^Title:\s*/i, '')
    .trim() || null;

/**
 * `firecrawl_search` prints entries whose URL stands on its own line, under the
 * line that titles it. Line-anchored on purpose: a URL inside a sentence is
 * something the page said, not something the search returned.
 */
function listedSources(result: string): SourceRef[] {
  const found: SourceRef[] = [];
  let title: string | null = null;
  for (const line of result.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const link = MARKDOWN_LINK.exec(trimmed);
    if (link) {
      add(found, ref(link[2], link[1]));
      title = null;
      continue;
    }
    const bare = BARE_URL.exec(trimmed);
    if (bare) {
      add(found, ref(bare[1], title));
      title = null;
      continue;
    }
    title = titleLine(trimmed);
  }
  return found;
}

/** A fetched page prints its own `# heading` first when it has one. */
function headingTitle(result: string): string | null {
  const first = result.split('\n', 1)[0]?.trim() ?? '';
  return first.startsWith('# ') ? first.slice(2).trim() || null : null;
}

function sourcesOfCall(message: Message): SourceRef[] {
  if (message.type !== 'tool.use' && message.type !== 'tool.result') return [];
  const leaf = webTool(message.metadata?.toolName);
  if (!leaf) return [];
  // A call that failed read nothing, whatever its input named.
  if (message.metadata?.toolStatus === 'error') return [];

  const result = textOf(message.metadata?.toolResult);
  const url = inputUrl(message.metadata?.toolInput);
  if (leaf === 'web_search_exa') {
    const found = exaSearchSources(result);
    if (found.length > 0) return found;
  } else if (leaf === 'firecrawl_search') {
    const found = listedSources(result);
    if (found.length > 0) return found;
  } else if (url) {
    // A fetch and a scrape are handed their URL — the body is the page, not a
    // list of pages, so nothing is mined out of it but the heading.
    const single = ref(url, headingTitle(result));
    return single ? [single] : [];
  }

  // Everything else — a map, a crawl, a search whose output said nothing this
  // knows how to read — contributes the one URL it was certainly about.
  const single = url ? ref(url, null) : null;
  return single ? [single] : [];
}

/** The previous turn: another answer, or anything a human or a peer said. */
const endsTurn = (message: Message): boolean =>
  message.type === 'assistant' || message.type === 'user' || message.type.startsWith('user.');

export function sourcesForMessage(messages: Message[], index: number): SourceRef[] {
  if (messages[index]?.type !== 'assistant') return [];

  let start = index;
  while (start > 0 && !endsTurn(messages[start - 1])) start -= 1;

  const seen = new Set<string>();
  const sources: SourceRef[] = [];
  for (let i = start; i < index; i += 1) {
    for (const source of sourcesOfCall(messages[i])) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
      if (sources.length === MAX_SOURCES) return sources;
    }
  }
  return sources;
}
