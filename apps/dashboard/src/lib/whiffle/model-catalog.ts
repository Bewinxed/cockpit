import type { HarnessKind, ModelInfo } from "@whiffle/core";

export type HarnessModel = ModelInfo & { harness: HarnessKind };

/** Model ids are unique within a harness; different harnesses may offer the same id. */
export function modelsForHarness(
  catalog: HarnessModel[],
  harness?: string
): ModelInfo[] {
  const seen = new Set<string>();
  return catalog.filter((row) => {
    if ((harness && row.harness !== harness) || seen.has(row.value)) {
      return false;
    }
    seen.add(row.value);
    return true;
  });
}
