// What a turn cited, read out of what the web tools really printed: an Exa
// search's Title/URL blocks, a fetch or a scrape's own input URL, a firecrawl
// search's listed entries — and nothing at all from anything else.
import { expect, test } from 'bun:test';
import { faviconFor, sourcesForMessage } from './sources';
import type { Message } from './types';

const at = new Date('2026-08-15T12:00:00Z');

const message = (type: Message['type'], content = ''): Message => ({
  instanceId: 'i1',
  type,
  content,
  timestamp: at,
});

const call = (
  toolName: string,
  input: Record<string, string> | undefined,
  result: string | undefined,
  status: 'pending' | 'success' | 'error' = 'success'
): Message => ({
  ...message('tool.use', toolName),
  metadata: { toolName, toolInput: input, toolResult: result, toolStatus: status },
});

const EXA_SEARCH = `Title: Beautiful UI — Crafted primitives for AI-native interfaces
URL: https://www.beautifului.dev/
Published: N/A
Author: N/A
Highlights:
Beautiful UI — Crafted primitives for AI-native interfaces

---

Title: Kainiko943/beautiful-ui
URL: https://github.com/Kainiko943/beautiful-ui
Published: N/A
Highlights:
Make AI coding agents design beautiful, accessible, platform-native UI.`;

const FIRECRAWL_SEARCH = `1. What are runes? • Svelte Docs
   https://svelte.dev/docs/svelte/what-are-runes
   Runes are symbols that you use in .svelte files to control the compiler.

2. Introducing runes - Svelte
   https://svelte.dev/blog/runes
   Svelte 5 changes all that with runes.`;

test('an Exa search cites every URL under the title that named it', () => {
  const messages = [
    message('user', 'find it'),
    call('mcp__Exa_ai__web_search_exa', { query: 'beautiful ui' }, EXA_SEARCH),
    message('assistant', 'Here is what I found.'),
  ];
  expect(sourcesForMessage(messages, 2)).toEqual([
    {
      url: 'https://www.beautifului.dev',
      title: 'Beautiful UI — Crafted primitives for AI-native interfaces',
      host: 'beautifului.dev',
    },
    {
      url: 'https://github.com/Kainiko943/beautiful-ui',
      title: 'Kainiko943/beautiful-ui',
      host: 'github.com',
    },
  ]);
});

test('a fetch and a scrape are cited by their input URL, titled by the page heading', () => {
  const messages = [
    message('user', 'read them'),
    call(
      'mcp__Exa_ai__web_fetch_exa',
      { url: 'https://huggingface.co/Qwen/Qwen3.8-27B' },
      '# Qwen/Qwen3.8-27B · Hugging Face\nURL: https://huggingface.co/Qwen/Qwen3.8-27B\n\nThis repository…'
    ),
    call(
      'mcp__firecrawl__firecrawl_scrape',
      { url: 'https://opencode.ai/docs/plugins/' },
      '[Skip to content](https://opencode.ai/docs/plugins/#_top)\n\nPlugins\n======='
    ),
    message('assistant', 'Both say the same thing.'),
  ];
  expect(sourcesForMessage(messages, 3)).toEqual([
    {
      url: 'https://huggingface.co/Qwen/Qwen3.8-27B',
      title: 'Qwen/Qwen3.8-27B · Hugging Face',
      host: 'huggingface.co',
    },
    // No `# heading` on the first line, and the body's own links are the page's,
    // not the call's.
    { url: 'https://opencode.ai/docs/plugins', title: null, host: 'opencode.ai' },
  ]);
});

test('a firecrawl search cites the URL on its own line, titled by the line above it', () => {
  const messages = [
    message('user', 'search'),
    call('mcp__firecrawl__firecrawl_search', { query: 'svelte 5 runes' }, FIRECRAWL_SEARCH),
    message('assistant', 'Runes are compiler keywords.'),
  ];
  expect(sourcesForMessage(messages, 2)).toEqual([
    {
      url: 'https://svelte.dev/docs/svelte/what-are-runes',
      title: 'What are runes? • Svelte Docs',
      host: 'svelte.dev',
    },
    { url: 'https://svelte.dev/blog/runes', title: 'Introducing runes - Svelte', host: 'svelte.dev' },
  ]);
});

