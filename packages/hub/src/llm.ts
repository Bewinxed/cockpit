import {
  generateObject,
  jsonSchema,
  APICallError,
  NoObjectGeneratedError,
  RetryError,
} from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import * as v from 'valibot';

/**
 * Structured verdict a supervisor LLM returns for a single evaluation.
 *
 * The valibot schema is the source of truth for the shape; the jsonSchema
 * wrapper hands AI SDK the JSON Schema it needs for the provider's
 * structured-output mode while valibot validates the parsed result.
 * (Valibot's Standard Schema does not yet implement toJsonSchema — this
 * is the designed fallback from PLAN.md C2.)
 */
export const VerdictSchema = v.object({
  verdict: v.union([
    v.literal('silent'),
    v.literal('reply'),
    v.literal('escalate'),
    v.literal('ask_operator'),
  ]),
  message: v.string(),
  note: v.string(),
});

export type Verdict = v.InferOutput<typeof VerdictSchema>;

/** JSON Schema for the provider's structured-output / guided-decoding mode. */
const VerdictJsonSchema = jsonSchema<Verdict>(
  {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        enum: ['silent', 'reply', 'escalate', 'ask_operator'],
      },
      message: { type: 'string' },
      note: { type: 'string' },
    },
    required: ['verdict', 'message', 'note'],
    additionalProperties: false,
  },
  {
    validate: (value) => {
      const result = v.safeParse(VerdictSchema, value);
      return result.success
        ? { success: true, value: result.output }
        : { success: false, error: new Error('verdict schema mismatch') };
    },
  },
);

// ── verdictFor ──────────────────────────────────────────────────────────

export interface VerdictRequest {
  baseUrl: string;
  apiKey?: string;
  model: string;
  system: string;
  user: string;
  /** The full evaluation budget, including cold-start time (PLAN.md C3: 240 000 ms). */
  timeoutMs: number;
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
  const provider = createOpenAICompatible({
    name: 'supervisor',
    baseURL: req.baseUrl,
    apiKey: req.apiKey,
  });

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
    if (code === 404) return 'unknown model';
    if (code === 507) return 'insufficient VRAM';
    if (code === 503) return 'cooldown';
  }

  if (NoObjectGeneratedError.isInstance(inner)) return 'unparseable verdict';

  // AbortSignal.timeout fires a DOMException with name 'TimeoutError', which
  // the SDK may surface directly or wrap in its own abort reason.
  if (isAbort(err) || isAbort(inner)) return 'timed out';

  // Anything else gets the message, truncated.
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 120);
}

function isAbort(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'TimeoutError') return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (RetryError.isInstance(err) && err.reason === 'abort') return true;
  return false;
}

// ── probe ───────────────────────────────────────────────────────────────

export interface ProbeResult {
  reachable: boolean;
  resolvedModel?: string;
}

interface ModelEntry {
  id: string;
  aliases?: string[];
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
  handle: string,
): Promise<ProbeResult> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { reachable: false };

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
