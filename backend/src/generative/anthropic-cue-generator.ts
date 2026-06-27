/**
 * Anthropic-backed {@link CueGenerator}.
 *
 * Calls the Messages API (`POST /v1/messages`) over `fetch` — no SDK dependency,
 * preserving the framework's zero-runtime-deps property. It:
 *   - sets the YAML {@link GENERATIVE_SYSTEM_PROMPT} as the strict system prompt,
 *   - forces a single structured cue out via tool use (`tool_choice`),
 *   - sets the generated cue's PrimaryState from the request (never trusts the
 *     model to pick the state),
 *   - re-checks the spoken transcript with {@link findForbiddenVocabulary} and
 *     regenerates if any internal vocabulary leaks (the code-level "double seal"),
 *   - retries transient network/API failures with exponential back-off, and
 *   - never throws: it returns a {@link GenerationOutcome} describing what
 *     happened (ok / rejected / error, with attempt + retry counts) so the engine
 *     can fall back to a static cue rather than ever speaking a leaky cue or
 *     going quiet at a tipping point.
 *
 * To use OpenAI (or any other provider) instead, implement {@link CueGenerator}
 * the same way against that API — the engine depends only on the port.
 */

import type { Cue } from '../domain/cue.ts';
import { isCue } from '../domain/cue.ts';
import type { CueGenerator, CueGenerationRequest, GenerationOutcome } from '../ports/cue-generator.ts';
import { GENERATIVE_SYSTEM_PROMPT } from './system-prompt.ts';
import { findForbiddenVocabulary } from './output-vocabulary.ts';

/** Minimal shape of the `fetch` function (so it can be injected in tests). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

/** Injectable delay (so tests run instantly and deterministically). */
export type SleepLike = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Transient HTTP statuses worth retrying (timeouts, rate limits, 5xx). */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

/** True for the DOMException/Error fetch raises when an AbortSignal fires. */
function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/** Default sleep: a cancellable timer. Resolves (does not reject) on abort so the
 *  caller's loop re-checks the signal and exits cleanly. */
const defaultSleep: SleepLike = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** The outcome of a single transport call (one or more network tries). */
type CallResult =
  | { status: 'ok'; json: unknown; networkRetries: number }
  | { status: 'error'; reason: string; networkRetries: number }
  | { status: 'aborted'; networkRetries: number };

export interface AnthropicCueGeneratorOptions {
  /** API key. Defaults to `process.env.ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** Model id. Defaults to the lowest-latency tier for real-time cueing. */
  model?: string;
  /** Sampling temperature (low keeps output on-matrix). Omitted for models that
   *  reject sampling params (Opus 4.7+/Fable). Set null to always omit. */
  temperature?: number | null;
  /** Max output tokens. A cue is short. */
  maxTokens?: number;
  /** Regeneration attempts if a transcript leaks forbidden vocabulary. */
  maxAttempts?: number;
  /** Network retries per attempt on transient errors. Defaults to 2 ("a couple"). */
  maxNetworkRetries?: number;
  /** Base back-off delay in ms; doubles each retry (250 → 500 → …). */
  backoffBaseMs?: number;
  /** Ceiling for the back-off delay in ms. */
  backoffMaxMs?: number;
  /** API base URL. */
  baseUrl?: string;
  /** anthropic-version header. */
  anthropicVersion?: string;
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: FetchLike;
  /** Injectable sleep (defaults to a cancellable setTimeout). */
  sleepImpl?: SleepLike;
}

/** The lowest-latency model — generation must fire near the friction moment. */
export const DEFAULT_GENERATOR_MODEL = 'claude-haiku-4-5';

const CUE_TOOL_NAME = 'emit_cue';

/** Models that reject `temperature`/sampling params (would 400 if sent). */
function modelRejectsSampling(model: string): boolean {
  return /opus-4-(7|8|9)|fable|mythos/i.test(model);
}

