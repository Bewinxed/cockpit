// `providerOf` names the lab a model id belongs to, so a picker row or a
// delegate header can show its logo. Pure string work — no session, no storage.
// Tested through the plain module (`./provider`): `models.svelte` itself pulls
// in Svelte runes and `$app/*` virtual imports that a `bun test` cannot load.
import { expect, test } from "bun:test";
import { providerOf } from "./provider";

const cases: ReadonlyArray<readonly [model: string, provider: string | null]> =
  [
    ["opencode-go/deepseek-v4-pro", "deepseek"],
    ["claude-sonnet-4-5", "anthropic"],
    ["opencode/deepseek-v4-flash-free", "deepseek"],
    ["gpt-5.2", "openai"],
    ["some-unknown-model", null],
  ];

for (const [model, expected] of cases) {
  const actual = providerOf(model);
  test(`providerOf('${model}') is '${expected}'`, () => {
    expect(actual).toBe(expected);
  });
}
