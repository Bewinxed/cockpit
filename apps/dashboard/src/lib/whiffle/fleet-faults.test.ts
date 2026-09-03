/**
 * The fault vocabulary, checked against strings this repository really
 * produces. Every `causeOf` case below is quoted from the producer named in the
 * comment — a table of causes that drifts from the daemon's wording is a table
 * that quietly stops recognising anything.
 */
import { describe, expect, it } from "bun:test";
import type { FleetSyncReport } from "@whiffle/core";
import {
  CAUSE,
  causeOf,
  groupFaults,
  hubFaults,
  machineFaults,
  readToolchain,
} from "./fleet-faults";

describe("causeOf", () => {
  it("names the CLI that is too old — the badge the whole investigation started from", () => {
    // The Mac's verbatim badge: `claude plugin install … --scope user` against
    // a claude 2.0.32 that predates the flag.
    expect(causeOf("error: unknown option '--scope'")).toBe("cli-too-old");
  });

  it("names an ssh fallback for a public repo", () => {
    // agent/fleet.ts SSH_REFUSED, all three of its sentences.
    expect(causeOf("git@github.com: Permission denied (publickey).")).toBe(
      "ssh-refused"
    );
    expect(causeOf("Could not read from remote repository.")).toBe(
      "ssh-refused"
    );
    expect(causeOf("Host key verification failed.")).toBe("ssh-refused");
  });

  it("reads the daemon’s own fixed sentences", () => {
    // Each of these is a string literal in packages/agent/src/fleet.ts.
    expect(causeOf("claude CLI not found")).toBe("cli-missing");
    expect(causeOf("marketplace rtd is not linked")).toBe(
      "marketplace-unlinked"
    );
    expect(causeOf("edited on this machine — adopt it or overwrite")).toBe(
      "drifted"
    );
    expect(causeOf("the hub sent no files for this hash")).toBe(
      "missing-bytes"
    );
    expect(causeOf("unsafe path ../../etc/passwd")).toBe("unsafe-path");
    expect(causeOf("bound to a project this machine has no checkout for")).toBe(
      "no-checkout"
    );
    expect(causeOf("timed out after 120s")).toBe("timed-out");
    expect(causeOf("could not parse ~/.claude.json: Unexpected token")).toBe(
      "unparsable"
    );
    expect(causeOf("could not write ~/.claude.json: EACCES")).toBe(
      "unwritable"
    );
    expect(causeOf("not in ~/.claude.json")).toBe("absent");
    expect(causeOf("not on disk")).toBe("absent");
    expect(causeOf("rtd is not in known_marketplaces.json")).toBe("absent");
  });

  it("refuses to guess at a machine failure it does not recognise", () => {
    expect(causeOf("exited 3")).toBe("unknown");
  });

  it("reads an unrecognised HUB failure as a fetch that failed, not as unknown", () => {
    // hub/plugins.ts and hub/skills.ts refusals share no prefix, so the origin
    // is what names them.
    expect(causeOf("no marketplace called rtd in this fleet", "hub")).toBe(
      "unfetchable"
    );
    expect(causeOf("github.com/x/y has no main to download", "hub")).toBe(
      "unfetchable"
    );
    expect(causeOf(undefined, "hub")).toBe("unfetchable");
  });

  it("gives every cause a title, a why, a fix and an affordance", () => {
    for (const copy of Object.values(CAUSE)) {
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.why.length).toBeGreaterThan(0);
      expect(copy.fix.length).toBeGreaterThan(0);
      expect(["resync", "refresh", "settle", "none"]).toContain(copy.action);
    }
  });
});

const report = (over: Partial<FleetSyncReport>): FleetSyncReport => ({
  mcp: {},
  marketplaces: {},
  plugins: {},
  at: 0,
  ...over,
});

describe("machineFaults", () => {
  it("finds every section of the report, including the three that used to be dropped", () => {
    const faults = machineFaults(
      "mac",
      report({
        plugins: {
          "a@rtd": {
            state: "failed",
            detail: "error: unknown option '--scope'",
          },
        },
        memoryDocs: {
          "models/x.md": {
            state: "failed",
            detail: "edited on this machine — adopt it or overwrite",
          },
        },
        memoryHook: {
          state: "failed",
          detail: "could not parse ~/.claude/settings.json",
        },
        hooks: {
          h1: {
            state: "failed",
            detail: "bound to a project this machine has no checkout for",
          },
        },
      })
    );
    expect(faults.map((one) => `${one.scope}:${one.cause}`).sort()).toEqual([
      "hooks:no-checkout",
      "memoryDocs:drifted",
      "memoryHook:unparsable",
      "plugins:cli-too-old",
    ]);
    expect(
      faults.every((one) => one.machineId === "mac" && one.origin === "machine")
    ).toBe(true);
  });

  it("ignores applied and removed rows", () => {
    const faults = machineFaults(
      "mac",
      report({
        mcp: {
          a: { state: "applied" },
          b: { state: "removed", detail: "kept: edited on this machine" },
        },
      })
    );
    expect(faults).toEqual([]);
  });

  it("answers nothing for a machine that has never reported", () => {
    expect(machineFaults("mac", undefined)).toEqual([]);
  });
});