test('a map is the site it mapped, not the links it listed', () => {
  const messages = [
    message('user', 'map it'),
    call(
      'mcp__firecrawl__firecrawl_map',
      { url: 'https://www.beautifului.dev/' },
      'https://www.beautifului.dev/docs\nhttps://www.beautifului.dev/components'
    ),
    message('assistant', 'It has two sections.'),
  ];
  expect(sourcesForMessage(messages, 2)).toEqual([
    { url: 'https://www.beautifului.dev', title: null, host: 'beautifului.dev' },
  ]);
});

test('a call that failed cited nothing', () => {
  const messages = [
    message('user', 'map it'),
    call('mcp__firecrawl__firecrawl_map', { url: 'https://exa.ai/' }, 'Streamable HTTP error', 'error'),
    message('assistant', 'That server is down.'),
  ];
  expect(sourcesForMessage(messages, 2)).toEqual([]);
});

test('the same page read twice is cited once, keeping the first title', () => {
  const messages = [
    message('user', 'check'),
    call('mcp__Exa_ai__web_search_exa', { query: 'runes' }, 'Title: Runes\nURL: https://svelte.dev/blog/runes'),
    call('mcp__firecrawl__firecrawl_scrape', { url: 'https://svelte.dev/blog/runes#top' }, 'body'),
    message('assistant', 'Same page.'),
  ];
  expect(sourcesForMessage(messages, 3)).toEqual([
    { url: 'https://svelte.dev/blog/runes', title: 'Runes', host: 'svelte.dev' },
  ]);
});

test('a turn cites twelve pages at most', () => {
  const result = Array.from(
    { length: 20 },
    (_, i) => `Title: Result ${i}\nURL: https://example.com/${i}`
  ).join('\n\n');
  const messages = [
    message('user', 'search'),
    call('mcp__Exa_ai__web_search_exa', { query: 'anything' }, result),
    message('assistant', 'Twenty hits.'),
  ];
  const sources = sourcesForMessage(messages, 2);
  expect(sources).toHaveLength(12);
  expect(sources[11].url).toBe('https://example.com/11');
});

test('the walk back stops at the turn boundary', () => {
  const messages = [
    call('mcp__Exa_ai__web_search_exa', { query: 'old' }, 'Title: Old\nURL: https://old.example.com/'),
    message('assistant', 'The earlier answer.'),
    message('user', 'and now?'),
    call('mcp__Exa_ai__web_search_exa', { query: 'new' }, 'Title: New\nURL: https://new.example.com/'),
    message('assistant', 'The later answer.'),
  ];
  expect(sourcesForMessage(messages, 4)).toEqual([
    { url: 'https://new.example.com', title: 'New', host: 'new.example.com' },
  ]);
  expect(sourcesForMessage(messages, 1)).toEqual([
    { url: 'https://old.example.com', title: 'Old', host: 'old.example.com' },
  ]);
});

test('tools that are not web tools contribute nothing', () => {
  const messages = [
    message('user', 'read the file'),
    call('Read', { file_path: '/tmp/notes.md' }, 'https://example.com/ was in the file'),
    call('WebFetch', { url: 'https://example.com/' }, 'a page'),
    call('mcp__outpost__handoff', { target: 'https://example.com/' }, 'delivered'),
    message('assistant', 'Nothing was searched.'),
  ];
  expect(sourcesForMessage(messages, 4)).toEqual([]);
});

test('only an assistant turn is cited', () => {
  const messages = [
    message('user', 'search'),
    call('mcp__Exa_ai__web_search_exa', { query: 'x' }, 'Title: X\nURL: https://example.com/x'),
    message('thinking', 'let me see'),
  ];
  expect(sourcesForMessage(messages, 2)).toEqual([]);
  expect(sourcesForMessage(messages, 9)).toEqual([]);
});

test('a favicon is asked for by host', () => {
  expect(faviconFor('svelte.dev')).toBe(
    'https://www.google.com/s2/favicons?domain=svelte.dev&sz=32'
  );
});
