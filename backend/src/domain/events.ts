/**
 * The EngineEvent stream — the single integration contract for any consumer
 * (future UI, mobile client, logger, analytics). The backend is headless: it
 * never renders anything, it only emits these typed events over an
 * {@link EventBus}. A client subscribes and reacts.
 *
 * Every event carries `at` (clock ms). State-scoped events also carry `round`.
 */

import type { Millis, Unit } from './units.ts';
import type { FrictionState } from './friction-state.ts';
import type { Cue } from './cue.ts';
import type { SessionConfig } from './session.ts';
import type { TriggerSource } from '../triggers/trigger.ts';
import type { FrictionCondition } from './friction-condition.ts';
import type { TtsResult } from '../ports/tts.ts';

export type EngineEvent =
  /** Session began; BASELINE anchor is about to fire. */
  | { type: 'SESSION_STARTED'; config: SessionConfig; at: Millis }
  /** A Friction State Machine transition occurred. */
  | { type: 'STATE_CHANGED'; from: FrictionState; to: FrictionState; cause: string; round: number; at: Millis }
  /** A tipping point was detected (PRD §5 "Intervene"). */
  | {
      type: 'TIPPING_POINT';
      source: TriggerSource;
      intensity: Unit;
      reason: string;
      frictionCondition?: FrictionCondition;
      round: number;
      at: Millis;
    }
  /** A cue was selected for the current state. `origin` records where it came
   *  from: the static Cue Bank (`database`), the LLM (`generated`), or the
   *  hand-authored last-resort `fallback` used when neither could supply one. */
  | {
      type: 'CUE_SELECTED';
      cue: Cue;
      state: FrictionState;
      origin: 'database' | 'generated' | 'fallback';
      round: number;
      at: Millis;
    }
  /** A generative attempt completed (the LLM fallback path). Emitted whenever the
   *  engine asked the generator for a cue, whatever the result — so a consumer
   *  can measure how often generation succeeds, regenerates (see `attempts`),
   *  retries the network (see `networkRetries`), or fails (`status`). This is the
   *  observability hook for tuning the generative layer. */
  | {
      type: 'CUE_GENERATION';
      state: FrictionState;
      status: 'ok' | 'rejected' | 'error';
      /** Total model attempts (a regeneration on a vocabulary leak counts here). */
      attempts: number;
      /** Network retries spent on transient errors during this generation. */
      networkRetries: number;
      /** Reason when `status` is not `ok`. */
      reason?: string;
      round: number;
      at: Millis;
    }
  /** A cue finished transmitting via TTS (PRD §5 "Transmit"). */
  | { type: 'CUE_SPOKEN'; cueId: string; result: TtsResult; round: number; at: Millis }
  /** Recalibration resolved (PRD §5 "Recalibrate"). `stabilized` distinguishes
   *  the GROWTH path from a DESTABILIZED re-cue. `metric` is the recovery signal
   *  observed (e.g. HR), or null in the time-only V1 path. */
  | { type: 'RECALIBRATED'; stabilized: boolean; metric: number | null; round: number; at: Millis }
  /** The push was sustained; the round is complete and GROWTH was demanded. */
  | { type: 'ROUND_CLEARED'; round: number; at: Millis }
  /** The Engine redlined further during the intervention; re-cueing harder. */
  | { type: 'DESTABILIZED'; round: number; attempt: number; at: Millis }
  /** The session ended (length elapsed, stopped, or unrecoverable error). */
  | { type: 'SESSION_ENDED'; reason: 'completed' | 'stopped' | 'error'; rounds: number; at: Millis }
  /** A recoverable or unrecoverable error occurred; the engine self-heals when
   *  `recoverable` is true. */
  | { type: 'ERROR'; scope: string; message: string; recoverable: boolean; at: Millis };

/** Discriminant union of all event type tags. */
export type EngineEventType = EngineEvent['type'];
