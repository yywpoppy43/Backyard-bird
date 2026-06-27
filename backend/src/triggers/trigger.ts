/**
 * Trigger Listener layer — PRD §4 "The Delivery Mechanism: Trigger Logic".
 *
 * "To replicate the 'active meditation' delivery, the system must know when to
 * speak. The coding agent must implement a trigger listener."
 *
 * Both PRD trigger modalities implement this one interface, so the engine treats
 * them uniformly:
 *   - {@link TemporalTrigger}  — V1 Temporal Friction Mapping
 *   - {@link BiometricTrigger} — V2 Biometric Telemetry hook
 *
 * A trigger is *armed* during the INTENTION (silent monitoring) phase and
 * *disarmed* the instant a tipping point is detected (first-tip-wins), then
 * re-armed for the next round.
 */

import type { Millis, Unit } from '../domain/units.ts';
import type { SessionConfig } from '../domain/session.ts';
import type { FrictionCondition } from '../domain/friction-condition.ts';

export const TriggerSource = {
  TEMPORAL: 'TEMPORAL',
  BIOMETRIC: 'BIOMETRIC',
} as const;

export type TriggerSource = (typeof TriggerSource)[keyof typeof TriggerSource];

/** Emitted by a trigger when a tipping point is detected. */
export interface TriggerSignal {
  source: TriggerSource;
  /** How far past threshold the tipping point is, normalised to [0,1]. */
  intensity: Unit;
  /** Human-readable cause, e.g. "wall@0.85" or "HR_SPIKE". */
  reason: string;
  /** Optional finer friction classification (PRD typology addition). */
  frictionCondition?: FrictionCondition;
  /** When it fired (clock ms). */
  at: Millis;
}

/** Context handed to a trigger each time it is armed for a round. */
export interface TriggerArmContext {
  round: number;
  /** Absolute clock time at which the session started. */
  sessionStartedAt: Millis;
  config: SessionConfig;
}

export interface Trigger {
  readonly source: TriggerSource;
  /** Begin watching for this round. */
  arm(ctx: TriggerArmContext): void;
  /** Stop watching (clears any pending timers). */
  disarm(): void;
  /** Register the tipping-point callback. The engine sets this once. */
  onTip(handler: (signal: TriggerSignal) => void): void;
  /** Reset all internal state for a brand-new session. */
  reset(): void;
}
