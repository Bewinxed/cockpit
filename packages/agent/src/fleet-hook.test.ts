import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEMORY_HOOK } from "./fleet";

/**
 * The SessionStart hook, run as Claude Code runs it: the real text under a real
 * `sh`, with the JSON on stdin. Everything about this file is escaping — a
 * template literal that renders `${HOME}` as the daemon's own home, or a `sed`
 * that quietly matches nothing, is a machine where every session silently gets
 * no per-model guidance and nobody finds out.
 */
const home = await mkdtemp(join(tmpdir(), "whiffle-hook-"));
const script = join(home, "whiffle-model-memory.sh");
const models = join(home, ".claude", "memories", "models");

await Bun.write(script, MEMORY_HOOK);
await Bun.write(join(models, "claude-opus-5.md"), "opus guidance\n");
await Bun.write(join(models, "claude.md"), "anything claude\n");

afterAll(() => rm(home, { recursive: true, force: true }));

/** What the hook put in front of the session, given what Claude Code told it. */
const shown = async (input: string): Promise<string> => {
  const child = Bun.spawn(["sh", script], {
    env: { HOME: home, PATH: process.env.PATH ?? "" },
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(err).toBe("");
  expect(await child.exited).toBe(0);
  return out;
};

test("the session running a model is shown that model’s document", async () => {
  expect(
    await shown(
      '{"session_id":"s","hook_event_name":"SessionStart","model":"claude-opus-5"}'
    )
  ).toBe("opus guidance\n");
});

test("the model as an object, which is the other shape it arrives in", async () => {
  expect(
    await shown(
      '{"model":{"id":"claude-opus-5","display_name":"Opus 5"},"source":"startup"}'
    )
  ).toBe("opus guidance\n");
});

test("longest prefix wins, so a dated id still finds its own document", async () => {
  expect(await shown('{"model":"claude-opus-5-20260315"}')).toBe(
    "opus guidance\n"
  );
  // And a model only the general document covers falls back to that one.
  expect(await shown('{"model":"claude-haiku-9"}')).toBe("anything claude\n");
});

test("a model nothing is named for is shown nothing", async () => {
  expect(await shown('{"model":"gpt-nine"}')).toBe("");
});

test("no model at all is shown nothing — the main CLAUDE.md carries the pointer", async () => {
  expect(await shown('{"session_id":"s","source":"resume"}')).toBe("");
});

test("a machine with no memories directory is quiet about it", async () => {
  const bare = await mkdtemp(join(tmpdir(), "whiffle-hook-bare-"));
  try {
    const child = Bun.spawn(["sh", script], {
      env: { HOME: bare, PATH: process.env.PATH ?? "" },
      stdin: new TextEncoder().encode('{"model":"claude-opus-5"}'),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await new Response(child.stdout).text()).toBe("");
    expect(await new Response(child.stderr).text()).toBe("");
    expect(await child.exited).toBe(0);
  } finally {
    await rm(bare, { recursive: true, force: true });
  }
});
