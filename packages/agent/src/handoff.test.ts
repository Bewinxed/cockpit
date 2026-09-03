import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Envelope, SendPayload } from "@whiffle/core";
import { WHIFFLE_ENV } from "@whiffle/core";
import { handoffTools } from "./handoff";

/**
 * A stand-in hub, so the tools are exercised against a real fetch of a real
 * `/api/instances` shape rather than a mocked roster.
 */
const rows = [
  { id: "self", machineId: "m1", cwd: "/home/o/center.ai", status: "running" },
  { id: "kee-1", machineId: "m2", cwd: "/Users/o/keeboard", status: "running" },
  {
    id: "router",
    machineId: "m1",
    cwd: "/home/o/locallm-router",
    status: "running",
  },
  { id: "dead", machineId: "m1", cwd: "/home/o/old", status: "error" },
  { id: "twin-a", machineId: "m1", cwd: "/home/o/twins", status: "running" },
  { id: "twin-b", machineId: "m2", cwd: "/other/twins", status: "running" },
];

let hub: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  hub = Bun.serve({ port: 0, fetch: () => Response.json(rows) });
  process.env[WHIFFLE_ENV.hubUrl] = `ws://localhost:${hub.port}/ws`;
});

afterAll(() => hub.stop(true));

type Handler = (
  args: Record<string, string>,
  extra: unknown
) => Promise<{ content: unknown[] }>;

const build = () => {
  const sent: Envelope[] = [];
  const tools = handoffTools({
    instanceId: "self",
    cwd: "/home/o/center.ai",
    emit: (envelope) => sent.push(envelope),
  });
  // By name, not by position: a tool added later must not silently renumber
  // what these assertions are pointed at.
  const handlerOf = (name: string): Handler => {
    const found = tools.find((candidate) => candidate.name === name);
    if (!found) {
      throw new Error(`no ${name} tool`);
    }
    return found.handler as unknown as Handler;
  };
  return {
    list: handlerOf("list_sessions"),
    handoff: handlerOf("handoff"),
    start: handlerOf("start_session"),
    sendToUser: handlerOf("send_to_user"),
    sent,
  };
};

const textOf = (result: { content: unknown[] }): string =>
  (result.content[0] as { text: string }).text;

test("the roster lists other running sessions, not this one and not the dead", async () => {
  const { list } = build();
  const text = textOf(await list({}, {}));
  expect(text).toContain("keeboard");
  expect(text).toContain("locallm-router");
  expect(text).not.toContain("/home/o/center.ai"); // itself
  expect(text).not.toContain("/home/o/old"); // errored
});

test("a hand-off emits a send addressed at the target and its machine", async () => {
  const { handoff, sent } = build();
  await handoff(
    { target: "keeboard", message: "auth double-encodes the token" },
    {}
  );

  expect(sent).toHaveLength(1);
  const envelope = sent[0];
  expect(envelope.verb).toBe("send");
  // Routed at the *target's* machine, which is how it crosses machines at all.
  expect(envelope.machineId).toBe("m2");
  expect(envelope.instanceId).toBe("kee-1");
});

test("the message is marked as a peer and does not start a turn", async () => {
  const { handoff, sent } = build();
  await handoff({ target: "keeboard", message: "the finding" }, {});

  const payload = sent[0].payload as SendPayload;
  const message = payload.message as {
    origin?: {
      kind: string;
      from: string;
      name?: string;
      fromSession?: string;
    };
    shouldQuery?: boolean;
    message: { content: string };
  };

  // Reported speech, not the reader's authority.
  expect(message.origin?.kind).toBe("peer");
  expect(message.origin?.from).toBe("self");
  expect(message.origin?.name).toBe("center.ai");
  expect(message.origin?.fromSession).toBe("self");
  // Queued, so the target finishes what it is doing first.
  expect(message.shouldQuery).toBe(false);
  // The body carries the attribution too: the stored transcript does not keep
  // `origin`, so without this a reload shows another agent's words as the user's.
  expect(message.message.content).toContain("the finding");
  expect(message.message.content).toContain("center.ai");
  expect(message.message.content).toContain("not the user");
});

test("an @ prefix and a partial name both resolve", async () => {
  for (const target of ["@keeboard", "keeb", "KEEBOARD"]) {
    const { handoff, sent } = build();
    await handoff({ target, message: "x" }, {});
    expect(sent[0].instanceId).toBe("kee-1");
  }
});

test("an id resolves directly", async () => {
  const { handoff, sent } = build();
  await handoff({ target: "router", message: "x" }, {});
  expect(sent[0].instanceId).toBe("router");
});

test("an unknown target is refused, and says what is running", async () => {
  const { handoff, sent } = build();
  expect(handoff({ target: "nowhere", message: "x" }, {})).rejects.toThrow(
    /keeboard/
  );
  expect(sent).toHaveLength(0);
});

test("an ambiguous name is refused rather than guessed", async () => {
  const { handoff, sent } = build();
  // Two sessions are both called "twins" — sending to either silently is how a
  // hand-off lands somewhere nobody looks again.
  expect(handoff({ target: "twins", message: "x" }, {})).rejects.toThrow(
    /matches 2 sessions/
  );
  expect(sent).toHaveLength(0);
});

test("starting a session spawns it and gives it its opening turn", async () => {
  const { start, sent } = build();
  await start(
    {
      cwd: "/home/o/center.ai",
      prompt: "audit the extension manifest",
    } as never,
    {}
  );

  expect(sent.map((envelope) => envelope.verb)).toEqual(["spawn", "send"]);
  const [spawn, opening] = sent;
  // Same new session on both, so the prompt lands in the session just made.
  expect(spawn.instanceId).toBe(opening.instanceId);
  expect((spawn.payload as { cwd: string }).cwd).toBe("/home/o/center.ai");

  // The opening instruction *should* run — this is the one peer message that
  // is not queued, because the session exists to answer it.
  const message = (opening.payload as { message: Record<string, unknown> })
    .message;
  expect(message.shouldQuery).toBeUndefined();
  expect((message.origin as { kind: string }).kind).toBe("peer");
});

test("a side quest is spawned as scratch, with its worktree flag", async () => {
  const { start, sent } = build();
  await start(
    { cwd: "/home/o/center.ai", prompt: "try it", sideQuest: true } as never,
    {}
  );
  const scratch = (
    sent[0].payload as { scratch?: { worktree?: boolean; baseCwd?: string } }
  ).scratch;
  // No worktree: the quest works in the checkout, nested under its parent.
  expect(scratch).toEqual({ baseCwd: "/home/o/center.ai" });
});

test("a plain session carries no scratch tag", async () => {
  const { start, sent } = build();
  await start({ cwd: "/home/o/center.ai", prompt: "x" } as never, {});
  expect((sent[0].payload as { scratch?: unknown }).scratch).toBeUndefined();
});

test("a user message goes up as a frames envelope with no target and no ask", async () => {
  const { sendToUser, sent } = build();
  const text = textOf(await sendToUser({ message: "the build passed" }, {}));

  expect(sent).toHaveLength(1);
  const envelope = sent[0];
  // Frames travel session → hub, so the hub routes them on `kind`, not a verb
  // like `send`. No machine and no peer: this is the session's own word.
  expect(envelope.verb).toBe("frames");
  expect(envelope.machineId).toBe("");
  expect(envelope.instanceId).toBe("self");
  expect(envelope.payload).toEqual({
    kind: "user_message",
    instanceId: "self",
    text: "the build passed",
  });
  expect(text).toContain("Sent to the user");
});
