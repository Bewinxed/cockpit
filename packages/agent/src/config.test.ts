import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, writeConfig } from "./config";

let scratch: string;
let path: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "whiffle-config-"));
  path = join(scratch, "config.json");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

test("repinning preserves credentials and extra fields and restores private mode", async () => {
  await Bun.write(
    path,
    JSON.stringify({ claudeToken: "scratch-token", extra: 1 })
  );
  await chmod(path, 0o644);
  await writeConfig({ hubUrl: "http://new-hub:3456" }, path);
  expect(await readConfig(path)).toMatchObject({
    hubUrl: "http://new-hub:3456",
    claudeToken: "scratch-token",
    extra: 1,
  });
  expect(
    Number.isNaN(Date.parse((await readConfig(path))?.updatedAt ?? ""))
  ).toBe(false);
  // biome-ignore lint/suspicious/noBitwiseOperators: isolate the POSIX permission bits
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  await writeConfig({ claudeToken: undefined }, path);
  expect((await readConfig(path))?.claudeToken).toBeUndefined();
  expect((await readConfig(path))?.hubUrl).toBe("http://new-hub:3456");
});

test.each(["{", "null", "[]", "42"])(
  "malformed JSON %s recovers on write",
  async (content) => {
    expect(await readConfig(path)).toBeUndefined();
    await Bun.write(path, content);
    expect(await readConfig(path)).toBeUndefined();
    await writeConfig({ hubUrl: "http://hub:3456" }, path);
    expect((await readConfig(path))?.hubUrl).toBe("http://hub:3456");
  }
);

test("a malformed hub URL does not discard a recoverable token", async () => {
  await Bun.write(
    path,
    JSON.stringify({ hubUrl: 42, claudeToken: "scratch-token" })
  );
  expect((await readConfig(path))?.hubUrl).toBe("");
  await writeConfig({ hubUrl: "http://hub:3456" }, path);
  expect((await readConfig(path))?.claudeToken).toBe("scratch-token");
});
