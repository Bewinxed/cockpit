import { expect, test } from "bun:test";
import {
  type KnownMarketplace,
  linkedNameIn,
  toUnlink,
  upgradeMarketplaces,
} from "./fleet";

/**
 * A marketplace is added by its source and linked under the name its own
 * `marketplace.json` declares, which is not the name whiffle stores. Resolving
 * one to the other is what keeps a successful add from being reported as a
 * failure, and what makes `plugin@marketplace` name something the CLI knows.
 */
const known = (source: KnownMarketplace["source"]): KnownMarketplace => ({
  source,
});

const rtd: Record<string, KnownMarketplace> = {
  rtd: known({ source: "github", repo: "ryanthedev/rtd-claude-inn" }),
};

test("the name whiffle stores wins when the CLI linked it under that name", () => {
  const linked = {
    interfaces: known({ source: "github", repo: "jakubkrehel/skills" }),
  };
  expect(linkedNameIn(linked, "interfaces", "jakubkrehel/skills")).toBe(
    "interfaces"
  );
});

test("a manifest name that is not the repo name resolves through the source", () => {
  // The case that reported "could not apply" over a successful add.
  expect(linkedNameIn(rtd, "rtd-claude-inn", "ryanthedev/rtd-claude-inn")).toBe(
    "rtd"
  );
});

test("the same link spelled as a URL, an ssh remote or with .git still resolves", () => {
  for (const source of [
    "https://github.com/ryanthedev/rtd-claude-inn",
    "https://github.com/ryanthedev/rtd-claude-inn.git",
    "git@github.com:ryanthedev/rtd-claude-inn.git",
    "git+https://github.com/ryanthedev/rtd-claude-inn.git",
    "https://github.com/RyanTheDev/RTD-Claude-Inn/",
  ]) {
    expect(linkedNameIn(rtd, "rtd-claude-inn", source)).toBe("rtd");
  }
});

test("a marketplace the CLI never linked resolves to nothing", () => {
  expect(linkedNameIn(rtd, "other", "someone/else")).toBeUndefined();
  expect(
    linkedNameIn({}, "rtd-claude-inn", "ryanthedev/rtd-claude-inn")
  ).toBeUndefined();
});

test("a source whiffle has no match for does not borrow another entry name", () => {
  const two = {
    ...rtd,
    interfaces: known({ source: "github", repo: "jakubkrehel/skills" }),
  };
  expect(linkedNameIn(two, "skills", "jakubkrehel/skills")).toBe("interfaces");
  expect(linkedNameIn(two, "skills", "jakubkrehel/other")).toBeUndefined();
});

/**
 * The sidecar names what is whiffle's to take away, so a name it carries has
 * to be one the CLI answers to. An older sidecar's bare string is only that
 * when the CLI still lists it.
 */
test("an older sidecar name the CLI lists is kept, under both names", () => {
  const linked = {
    interfaces: known({ source: "github", repo: "jakubkrehel/skills" }),
  };
  expect(upgradeMarketplaces(["interfaces"], linked)).toEqual([
    { name: "interfaces", linkedAs: "interfaces" },
  ]);
});

test("an older sidecar name the CLI never linked is dropped, not removed later", () => {
  // `rtd-claude-inn` is whiffle's name; the CLI only ever knew `rtd`. Carrying
  // it forward is what would aim a `marketplace remove` at nothing.
  expect(upgradeMarketplaces(["rtd-claude-inn"], rtd)).toEqual([]);
});

test("entries already carrying both names pass through, and a missing list is empty", () => {
  const both = [{ name: "rtd-claude-inn", linkedAs: "rtd" }];
  expect(upgradeMarketplaces(both, rtd)).toEqual(both);
  // Passed through whatever the CLI lists: the sync that follows re-checks it.
  expect(upgradeMarketplaces(both, {})).toEqual(both);
  expect(upgradeMarketplaces(undefined, rtd)).toEqual([]);
});

test("a mixed sidecar upgrades the strings and leaves the rest alone", () => {
  const linked = {
    ...rtd,
    interfaces: known({ source: "github", repo: "jakubkrehel/skills" }),
  };
  expect(
    upgradeMarketplaces(
      ["rtd-claude-inn", "interfaces", { name: "x", linkedAs: "rtd" }],
      linked
    )
  ).toEqual([
    { name: "interfaces", linkedAs: "interfaces" },
    { name: "x", linkedAs: "rtd" },
  ]);
});

/** What whiffle unlinks is what it linked and config no longer asks for. */
const asConfig = (...names: string[]) => ({
  marketplaces: names.map((name) => ({ name, source: `who/${name}` })),
});

test("a marketplace config dropped is unlinked, under the name the CLI knows", () => {
  const managed = [{ name: "rtd-claude-inn", linkedAs: "rtd" }];
  expect(toUnlink(managed, [], asConfig())).toEqual(managed);
});

test("renaming it in config unlinks nothing: the link did not move", () => {
  // The regression this guards: whiffle's name went `rtd-claude-inn` -> `rtd`,
  // both resolve to the link `rtd`, and unlinking it would undo the same sync.
  const managed = [{ name: "rtd-claude-inn", linkedAs: "rtd" }];
  const kept = [{ name: "rtd", linkedAs: "rtd" }];
  expect(toUnlink(managed, kept, asConfig("rtd"))).toEqual([]);
});

test("a name config still asks for is a failed add, not a removal", () => {
  // Nothing is in `kept`, because the add failed — but config still wants it.
  const managed = [{ name: "rtd", linkedAs: "rtd" }];
  expect(toUnlink(managed, [], asConfig("rtd"))).toEqual([]);
});

test("one of two dropped leaves the other linked", () => {
  const managed = [
    { name: "rtd", linkedAs: "rtd" },
    { name: "interfaces", linkedAs: "interfaces" },
  ];
  const kept = [{ name: "interfaces", linkedAs: "interfaces" }];
  expect(toUnlink(managed, kept, asConfig("interfaces"))).toEqual([
    { name: "rtd", linkedAs: "rtd" },
  ]);
});
