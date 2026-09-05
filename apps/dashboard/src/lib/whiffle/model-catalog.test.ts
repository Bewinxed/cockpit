import { expect, test } from "bun:test";
import { type HarnessModel, modelsForHarness } from "./model-catalog";

test("model ids and labels stay within the selected harness", () => {
  const catalog: HarnessModel[] = [
    {
      harness: "opencode",
      value: "shared",
      displayName: "OpenCode model",
      description: "",
    },
    {
      harness: "claude",
      value: "shared",
      displayName: "Claude model",
      description: "",
    },
    {
      harness: "opencode",
      value: "deepseek",
      displayName: "DeepSeek",
      description: "",
    },
  ];
  expect(
    modelsForHarness(catalog, "claude").map((row) => row.displayName)
  ).toEqual(["Claude model"]);
  expect(modelsForHarness(catalog, "opencode").map((row) => row.value)).toEqual(
    ["shared", "deepseek"]
  );
  expect(modelsForHarness(catalog, "pi")).toEqual([]);
  expect(modelsForHarness(catalog).map((row) => row.value)).toEqual([
    "shared",
    "deepseek",
  ]);
});
