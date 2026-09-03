/**
 * The machine half of carrying a plugin as bytes.
 *
 * What is proved here is the contract the CLI is handed: a marketplace
 * directory whose every plugin `source` is a path inside it, so the install
 * that follows reads from disk and reaches the network for nothing. And the
 * refusal — a payload arrives over a socket, so a path that climbs out of the
 * directory is a file the fleet would write somewhere nobody asked it to.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FleetPluginPayload } from "@whiffle/core";
import { writeVendoredMarketplace } from "./fleet";

/**
 * A scratch directory, never `~/.claude/whiffle-marketplace`: this machine runs
 * the operator's live sessions, and a test is not allowed to touch what they
 * are running out of.
 */
const VENDOR_DIR = mkdtempSync(join(tmpdir(), "whiffle-vendor-"));

const b64 = (text: string): string => Buffer.from(text).toString("base64");

const payload = (
  name: string,
  files: Record<string, string>
): FleetPluginPayload => ({
  name,
  marketplace: "rtd",
  hash: `hash-${name}`,
  bytes: 0,
  files: Object.entries(files).map(([path, content]) => ({
    path,
    contentBase64: b64(content),
  })),
});

afterEach(() => {
  rmSync(VENDOR_DIR, { recursive: true, force: true });
});

test("writes a marketplace whose plugins are vendored beside it", async () => {
  await writeVendoredMarketplace(
    [
      payload("design-for-ai", {
        ".claude-plugin/plugin.json": '{"name":"design-for-ai"}',
      }),
      payload("code-foundations", { "skills/a/SKILL.md": "# a" }),
    ],
    VENDOR_DIR
  );

  const manifest = await Bun.file(
    join(VENDOR_DIR, ".claude-plugin", "marketplace.json")
  ).json();
  expect(manifest.name).toBe("whiffle");
  // Every source is relative, which is what makes the install a local read.
  expect(manifest.plugins.map((p: { source: string }) => p.source)).toEqual([
    "./plugins/design-for-ai",
    "./plugins/code-foundations",
  ]);
  expect(
    await Bun.file(
      join(VENDOR_DIR, "plugins/code-foundations/skills/a/SKILL.md")
    ).text()
  ).toBe("# a");
});

test("a plugin the fleet stopped carrying is gone, not merely unlisted", async () => {
  await writeVendoredMarketplace([payload("old", { "f.md": "x" })], VENDOR_DIR);
  await writeVendoredMarketplace([payload("new", { "f.md": "y" })], VENDOR_DIR);
  expect(await readdir(join(VENDOR_DIR, "plugins"))).toEqual(["new"]);
});

test("a path that climbs out of the directory is refused", async () => {
  await expect(
    writeVendoredMarketplace(
      [payload("escape", { "../../evil.sh": "rm -rf /" })],
      VENDOR_DIR
    )
  ).rejects.toThrow(/unsafe path/);
});

test("a payload with no files leaves the plugin it already wrote alone", async () => {
  await writeVendoredMarketplace(
    [
      payload("kept", { "a.md": "original" }),
      payload("changed", { "b.md": "before" }),
    ],
    VENDOR_DIR
  );

  // What the hub sends once a machine has reported holding these hashes: the
  // hash, and no bytes. Only the one that actually moved carries content.
  const held = { ...payload("kept", {}), files: undefined };
  await writeVendoredMarketplace(
    [held, payload("changed", { "b.md": "after" })],
    VENDOR_DIR
  );

  // Untouched, not erased — this is the whole hazard of leaving bytes out.
  expect(await Bun.file(join(VENDOR_DIR, "plugins/kept/a.md")).text()).toBe(
    "original"
  );
  expect(await Bun.file(join(VENDOR_DIR, "plugins/changed/b.md")).text()).toBe(
    "after"
  );
  // And it is still offered, so the CLI can still install it.
  const manifest = await Bun.file(
    join(VENDOR_DIR, ".claude-plugin", "marketplace.json")
  ).json();
  expect(manifest.plugins.map((p: { name: string }) => p.name).sort()).toEqual([
    "changed",
    "kept",
  ]);
});
