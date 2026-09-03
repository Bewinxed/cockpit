import { afterEach, beforeEach, expect, test } from "bun:test";
import { sessiondEndpoint } from "./sessiond";

/**
 * `sessiondEndpoint()`'s derivation (design §12) branches on `process.platform`
 * and two env vars. `process.platform` is read-only on the real process object,
 * so each case stubs it with `Object.defineProperty` and restores the original
 * afterwards — the only way to exercise all three platforms from one test run.
 */
const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_XDG = process.env.XDG_RUNTIME_DIR;
const ORIGINAL_USERNAME = process.env.USERNAME;
const ORIGINAL_USER = process.env.USER;

const setPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
};

beforeEach(() => {
  delete process.env.XDG_RUNTIME_DIR;
  delete process.env.USERNAME;
  delete process.env.USER;
});

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
  if (ORIGINAL_XDG === undefined) {
    delete process.env.XDG_RUNTIME_DIR;
  } else {
    process.env.XDG_RUNTIME_DIR = ORIGINAL_XDG;
  }
  if (ORIGINAL_USERNAME === undefined) {
    delete process.env.USERNAME;
  } else {
    process.env.USERNAME = ORIGINAL_USERNAME;
  }
  if (ORIGINAL_USER === undefined) {
    delete process.env.USER;
  } else {
    process.env.USER = ORIGINAL_USER;
  }
});

test("linux with XDG_RUNTIME_DIR set: socket lives under the runtime dir", () => {
  setPlatform("linux");
  process.env.XDG_RUNTIME_DIR = "/run/user/1000";
  expect(sessiondEndpoint()).toBe("/run/user/1000/whiffle/sessiond.sock");
});

test("linux with no XDG_RUNTIME_DIR: falls back to ~/.whiffle (ad-hoc runs)", () => {
  setPlatform("linux");
  const endpoint = sessiondEndpoint();
  expect(endpoint.endsWith("/.whiffle/sessiond.sock")).toBe(true);
  expect(endpoint.includes("undefined")).toBe(false);
});

test("darwin: always ~/.whiffle, never XDG_RUNTIME_DIR (sun_path is 104 bytes there)", () => {
  setPlatform("darwin");
  process.env.XDG_RUNTIME_DIR = "/run/user/1000";
  const endpoint = sessiondEndpoint();
  expect(endpoint.endsWith("/.whiffle/sessiond.sock")).toBe(true);
  expect(endpoint.includes("/run/user/1000")).toBe(false);
});

test("win32: a reserved named-pipe name, keyed by the OS username", () => {
  setPlatform("win32");
  process.env.USERNAME = "alex";
  expect(sessiondEndpoint()).toBe("\\\\.\\pipe\\whiffle-sessiond-alex");
});

test("win32 with no USERNAME: falls back to USER, then a fixed default", () => {
  setPlatform("win32");
  process.env.USER = "alex";
  expect(sessiondEndpoint()).toBe("\\\\.\\pipe\\whiffle-sessiond-alex");

  delete process.env.USER;
  expect(sessiondEndpoint()).toBe("\\\\.\\pipe\\whiffle-sessiond-default");
});
