import { expect, test } from "bun:test";
import type { UserQuestionResult } from "@whiffle/core";
import { ASK_USER_QUESTION } from "@whiffle/core";
import { applyToolResult, mapFrame } from "./frames";

/**
 * The other half of the question contract, from the folding layer's side: an
 * adapter emits a `tool_use`/`tool_result` pair sharing a request id, and what
 * has to come out is one message carrying the structured outcome on
 * `toolUseResult`. That field is the renderer's only source — the four-branch
 * guessing it replaced is exactly what this pins shut — so if the fold ever
 * stops writing it, the reader gets the loud "result missing" chip and no
 * amount of correct adapter work will show through.
 *
 * The blocks below are byte-for-byte what the opencode adapter emits, so this
 * and `opencode-question.test.ts` meet in the middle: that one proves the pair
 * is produced, this one proves the pair is understood.
 */
const QUESTIONS = [
  {
    question: "Which entities should the pipeline manage?",
    header: "Entities",
    options: [
      { label: "Characters", description: "People the shots keep consistent." },
      { label: "Props", description: "Objects and wardrobe." },
    ],
    multiSelect: true,
  },
];

const use = (id: string) =>
  ({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id,
          name: ASK_USER_QUESTION,
          input: { questions: QUESTIONS },
        },
      ],
    },
  }) as never;

const fold = (id: string, questionResult: UserQuestionResult) => {
  const mapping = mapFrame("i1", use(id));
  applyToolResult(mapping.messages, {
    toolId: id,
    result: "answered",
    isError: false,
    questionResult,
  });
  return mapping.messages[0];
};

test("an answered question folds its outcome onto the tool message", () => {
  const message = fold("q-1", {
    outcome: "answered",
    questions: QUESTIONS,
    answers: {
      "Which entities should the pipeline manage?": ["Characters", "Props"],
    },
  });

  expect(message.metadata?.toolName).toBe(ASK_USER_QUESTION);
  const result = message.metadata?.toolUseResult;
  expect(result?.outcome).toBe("answered");
  // Keyed by question text and still an array: the fold is a hand-off, not a
  // transformation, and anything it normalised here would be a lie downstream.
  expect(
    result && result.outcome === "answered" ? result.answers : null
  ).toEqual({
    "Which entities should the pipeline manage?": ["Characters", "Props"],
  });
});

test("a dismissed question folds as dismissed, with no answers to misread", () => {
  const message = fold("q-2", { outcome: "dismissed", questions: QUESTIONS });

  const result = message.metadata?.toolUseResult;
  expect(result?.outcome).toBe("dismissed");
  expect(result).not.toHaveProperty("answers");
});

test("an unanswered question carries no outcome, and is pending rather than faulty", () => {
  // The state between the ask and the answer. It must not look like the absent
  // case: the renderer draws "waiting" off `toolStatus`, and drawing the red
  // fault chip here would cry broken at every question while it is being read.
  const mapping = mapFrame("i1", use("q-3"));
  const [message] = mapping.messages;

  expect(message.metadata?.toolUseResult).toBeUndefined();
  expect(message.metadata?.toolStatus).toBe("pending");
});
