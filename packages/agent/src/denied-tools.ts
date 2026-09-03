/**
 * The built-in web tools the fleet does not use. Search goes through the Exa
 * MCP and fetch through the firecrawl MCP — both are in the hub's fleet MCP
 * registry and land on every machine — so the built-ins are denied everywhere
 * this daemon reaches: on the sessions it spawns, and in the settings file the
 * user's own `claude` reads.
 */
import { rename } from "node:fs/promises";
import { expandHome } from "./fs";

/** Every `claude` this user starts reads it, daemon-spawned or not. */
const SETTINGS = expandHome("~/.claude/settings.json");

/** The SDK's own names for the two, as `disallowedTools` and `permissions.deny` spell them. */
export const DENIED_WEB_TOOLS = ["WebSearch", "WebFetch"] as const;

/**
 * Claude Code's own subagent tools, denied on every whiffle-spawned session so
 * delegation has exactly one door: the fleet's `delegate` tool (`whiffle` MCP
 * server), routed through the delegate-types registry. The hub sees and the
 * dashboard shows a native `Task` subagent's activity same as anything else in
 * the transcript — the reason for the denial is routing, not visibility: only
 * `delegate` resolves a named type to an enforced harness/model/denyTools, per
 * operator policy, and a session that could still reach `Task`/`Agent`
 * natively could route around that policy entirely.
 */
export const DENIED_NATIVE_SUBAGENT_TOOLS = ["Task", "Agent"] as const;

const said = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * The settings with every `deny` name they did not already carry, and whether
 * that added anything — `changed: false` is a caller with nothing to write.
 * Every other key, and every rule already in the list, comes back out exactly
 * as it went in; only a `deny` that is not a list at all is replaced, because
 * nothing else can be appended to.
 */
export function withDeniedTools(
  settings: unknown,
  deny: readonly string[]
): { changed: boolean; next: Record<string, unknown> } {
  const next = { ...(asRecord(settings) ?? {}) };
  const permissions = { ...(asRecord(next.permissions) ?? {}) };
  const current = Array.isArray(permissions.deny)
    ? (permissions.deny as unknown[])
    : [];
  const missing = deny.filter((tool) => !current.includes(tool));
  if (missing.length === 0) {
    return { changed: false, next };
  }

  permissions.deny = [...current, ...missing];
  next.permissions = permissions;
  return { changed: true, next };
}

/** What a boot-time converge came to, so the daemon can say it in one line. */
export type DenyConvergence =
  | { state: "applied" | "unchanged" }
  | { state: "failed"; detail: string };

/**
 * Puts {@link DENIED_WEB_TOOLS} into `~/.claude/settings.json`, and writes only
 * when that is news. Nothing is written over a file that cannot be parsed: the
 * rest of it is the user's own, and a rewrite from an empty root would take
 * their settings with it.
 */
export const convergeDeniedTools = async (): Promise<DenyConvergence> => {
  try {
    const file = Bun.file(SETTINGS);
    let settings: unknown = {};
    if (await file.exists()) {
      try {
        settings = await file.json();
      } catch (error) {
        return {
          state: "failed",
          detail: `could not parse ~/.claude/settings.json: ${said(error)}`,
        };
      }
    }

    const { changed, next } = withDeniedTools(settings, DENIED_WEB_TOOLS);
    if (!changed) {
      return { state: "unchanged" };
    }

    // Written whole and moved into place: a half-written settings file is a
    // machine whose next `claude` starts with none of the user's settings.
    const temp = `${SETTINGS}.whiffle-${process.pid}`;
    await Bun.write(temp, JSON.stringify(next, null, 2));
    await rename(temp, SETTINGS);
    return { state: "applied" };
  } catch (error) {
    return {
      state: "failed",
      detail: `could not write ~/.claude/settings.json: ${said(error)}`,
    };
  }
};
