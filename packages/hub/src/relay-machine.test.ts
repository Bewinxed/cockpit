import { expect, test } from "bun:test";
import type { InstanceRow } from "@whiffle/core";
import { resolveRelayMachine, resolveRequester } from "./server";

/** A row with just the fields the resolution reads; the rest are irrelevant. */
const row = (
  id: string,
  overrides: Partial<InstanceRow> = {}
): InstanceRow => ({
  id,
  machineId: "m1",
  cwd: `/home/o/${id}`,
  status: "running",
  sessionId: null,
  ...overrides,
});

test("an explicit machineId still wins", () => {
  const rows = [row("parent", { machineId: "m1" })];
  expect(
    resolveRelayMachine(
      rows,
      { parent: { instanceId: "parent" } },
      "m-explicit"
    )
  ).toBe("m-explicit");
});

test("a delegate spawn resolves to its parent's machine", () => {
  const rows = [row("parent", { machineId: "m2" })];
  expect(
    resolveRelayMachine(rows, {
      parent: { instanceId: "parent" },
      spawnedBy: { sessionKey: "sess-parent" },
    })
  ).toBe("m2");
});

test("a start_session resolves to the spawnedBy instance's machine", () => {
  const rows = [row("asker", { machineId: "m3" })];
  expect(
    resolveRelayMachine(rows, { spawnedBy: { instanceId: "asker" } })
  ).toBe("m3");
});

test("a send resolves to the target session's own machine", () => {
  const rows = [row("target", { machineId: "m4" })];
  expect(resolveRelayMachine(rows, { instanceId: "target" })).toBe("m4");
});

test("a sessionKey resolves fleet-wide when no machine is given", () => {
  const rows = [
    row("old", {
      machineId: "m1",
      sessionId: "sess-x",
      status: "running",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    row("new", {
      machineId: "m2",
      sessionId: "sess-x",
      status: "running",
      updatedAt: "2026-02-01T00:00:00.000Z",
    }),
  ];
  expect(
    resolveRelayMachine(rows, { spawnedBy: { sessionKey: "sess-x" } })
  ).toBe("m2");
  // The requester is the newest live row carrying the key.
  expect(
    resolveRequester(rows, undefined, { spawnedBy: { sessionKey: "sess-x" } })
  ).toBe("new");
});

test("a machine-scoped lookup still prefers its own machine's row", () => {
  const rows = [
    row("here", {
      machineId: "m1",
      sessionId: "sess-x",
      status: "running",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    row("there", {
      machineId: "m2",
      sessionId: "sess-x",
      status: "running",
      updatedAt: "2026-02-01T00:00:00.000Z",
    }),
  ];
  expect(
    resolveRequester(rows, "m1", { spawnedBy: { sessionKey: "sess-x" } })
  ).toBe("here");
});

test("rows that lost the resume race are skipped", () => {
  const rows = [
    row("dead", {
      machineId: "m1",
      sessionId: "sess-x",
      status: "stopped",
      updatedAt: "2026-03-01T00:00:00.000Z",
    }),
    row("live", {
      machineId: "m1",
      sessionId: "sess-x",
      status: "running",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  ];
  expect(
    resolveRequester(rows, undefined, { spawnedBy: { sessionKey: "sess-x" } })
  ).toBe("live");
});

test("nothing known yields nothing, not a guess", () => {
  expect(resolveRelayMachine([], { instanceId: "ghost" })).toBeUndefined();
  expect(
    resolveRelayMachine([], { spawnedBy: { sessionKey: "sess-ghost" } })
  ).toBeUndefined();
});
