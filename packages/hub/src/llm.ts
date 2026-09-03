import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  APICallError,
  generateObject,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
  RetryError,
  streamText,
} from "ai";
import {
  type InferOutput,
  literal,
  object,
  safeParse,
  string,
  union,
} from "valibot";

/**
 * Structured verdict a supervisor LLM returns for a single evaluation.
 *
 * The valibot schema is the source of truth for the shape; the jsonSchema
 * wrapper hands AI SDK the JSON Schema it needs for the provider's
 * structured-output mode while valibot validates the parsed result.
 * (Valibot's Standard Schema does not yet implement toJsonSchema — this
 * is the designed fallback from PLAN.md C2.)
 */
export const VerdictSchema = object({
  verdict: union([
    literal("silent"),
    literal("reply"),
    literal("escalate"),
    literal("ask_operator"),
  ]),
  message: string(),
  note: string(),
});

export type Verdict = InferOutput<typeof VerdictSchema>;

/** JSON Schema for the provider's structured-output / guided-decoding mode. */
const VerdictJsonSchema = jsonSchema<Verdict>(
  {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: ["silent", "reply", "escalate", "ask_operator"],
      },
      message: { type: "string" },
      note: { type: "string" },
    },
    required: ["verdict", "message", "note"],
    additionalProperties: false,
  },
  {
    validate: (value) => {
      const result = safeParse(VerdictSchema, value);
      return result.success
        ? { success: true, value: result.output }
        : { success: false, error: new Error("verdict schema mismatch") };
    },
  }
);

/**
 * One provider construction for every caller. The SDK appends
 * `/chat/completions` to baseURL — it wants the API root (`…/v1`) while our
 * config stores the server root, the same value probe() takes; normalize so
 * both share one convention. `supportsStructuredOutputs` must be declared or
 * the provider silently strips `response_format` and the model free-texts.
 */
const TRAILING_SLASHES = /\/+$/;

function providerFor(baseUrl: string, apiKey?: string) {
  const root = baseUrl.replace(TRAILING_SLASHES, "");
  return createOpenAICompatible({
    name: "supervisor",
    baseURL: root.endsWith("/v1") ? root : `${root}/v1`,
    apiKey,
    supportsStructuredOutputs: true,
  });
}

/**
 * One rule's verdict inside a streamed evaluation. `rule` names which rule
 * this element answers; rules cannot ask_operator (that is autopilot's tool),
 * so the space is silent/reply/escalate.
 */
export const RuleVerdictSchema = object({
  rule: string(),
  verdict: union([literal("silent"), literal("reply"), literal("escalate")]),
  message: string(),
  note: string(),
});

export type RuleVerdict = InferOutput<typeof RuleVerdictSchema>;

const RuleVerdictJsonSchema = jsonSchema<RuleVerdict>(
  {
    type: "object",
    properties: {
      rule: { type: "string" },
      verdict: { type: "string", enum: ["silent", "reply", "escalate"] },
      message: { type: "string" },
      note: { type: "string" },
    },
    required: ["rule", "verdict", "message", "note"],
    additionalProperties: false,
  },
  {
    validate: (value) => {
      const result = safeParse(RuleVerdictSchema, value);
      return result.success
        ? { success: true, value: result.output }
        : { success: false, error: new Error("rule verdict schema mismatch") };
    },
  }
);

export interface VerdictStreamRequest {
  apiKey?: string;
  baseUrl: string;
  /** Budget scales with the number of rules; the caller knows how many. */
  maxOutputTokens: number;
  model: string;
  /**
   * Invoked per completed array element AS IT STREAMS — the whole point:
   * the first rule's verdict acts while the model is still writing the rest.
   */
  onVerdict: (verdict: RuleVerdict) => void | Promise<void>;
  system: string;
  timeoutMs: number;
  user: string;
}

export type VerdictStreamResult =
  | { count: number; latencyMs: number; model: string }
  | { count: number; error: string };

/**
 * The streamed, per-rule evaluation: the model emits one verdict object per
 * rule and `elementStream` yields each element the moment it completes.
 * Elements already delivered stay delivered when the stream later fails —
 * the error return carries how many made it out.
 */