export class AnthropicCueGenerator implements CueGenerator {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature: number | null;
  private readonly maxTokens: number;
  private readonly maxAttempts: number;
  private readonly maxNetworkRetries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly baseUrl: string;
  private readonly anthropicVersion: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: SleepLike;
  private counter = 0;

  constructor(options: AnthropicCueGeneratorOptions = {}) {
    this.apiKey = options.apiKey ?? readEnv('ANTHROPIC_API_KEY') ?? '';
    this.model = options.model ?? DEFAULT_GENERATOR_MODEL;
    this.temperature = options.temperature === undefined ? 0.4 : options.temperature;
    this.maxTokens = options.maxTokens ?? 400;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    this.maxNetworkRetries = Math.max(0, options.maxNetworkRetries ?? 2);
    this.backoffBaseMs = Math.max(0, options.backoffBaseMs ?? 250);
    this.backoffMaxMs = Math.max(this.backoffBaseMs, options.backoffMaxMs ?? 2000);
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
    this.anthropicVersion = options.anthropicVersion ?? '2023-06-01';
    const f = options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!f) throw new Error('AnthropicCueGenerator: no fetch implementation available');
    this.fetchImpl = f;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
  }

  /** Build the Messages API request body. Pure — unit-testable without network. */
  buildRequestBody(request: CueGenerationRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: GENERATIVE_SYSTEM_PROMPT,
      tools: [
        {
          name: CUE_TOOL_NAME,
          description:
            'Emit exactly one somatic cue for the current moment. The AudioTranscript is ' +
            'the spoken line and must be plain somatic language only.',
          input_schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              PhysicalLever: { type: 'string', description: 'One concrete physical command the body can do now.' },
              EnergeticVector: { type: 'string', description: 'The breath/energy dimension addressed.' },
              StructuralYield: { type: 'string', description: 'The capacity/reframe the friction builds.' },
              AudioTranscript: {
                type: 'string',
                description:
                  'The exact spoken line: plain somatic language only ("you", "your breath", ' +
                  '"stay", "drop"…). 1-3 short sentences, under 8 seconds. Structure: state ' +
                  'acknowledgment -> physical command -> reframe. Never use internal/framework words.',
              },
              DeliveryTone: { type: 'string', description: 'Delivery tone, e.g. "Sharp, commanding".' },
            },
            required: ['PhysicalLever', 'EnergeticVector', 'StructuralYield', 'AudioTranscript', 'DeliveryTone'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: CUE_TOOL_NAME },
      messages: [{ role: 'user', content: this.buildUserMessage(request) }],
    };
    if (this.temperature !== null && !modelRejectsSampling(this.model)) {
      body['temperature'] = this.temperature;
    }
    return body;
  }

  private buildUserMessage(request: CueGenerationRequest): string {
    const condition =
      request.frictionCondition ?? 'unspecified — infer the single most likely condition from the state';
    return (
      `STATE: ${request.state}\n` +
      `FRICTION CONDITION: ${condition}\n` +
      `INTENSITY: ${request.intensity.toFixed(2)} (0 = easy, 1 = redline)\n` +
      `ROUND: ${request.round}\n\n` +
      'Generate one cue for this exact moment and return it via the emit_cue tool. ' +
      'Speak only plain somatic language — no internal or framework words.'
    );
  }

  async generate(request: CueGenerationRequest, signal?: AbortSignal): Promise<GenerationOutcome> {
    const body = this.buildRequestBody(request);
    let attempts = 0;
    let networkRetries = 0;
    let lastReason = 'no usable cue produced';

    // Outer loop: regenerate if the model leaks forbidden vocabulary or returns
    // a malformed cue. (A transient *network* failure is handled inside
    // callWithBackoff, below, and never burns a regeneration attempt.)
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      attempts += 1;
      const call = await this.callWithBackoff(body, signal);
      networkRetries += call.networkRetries;

      if (call.status === 'aborted') {
        return { cue: null, status: 'error', attempts, networkRetries, reason: 'aborted' };
      }
      if (call.status === 'error') {
        // Transport failure persisted through retries — terminal for this cue.
        return { cue: null, status: 'error', attempts, networkRetries, reason: call.reason };
      }

      const cue = this.toCue(parseToolInput(call.json), request);
      if (!cue) {
        lastReason = 'malformed model output';
        continue;
      }
      const leaked = findForbiddenVocabulary(cue.AudioTranscript);
      if (leaked.length === 0) {
        return { cue, status: 'ok', attempts, networkRetries };
      }
      lastReason = `forbidden vocabulary: ${leaked.join(', ')}`;
      // Leaked internal vocabulary — never speak it; regenerate.
    }

    // The model responded but no attempt produced a clean cue: a content failure.
    return { cue: null, status: 'rejected', attempts, networkRetries, reason: lastReason };
  }

  /**
   * One logical API call, retrying transient transport failures (network errors
   * and 408/425/429/5xx) with exponential back-off. Back-off is jitter-free to
   * keep behaviour deterministic, and `Retry-After` is intentionally not honoured
   * — a tipping-point cue is real-time, so we bound latency over politeness.
   */
  private async callWithBackoff(body: Record<string, unknown>, signal?: AbortSignal): Promise<CallResult> {
    let networkRetries = 0;
    for (let i = 0; ; i++) {
      if (signal?.aborted) return { status: 'aborted', networkRetries };

      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': this.anthropicVersion,
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        // fetch threw: a network-level failure (DNS, reset, timeout) or an abort.
        if (isAbortError(err) || signal?.aborted) return { status: 'aborted', networkRetries };
        if (i < this.maxNetworkRetries) {
          networkRetries += 1;
          await this.sleepImpl(this.backoffDelay(i), signal);
          continue;
        }
        return {
          status: 'error',
          reason: `network error: ${err instanceof Error ? err.message : String(err)}`,
          networkRetries,
        };
      }

      if (res.ok) {
        try {
          return { status: 'ok', json: await res.json(), networkRetries };
        } catch (err) {
          return {
            status: 'error',
            reason: `unparseable response body: ${err instanceof Error ? err.message : String(err)}`,
            networkRetries,
          };
        }
      }

      // Non-2xx. Retry only transient statuses; otherwise surface the error.
      if (isRetryableStatus(res.status) && i < this.maxNetworkRetries) {
        networkRetries += 1;
        await this.sleepImpl(this.backoffDelay(i), signal);
        continue;
      }
      return {
        status: 'error',
        reason: `Anthropic API error ${res.status}: ${await res.text()}`,
        networkRetries,
      };
    }
  }

  /** Exponential back-off, capped. `retryIndex` is 0-based (0 → base, 1 → 2×base…). */
  private backoffDelay(retryIndex: number): number {
    return Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** retryIndex);
  }

  /** Assemble a validated Cue from the model's tool input, or null if malformed. */
  private toCue(input: Record<string, unknown> | null, request: CueGenerationRequest): Cue | null {
    if (input === null) return null;
    const candidate = {
      CueID: `gen-${request.state.toLowerCase()}-${++this.counter}`,
      PrimaryState: request.state, // authoritative — never trust the model to pick state
      PhysicalLever: input['PhysicalLever'],
      EnergeticVector: input['EnergeticVector'],
      StructuralYield: input['StructuralYield'],
      AudioTranscript: input['AudioTranscript'],
      DeliveryTone: input['DeliveryTone'],
    };
    return isCue(candidate) ? candidate : null;
  }
}

/** Extract the forced tool-use input from a Messages API response. Pure. */
export function parseToolInput(json: unknown): Record<string, unknown> | null {
  if (typeof json !== 'object' || json === null) return null;
  const content = (json as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'tool_use' &&
      (block as { name?: unknown }).name === CUE_TOOL_NAME
    ) {
      const input = (block as { input?: unknown }).input;
      if (typeof input === 'object' && input !== null) return input as Record<string, unknown>;
    }
  }
  return null;
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}
