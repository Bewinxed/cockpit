import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import type { Envelope } from "@whiffle/core";
import { makeDb } from "./db";
import type { PendingShape } from "./pending";
import type { HubSocket, RegistryShape } from "./registry";
import { createServer } from "./server";

/**
 * What the tab strip is entitled to know: a conversation the reader still has
 * open is named, even after the board has stopped listing it.
 *
 * A scratch database, for the reason every other suite here keeps one — see
 * instance-title.test.ts.
 */
const DB_FILE = `/tmp/whiffle-instance-titles-${crypto.randomUUID()}.db`;
const db = makeDb(DB_FILE);

afterAll(async () => {
  for (const suffix of ["", "-shm", "-wal"]) {
    await Bun.file(`${DB_FILE}${suffix}`)
      .delete()
      .catch(() => {});
  }
});

const MACHINE = "machine-1";
db.upsertAgent({
  machineId: MACHINE,
  hostname: "box",
  os: "linux",
  auth: "authenticated",
});

/** Older than the listing's day-long cut-off, which no db verb writes for us. */
const backdate = (id: string): void => {
  const raw = new Database(DB_FILE);
  raw.run("UPDATE instances SET updated_at = ? WHERE id = ?", [
    Date.now() - 3 * 24 * 60 * 60 * 1000,
    id,
  ]);
  raw.close();
};

const aged = (
  id: string,
  fields: { title?: string; derived?: string }
): void => {
  db.openInstance({
    id,
    machineId: MACHINE,
    cwd: "/home/o/whiffle",
    kind: "mainline",
    ...(fields.title ? { title: fields.title } : {}),
  });
  if (fields.derived) {
    db.noteDerivedTitle(id, fields.derived);
  }
  db.stopInstance(id);
  backdate(id);
};

aged("old-titled", { title: "Port the tab strip to the doctrine" });
aged("old-derived", {
  derived: "check why the firecrawl mcp is not connecting",
});
aged("old-nameless", {});

test("the board stops listing a conversation that has not moved in a day", () => {
  const listed = new Set(db.listInstances().map((row) => row.id));

  expect(listed.has("old-titled")).toBe(false);
  expect(listed.has("old-derived")).toBe(false);
});

test("but its row still answers when it is asked for by id", () => {
  const rows = db.getInstancesByIds([
    "old-titled",
    "old-derived",
    "old-nameless",
  ]);

  expect(rows.map((row) => row.id).sort()).toEqual([
    "old-derived",
    "old-nameless",
    "old-titled",
  ]);
  expect(rows.find((row) => row.id === "old-titled")?.title).toBe(
    "Port the tab strip to the doctrine"
  );
  // Raw, so a caller can still tell a given name from a derived one.
  expect(rows.find((row) => row.id === "old-derived")?.title).toBeNull();
  expect(rows.find((row) => row.id === "old-derived")?.derivedTitle).toBe(
    "check why the firecrawl mcp is not connecting"
  );
});

test("a discarded side quest stays gone, however it is asked for", () => {
  db.openInstance({
    id: "thrown-away",
    machineId: MACHINE,
    cwd: "/home/o/whiffle",
    kind: "scratch",
    title: "A side quest",
  });
  db.discardInstance("thrown-away");

  expect(db.getInstancesByIds(["thrown-away"])).toEqual([]);
});

test("nothing asked for is nothing queried", () => {
  expect(db.getInstancesByIds([])).toEqual([]);
});

test("the machine is only asked for its catalog when something is unnamed", () => {
  // A stored conversation nobody has named: the one case a catalog read pays for.
  db.openInstance({
    id: "stored-nameless",
    machineId: MACHINE,
    cwd: "/home/o/whiffle",
    sessionId: "sdk-session-1",
    kind: "mainline",
  });
  backdate("stored-nameless");

  expect(db.unnamedSessions(MACHINE).map((row) => row.id)).toEqual([
    "stored-nameless",
  ]);

  // Named, and the machine has nothing left to be asked about.
  db.noteDerivedTitle("stored-nameless", "Wire the strip to the hub");

  expect(db.unnamedSessions(MACHINE)).toEqual([]);
});

test("a row with no stored conversation is not something a catalog could name", () => {
  // `old-nameless` has no session id, so no catalog entry could ever match it.
  expect(
    db.unnamedSessions(MACHINE).some((row) => row.id === "old-nameless")
  ).toBe(false);
});

/** No machine is connected, so nothing can be read off one. */
const registry: RegistryShape = {
  registerAgent: () => {},
  dropAgent: () => undefined,
  agent: () => undefined as HubSocket | undefined,
  machineIds: () => [],
  addDashboard: () => {},
  dropDashboard: () => {},
  broadcast: (_: Envelope) => {},
  broadcastFrame: () => {},
  setSubscriptions: () => {},
  noteDashboardOrigin: () => {},
  dashboardOrigin: () => undefined,
  rememberRequester: () => {},
  takeRequester: () => undefined,
};

const pending: PendingShape = {
  remember: () => {},
  get: () => undefined,
  resolve: () => {},
  forget: () => {},
  list: () => [],
};

// A real socket on a throwaway port: this Elysia builds its route table when it
// starts listening, so an in-process `handle` answers 404 to routes that exist.
const app = createServer({ registry, db, pending }).listen(0);
const port = app.server?.port;
afterAll(() => {
  app.stop();
});

const askTitles = async (
  ids: unknown[]
): Promise<{ id: string; title: string | null }[]> => {
  const response = await fetch(
    `http://localhost:${port}/api/instances/titles`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string; title: string | null }[];
};

test("the naming route answers for conversations the listing has aged out", async () => {
  const titles = await askTitles(["old-titled", "old-derived"]);

  expect(titles).toEqual([
    { id: "old-titled", title: "Port the tab strip to the doctrine" },
    {
      id: "old-derived",
      title: "check why the firecrawl mcp is not connecting",
    },
  ]);
});

test("a conversation nobody ever named, on a machine nobody can reach, answers null", async () => {
  const titles = await askTitles(["old-nameless", "never-seen-at-all"]);

  expect(titles).toEqual([
    { id: "old-nameless", title: null },
    { id: "never-seen-at-all", title: null },
  ]);
});

test("an ask may carry the machine/cwd/harness a stored-session tab addresses itself with", async () => {
  const titles = await askTitles([
    {
      id: "old-titled",
      machine: MACHINE,
      cwd: "/home/o/whiffle",
      harness: "claude",
    },
    // The strip stores a machine-less visit as an explicit null.
    { id: "old-derived", machine: null },
  ]);

  expect(titles).toEqual([
    { id: "old-titled", title: "Port the tab strip to the doctrine" },
    {
      id: "old-derived",
      title: "check why the firecrawl mcp is not connecting",
    },
  ]);
});

test("one conversation asked about twice is answered once", async () => {
  expect(await askTitles(["old-titled", "old-titled"])).toEqual([
    { id: "old-titled", title: "Port the tab strip to the doctrine" },
  ]);
});

test("a body that asks about the whole world is cut to what a reader can have open", async () => {
  const titles = await askTitles(
    Array.from({ length: 200 }, (_, index) => `flood-${index}`)
  );

  expect(titles.length).toBe(64);
});
