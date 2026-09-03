import type { AvailableCommand } from "@whiffle/core";

/**
 * A run of commands the palette shows under one heading, or — when `source` is
 * absent — the headingless run of plain commands that opens the list.
 *
 * `start` is where the run's first command sits in the flat ordered list, so a
 * row's option index stays `start + i`: headings are drawn between runs but are
 * never counted, and the keyboard walks the flat list as it always has.
 */
export interface CommandGroup {
  commands: AvailableCommand[];
  source?: string;
  start: number;
}

/** MCP prompts are the only commands whose namespace is a server, not a plugin. */
const isMcpGroup = (commands: AvailableCommand[]) =>
  commands.every((cmd) => cmd.type === "mcp");

/**
 * Puts namespaced commands into contiguous runs: everything unnamespaced first
 * in the order it arrived, then the plugin namespaces alphabetically, then the
 * MCP servers — the ones a reader is least often reaching for. Within a
 * namespace the commands sort by name. A list where nothing carries a `source`
 * comes back untouched.
 */
export function orderCommands(
  commands: AvailableCommand[]
): AvailableCommand[] {
  const loose: AvailableCommand[] = [];
  const bySource = new Map<string, AvailableCommand[]>();
  for (const command of commands) {
    if (!command.source) {
      loose.push(command);
      continue;
    }
    const members = bySource.get(command.source);
    if (members) {
      members.push(command);
    } else {
      bySource.set(command.source, [command]);
    }
  }

  const groups = [...bySource.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, members]) => ({
      source,
      members: members.sort((a, b) => a.name.localeCompare(b.name)),
    }));

  return [
    ...loose,
    ...groups
      .filter((group) => !isMcpGroup(group.members))
      .flatMap((group) => group.members),
    ...groups
      .filter((group) => isMcpGroup(group.members))
      .flatMap((group) => group.members),
  ];
}

/**
 * The `/token` being typed at the caret, or `null`.
 *
 * The menu is only live while the caret sits inside the token, and only when the
 * `/` opens a word — `/home/whiffle` and `see /tmp/x` are paths the reader is
 * writing, not commands they are reaching for, and a menu over one would fight
 * them mid-sentence.
 */
export function commandAt(
  text: string,
  caret: number
): { term: string; start: number } | null {
  const before = text.slice(0, caret);
  const slash = before.lastIndexOf("/");
  if (slash === -1) {
    return null;
  }
  // Opening a word: start of input, or preceded by whitespace.
  if (slash > 0 && !/\s/.test(before[slash - 1])) {
    return null;
  }
  const term = before.slice(slash + 1);
  // Still one word — a space ends the token.
  if (/\s/.test(term)) {
    return null;
  }
  return { term, start: slash };
}

/**
 * The text and caret left behind when a chosen command replaces the token.
 *
 * Only `[token.start, caret)` goes: the words either side of a token typed
 * mid-line stay where the reader put them, which is the point of the menu
 * opening anywhere rather than only at the head of the message.
 */
export function insertCommand(
  text: string,
  token: { start: number },
  caret: number,
  name: string
): { text: string; caret: number } {
  // The trailing space is what closes the menu — a space in the term makes
  // `commandAt` return null. It is not written when the text after the caret
  // already starts with one, or picking a command mid-sentence leaves a gap.
  const rest = text.slice(caret);
  const insert = /^\s/.test(rest) ? `/${name}` : `/${name} `;
  return {
    text: text.slice(0, token.start) + insert + rest,
    caret: token.start + insert.length,
  };
}

/** What the palette narrows to as the reader types, in the order it draws them. */
export function filterCommands(
  commands: AvailableCommand[],
  filter: string
): AvailableCommand[] {
  const searchTerm = filter.toLowerCase().replace(/^\//, "");
  return orderCommands(
    commands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(searchTerm) ||
        (cmd.description?.toLowerCase().includes(searchTerm) ?? false)
    )
  );
}

/** Cuts an ordered list at its namespace boundaries. A run with no members has no heading. */
export function groupCommands(ordered: AvailableCommand[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  ordered.forEach((command, index) => {
    const run = groups[groups.length - 1];
    if (run && run.source === command.source) {
      run.commands.push(command);
    } else {
      groups.push({
        source: command.source,
        start: index,
        commands: [command],
      });
    }
  });
  return groups;
}

/**
 * What a row reads as under its heading: the heading already carries the
 * namespace, so `interfaces:better-ui` shows as `better-ui` and the MCP prompt
 * `mcp__whiffle__handoff` as `handoff`. Only the label shortens — what the
 * composer inserts, and what a screen reader announces, is the full name.
 */
export function displayName(command: AvailableCommand): string {
  if (!command.source) {
    return command.name;
  }
  if (command.type === "mcp") {
    return command.name.split("__").pop() ?? command.name;
  }
  const prefix = `${command.source}:`;
  return command.name.startsWith(prefix)
    ? command.name.slice(prefix.length)
    : command.name;
}