describe("hubFaults", () => {
  it("separates a hub resolve failure from any machine", () => {
    const faults = hubFaults(
      [
        {
          name: "s",
          source: "skills:a/b",
          enabled: true,
          error: "a/b answered 404",
        },
      ],
      [
        {
          id: "p@rtd",
          enabled: true,
          error: "no marketplace called rtd in this fleet",
        },
      ]
    );
    expect(faults).toHaveLength(2);
    expect(
      faults.every((one) => one.origin === "hub" && one.machineId === undefined)
    ).toBe(true);
    expect(faults.map((one) => one.cause)).toEqual([
      "unfetchable",
      "unfetchable",
    ]);
  });

  it("leaves resolved rows alone", () => {
    expect(
      hubFaults([], [{ id: "p@rtd", enabled: true, hash: "abc", bytes: 12 }])
    ).toEqual([]);
  });
});

describe("groupFaults", () => {
  it("collapses one cause on one machine into one problem", () => {
    const faults = machineFaults(
      "mac",
      report({
        plugins: {
          "a@rtd": {
            state: "failed",
            detail: "error: unknown option '--scope'",
          },
          "b@rtd": {
            state: "failed",
            detail: "error: unknown option '--scope'",
          },
          "c@rtd": {
            state: "failed",
            detail: "error: unknown option '--scope'",
          },
        },
      })
    );
    const groups = groupFaults(faults);
    expect(groups).toHaveLength(1);
    expect(groups[0].faults).toHaveLength(3);
  });

  it("keeps the same cause on two machines apart — a fault is attributable or it is nothing", () => {
    const detail = "claude CLI not found";
    const groups = groupFaults([
      ...machineFaults(
        "mac",
        report({ plugins: { "a@rtd": { state: "failed", detail } } })
      ),
      ...machineFaults(
        "obelisk",
        report({ plugins: { "a@rtd": { state: "failed", detail } } })
      ),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("puts hub faults first — nothing downstream is worth chasing until they are gone", () => {
    const groups = groupFaults([
      ...machineFaults(
        "mac",
        report({
          plugins: { "a@rtd": { state: "failed", detail: "exited 1" } },
        })
      ),
      ...hubFaults([], [{ id: "b@rtd", enabled: true, error: "gone" }]),
    ]);
    expect(groups[0].origin).toBe("hub");
  });
});

describe("readToolchain", () => {
  it("says nothing when a daemon reports no toolchain", () => {
    expect(readToolchain(report({}))).toBeUndefined();
    expect(readToolchain(undefined)).toBeUndefined();
  });

  it("names the binary that ran and the newer one hiding behind it", () => {
    // The Mac, exactly: three installs, PATH resolving the stale one first.
    const reading = readToolchain(
      report({
        toolchain: {
          claude: [
            { path: "/usr/local/bin/claude", version: "2.0.32", used: true },
            { path: "/opt/homebrew/bin/claude", version: "2.1.251" },
            { path: "/Users/x/.claude/local/claude", version: "2.0.32" },
          ],
        },
      })
    );
    expect(reading?.used).toEqual({
      path: "/usr/local/bin/claude",
      version: "2.0.32",
    });
    expect(reading?.others).toHaveLength(2);
    expect(reading?.shadowed).toBe(true);
  });

  it("does not cry shadowing when the one in use is the newest", () => {
    const reading = readToolchain(
      report({
        toolchain: {
          claude: [
            {
              path: "/opt/homebrew/bin/claude",
              version: "2.1.251",
              used: true,
            },
            { path: "/usr/local/bin/claude", version: "2.0.32" },
          ],
        },
      })
    );
    expect(reading?.shadowed).toBe(false);
  });

  it("will not compare versions it could not read", () => {
    const reading = readToolchain(
      report({
        toolchain: {
          claude: [{ path: "/a/claude", used: true }, { path: "/b/claude" }],
        },
      })
    );
    expect(reading?.shadowed).toBe(false);
  });
});