export async function verdictStream(
  req: VerdictStreamRequest
): Promise<VerdictStreamResult> {
  const provider = providerFor(req.baseUrl, req.apiKey);
  const t0 = Date.now();
  let count = 0;
  try {
    const result = streamText({
      model: provider(req.model),
      output: Output.array({ element: RuleVerdictJsonSchema }),
      system: req.system,
      prompt: req.user,
      maxOutputTokens: req.maxOutputTokens,
      temperature: 0.2,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(req.timeoutMs),
    });
    for await (const element of result.elementStream) {
      count += 1;
      await req.onVerdict(element);
    }
    // A garbage or truncated stream can END without ever yielding — the SDK
    // reports the parse failure on the output promise, not the iterator.
    // Awaiting it here turns a silent empty stream into a classified error.
    await result.output;
    return { count, latencyMs: Date.now() - t0, model: req.model };
  } catch (err: unknown) {
    return { count, error: classify(err) };
  }
}

// ── verdictFor ──────────────────────────────────────────────────────────

export interface VerdictRequest {
  apiKey?: string;
  baseUrl: string;
  model: string;
  system: string;
  /** The full evaluation budget, including cold-start time (PLAN.md C3: 240 000 ms). */
  timeoutMs: number;
  user: string;
}

export type VerdictResult =
  | { verdict: Verdict; latencyMs: number; model: string }
  | { error: string };

/**
 * One-shot structured verdict from the supervisor LLM.
 *
 * Never throws — every failure (HTTP, timeout, unparseable output) is mapped
 * to a short refusal string in `{error}`, matching the vocabulary the rest of
 * the hub already uses for router failures (telegram-media.ts `refusal()`).
 */
export async function verdictFor(req: VerdictRequest): Promise<VerdictResult> {
  const provider = providerFor(req.baseUrl, req.apiKey);

  const t0 = Date.now();
  try {
    const result = await generateObject({
      model: provider(req.model),
      schema: VerdictJsonSchema,
      system: req.system,
      prompt: req.user,
      maxOutputTokens: 600, // PLAN.md C2: verdicts are short
      temperature: 0.2, // PLAN.md C2: stable verdicts
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(req.timeoutMs),
    });

    return {
      verdict: result.object,
      latencyMs: Date.now() - t0,
      model: req.model,
    };
  } catch (err: unknown) {
    return { error: classify(err) };
  }
}

/**
 * Maps SDK errors to the short refusal strings the hub logs and displays.
 * The status-code vocabulary mirrors telegram-media.ts.
 */
function classify(err: unknown): string {
  // The SDK wraps the real error in RetryError when retries are exhausted.
  const inner = RetryError.isInstance(err) ? (err.lastError ?? err) : err;

  if (APICallError.isInstance(inner)) {
    const code = inner.statusCode;
    if (code === 404) {
      return "unknown model";
    }
    if (code === 507) {
      return "insufficient VRAM";
    }
    if (code === 503) {
      return "cooldown";
    }
  }

  if (NoObjectGeneratedError.isInstance(inner)) {
    return "unparseable verdict";
  }

  // AbortSignal.timeout fires a DOMException with name 'TimeoutError', which
  // the SDK may surface directly or wrap in its own abort reason.
  if (isAbort(err) || isAbort(inner)) {
    return "timed out";
  }

  // Anything else gets the message, truncated.
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 120);
}

function isAbort(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return true;
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    return true;
  }
  if (RetryError.isInstance(err) && err.reason === "abort") {
    return true;
  }
  return false;
}

// ── probe ───────────────────────────────────────────────────────────────

export interface ProbeResult {
  reachable: boolean;
  resolvedModel?: string;
}

interface ModelEntry {
  aliases?: string[];
  id: string;
}

/** Under the router's 255 s socket cap (sourced: telegram-media.ts ROUTER_TIMEOUT_MS). */
const PROBE_TIMEOUT_MS = 15_000;

/**
 * Checks whether the router is reachable and resolves a model handle to the
 * canonical name the router reports.  The router returns aliases alongside
 * the model id — a handle may match either.
 */
export async function probe(
  baseUrl: string,
  handle: string
): Promise<ProbeResult> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { reachable: false };
    }

    const body = (await res.json()) as { data?: ModelEntry[] };
    const models = body.data ?? [];
    const found =
      models.find((m) => m.id === handle) ??
      models.find((m) => m.aliases?.includes(handle));

    return {
      reachable: true,
      resolvedModel: found?.id,
    };
  } catch {
    return { reachable: false };
  }
}
