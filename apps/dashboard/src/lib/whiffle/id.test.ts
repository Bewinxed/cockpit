// `newId`'s fallback path only runs where `crypto.randomUUID` is absent — a
// plain-http origin off localhost. That is precisely the environment this
// test cannot reproduce in Bun (where `randomUUID` always exists), so it
// hands `newId` a stub `Crypto` instead of mutating the real global.
import { expect, test } from "bun:test";
import { newId } from "./id";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A `Crypto` with no `randomUUID` at all — the shape of an insecure origin. */
function insecureCrypto(): Crypto {
  return {
    getRandomValues: <T extends ArrayBufferView | null>(arr: T) =>
      globalThis.crypto.getRandomValues(arr),
  } as Crypto;
}

test("the fallback produces a syntactically valid v4 UUID", () => {
  const id = newId(insecureCrypto());
  expect(id).toMatch(UUID_V4);
});

test("the fallback is what runs when randomUUID is absent", () => {
  let calls = 0;
  const source = insecureCrypto();
  const spied: Crypto = {
    ...source,
    getRandomValues: (arr: ArrayBufferView) => {
      calls += 1;
      return source.getRandomValues(arr);
    },
  } as Crypto;

  newId(spied);
  expect(calls).toBe(1);
});

test("randomUUID is preferred when the source has one", () => {
  let calls = 0;
  const stubbed = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const source: Crypto = {
    randomUUID: () => {
      calls += 1;
      return stubbed as `${string}-${string}-${string}-${string}-${string}`;
    },
    getRandomValues: <T extends ArrayBufferView | null>(arr: T) =>
      globalThis.crypto.getRandomValues(arr),
  } as Crypto;

  expect(newId(source)).toBe(stubbed);
  expect(calls).toBe(1);
});

test("ids are unique across many draws", () => {
  const source = insecureCrypto();
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i += 1) {
    ids.add(newId(source));
  }
  expect(ids.size).toBe(1000);
});

test("the default source is the real global crypto", () => {
  // No argument — the seam must not force every caller to pass one.
  expect(newId()).toMatch(UUID_V4);
});
