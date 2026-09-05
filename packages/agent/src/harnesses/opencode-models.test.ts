import { expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { CONTROL_SUPPORTED_MODELS } from "@whiffle/core";
import type { HarnessContext } from "../harness";
import { OpencodeSession } from "./opencode";

const sessionWithProviders = (
  data: unknown
): { session: OpencodeSession; calls: string[] } => {
  const calls: string[] = [];
  const client = {
    provider: {
      list: ({ query }: { query: { directory: string } }) => {
        calls.push(query.directory);
        return Promise.resolve({ data });
      },
    },
  } as unknown as OpencodeClient;

  return {
    calls,
    session: new OpencodeSession(
      "models",
      {} as HarnessContext,
      client,
      "ses_models",
      "/tmp/opencode-models",
      undefined,
      undefined,
      "http://127.0.0.1:0",
      () => {
        /* child registration is unused by these model tests */
      },
      () => {
        /* release handling is unused by these model tests */
      }
    ),
  };
};

test("supported models include every connected provider, including OAuth providers", async () => {
  const { session, calls } = sessionWithProviders({
    all: [
      {
        id: "openai",
        models: {
          "gpt-5.6-sol": { name: "GPT-5.6 Sol" },
        },
      },
      {
        id: "opencode",
        models: {
          "big-pickle": { name: "Big Pickle" },
        },
      },
      {
        id: "anthropic",
        models: {
          "claude-sonnet-4-6": { name: "Claude Sonnet 4.6" },
        },
      },
    ],
    connected: ["openai", "opencode"],
  });

  await expect(session.control(CONTROL_SUPPORTED_MODELS, [])).resolves.toEqual([
    { value: "openai/gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
    { value: "opencode/big-pickle", displayName: "Big Pickle" },
  ]);
  expect(calls).toEqual(["/tmp/opencode-models"]);
});

test("supported model refresh reads the provider catalog again", async () => {
  const { session, calls } = sessionWithProviders({ all: [], connected: [] });

  await session.control(CONTROL_SUPPORTED_MODELS, []);
  await session.control(CONTROL_SUPPORTED_MODELS, []);

  expect(calls).toHaveLength(2);
});
