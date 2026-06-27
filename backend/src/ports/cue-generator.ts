/**
 * Generative cue seam (PRD Phase 2).
 *
 * When the static {@link CueSelector} has no suitable cue for the current state,
 * the engine falls back to a {@link CueGenerator} — an LLM, strictly bounded by
 * the system prompt, that produces one precise somatic cue. This port keeps the
 * engine independent of any specific provider; the default implementation is
 * {@link AnthropicCueGenerator}. Generation is async (a network call), which is
 * why this is a separate seam from the synchronous {@link CueSelector}.
 */

import type { Cue } from '../domain/cue.ts';
import type { FrictionState } from '../domain/friction-state.ts';
import type { FrictionCondition } from '../domain/friction-condition.ts';
import type { TriggerSource } from '../triggers/trigger.ts';

export interface CueGenerationRequest {
  /** The state to generate a cue for. The generated cue's PrimaryState matches it. */
  state: FrictionState;
  /** Why a cue is being fired (a trigger, or a proactive lifecycle cue). */
  source: TriggerSource | 'INIT';
  /** Current intensity in [0,1]. */
  intensity: number;
  round: number;
  /** Optional finer friction classification to target (PRD typology addition). */
  frictionCondition?: FrictionCondition;
}

/**
 * The result of a generation attempt. Always returned (generation never throws
 * to the engine) so the whole path is observable for tuning: how often it
 * succeeds, regenerates on a vocabulary leak, or fails over the network.
 */
export interface GenerationOutcome {
  /** The generated cue, or `null` when no usable cue could be produced. */
  cue: Cue | null;
  /**
   * Coarse outcome:
   *   - `ok`       — a clean, speakable cue was produced.
   *   - `rejected` — the model responded but no attempt yielded a usable cue
   *                  (output malformed, or it leaked forbidden vocabulary every
   *                  time). A content failure: tighten the prompt.
   *   - `error`    — the API call could not complete (network error or a
   *                  non-2xx response) after exhausting retries. A transport
   *                  failure: the network/API was flaky.
   */
  status: 'ok' | 'rejected' | 'error';
  /** Total model attempts made (a regeneration on a vocabulary leak counts here). */
  attempts: number;
  /** Total network retries spent on transient errors (back-off retries). */
  networkRetries: number;
  /** Human-readable detail when `status` is not `ok` (surfaced to logs for tuning). */
  reason?: string;
}

export interface CueGenerator {
  /**
   * Generate one cue for the moment. Returns a {@link GenerationOutcome} rather
   * than throwing: transient network failures are retried with back-off, and a
   * persistent failure is reported as `status: 'error'` with `cue: null` so the
   * engine can fall back to a static cue instead of going quiet. A cue is only
   * ever returned once it satisfies the spoken-vocabulary constraint. Must
   * honour `signal` for cancellation.
   */
  generate(request: CueGenerationRequest, signal?: AbortSignal): Promise<GenerationOutcome>;
}
