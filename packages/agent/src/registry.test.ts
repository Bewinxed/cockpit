import { expect, test } from "bun:test";
import { isNewer } from "./registry";

test.each([
  ["1.0.0+2", "1.0.0+1", false],
  ["1.0.0-beta", "1.0.0-alpha", true],
  ["1.0.0-alpha.10", "1.0.0-alpha.2", true],
  ["1.0.0", "1.0.0-rc.1", true],
  ["1.0.0-rc.1", "1.0.0", false],
  ["1.0.1", "1.0.0", true],
  ["1.0.0", "1.0.1", false],
  ["v1.0.1", "1.0.0", true],
  ["1.0.0", "1.0.0", false],
  ["invalid", "1.0.0", false],
  ["1.0.0", "invalid", true],
  ["invalid", "also-invalid", false],
  ["", "1.0.0", false],
  ["1.0.0", "", true],
])("isNewer(%s, %s) = %s", (candidate, current, expected) => {
  expect(isNewer(candidate, current)).toBe(expected);
});
