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

export interface CueGenerator {
  /**
   * Generate one cue for the moment, or `null` if generation fails or the output
   * cannot be made to satisfy the spoken-vocabulary constraint. Must honour
   * `signal` for cancellation.
   */
  generate(request: CueGenerationRequest, signal?: AbortSignal): Promise<Cue | null>;
}
