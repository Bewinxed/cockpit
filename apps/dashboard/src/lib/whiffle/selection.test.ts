// Quoting a passage into the composer and placing the bar over it are the two
// parts of the selection affordance that can be wrong without a browser.
import { expect, test } from "bun:test";
import { barPlacement, quoteBlock, type Rect } from "./selection";

const rect = (
  left: number,
  top: number,
  width: number,
  height: number
): Rect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

/** The transcript pane, as a laptop draws it under the 48px header. */
const pane = rect(300, 48, 900, 800);
const bar = { width: 240, height: 40 };

test("every line of the passage is quoted", () => {
  expect(quoteBlock("first line\nsecond line", "")).toBe(
    "> first line\n> second line\n\n"
  );
});

test("a blank line inside the passage stays blank rather than trailing a space", () => {
  expect(quoteBlock("one\n\ntwo", "")).toBe("> one\n>\n> two\n\n");
});

test("the quote follows what was already typed instead of replacing it", () => {
  expect(quoteBlock("the passage", "why does this happen?")).toBe(
    "why does this happen?\n\n> the passage\n\n"
  );
});

test("a draft already ending in newlines is not separated twice", () => {
  expect(quoteBlock("the passage", "why?\n\n")).toBe(
    "why?\n\n> the passage\n\n"
  );
});

test("a passage over the cap is cut at a word boundary and says so", () => {
  const passage = `${"word ".repeat(500)}tail`; // 2504 chars
  const quoted = quoteBlock(passage, "");
  expect(quoted.endsWith("word…\n\n")).toBe(true);
  expect(quoted.length).toBeLessThan(2020);
});

test("an unbroken token long enough to fill the cap takes the hard cut", () => {
  const quoted = quoteBlock("x".repeat(2400), "");
  expect(quoted).toBe(`> ${"x".repeat(2000)}…\n\n`);
});

test("a passage under the cap keeps its last word", () => {
  expect(quoteBlock("short enough", "")).toBe("> short enough\n\n");
});

test("the bar centres above the selection", () => {
  const at = barPlacement(rect(600, 400, 200, 20), pane, bar);
  expect(at.side).toBe("above");
  expect(at.x).toBe(580); // 600 + 100 − 120
  expect(at.y).toBe(352); // 400 − 40 − 8
});

test("a selection at the top of the window puts the bar under it", () => {
  const at = barPlacement(rect(600, 30, 200, 20), pane, bar);
  expect(at.side).toBe("below");
  expect(at.y).toBe(58); // 50 + 8
});

test("a coarse pointer keeps the bar under the selection, clear of the callout", () => {
  const at = barPlacement(rect(600, 400, 200, 20), pane, bar, "below");
  expect(at.side).toBe("below");
  expect(at.y).toBe(428); // 420 + 8
});

test("a selection at the pane’s left edge holds the gutter", () => {
  const at = barPlacement(rect(310, 400, 40, 20), pane, bar);
  expect(at.x).toBe(308); // 300 + 8
});

test("a selection at the pane’s right edge holds the gutter", () => {
  const at = barPlacement(rect(1150, 400, 40, 20), pane, bar);
  expect(at.x).toBe(952); // 1200 − 8 − 240
});

test("a selection near the pane’s bottom keeps the bar inside it", () => {
  const at = barPlacement(rect(600, 840, 200, 20), pane, bar, "below");
  expect(at.y).toBe(800); // 848 − 8 − 40
});

test("a pane too narrow for the bar still starts at its left gutter", () => {
  const at = barPlacement(rect(320, 400, 40, 20), rect(300, 48, 100, 800), bar);
  expect(at.x).toBe(308);
});
