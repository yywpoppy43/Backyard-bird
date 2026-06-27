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
 *   - returns `null` after `maxAttempts` rather than ever speaking a leaky cue.
 *
 * To use OpenAI (or any other provider) instead, implement {@link CueGenerator}
 * the same way against that API — the engine depends only on the port.
 */

import type { Cue } from '../domain/cue.ts';
import { isCue } from '../domain/cue.ts';
import type { CueGenerator, CueGenerationRequest } from '../ports/cue-generator.ts';
import { GENERATIVE_SYSTEM_PROMPT } from './system-prompt.ts';
import { findForbiddenVocabulary } from './output-vocabulary.ts';

/** Minimal shape of the `fetch` function (so it can be injected in tests). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

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
  /** API base URL. */
  baseUrl?: string;
  /** anthropic-version header. */
  anthropicVersion?: string;
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: FetchLike;
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
  private readonly baseUrl: string;
  private readonly anthropicVersion: string;
  private readonly fetchImpl: FetchLike;
  private counter = 0;

  constructor(options: AnthropicCueGeneratorOptions = {}) {
    this.apiKey = options.apiKey ?? readEnv('ANTHROPIC_API_KEY') ?? '';
    this.model = options.model ?? DEFAULT_GENERATOR_MODEL;
    this.temperature = options.temperature === undefined ? 0.4 : options.temperature;
    this.maxTokens = options.maxTokens ?? 400;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
    this.anthropicVersion = options.anthropicVersion ?? '2023-06-01';
    const f = options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!f) throw new Error('AnthropicCueGenerator: no fetch implementation available');
    this.fetchImpl = f;
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

  async generate(request: CueGenerationRequest, signal?: AbortSignal): Promise<Cue | null> {
    const body = this.buildRequestBody(request);
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.anthropicVersion,
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
      }
      const json = await res.json();
      const cue = this.toCue(parseToolInput(json), request);
      if (cue && findForbiddenVocabulary(cue.AudioTranscript).length === 0) {
        return cue;
      }
      // Otherwise: malformed or leaked internal vocabulary — try again.
    }
    return null;
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
