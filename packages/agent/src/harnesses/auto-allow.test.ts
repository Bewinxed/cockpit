import { expect, test } from "bun:test";
import { autoAllows } from "./opencode";

test("a bypassing session grants its own tool permissions", () => {
  expect(autoAllows("bypassPermissions", "tool")).toBe(true);
});

test("a question routes even under bypass — the parent session answers it", () => {
  expect(autoAllows("bypassPermissions", "question")).toBe(false);
});

test("every other mode parks its tool permissions", () => {
  expect(autoAllows("default", "tool")).toBe(false);
  expect(autoAllows(undefined, "tool")).toBe(false);
  // `acceptEdits` grants edits and nothing else, which needs the permission's
  // own type: that decision stays inline at the event, not here.
  expect(autoAllows("acceptEdits", "tool")).toBe(false);
});
