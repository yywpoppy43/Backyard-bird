/**
 * Temporal Friction Mapping — PRD §4 V1.
 *
 * "The user inputs the expected length and intensity curve of the session. The
 * system calculates the highest probability 'tipping points' (e.g. Minute 18 of
 * a 20-minute intense hold) and schedules ENCOUNTER cues for those exact
 * timestamps."
 *
 * Tipping points are the upward threshold crossings of the intensity curve, plus
 * a canonical late-session "end wall" so even a monotone hold always intervenes
 * at least once. {@link computeTippingPoints} is pure and unit-tested in
 * isolation; the class layer schedules them through the injected {@link Clock}.
 */

import type { Millis, Unit } from '../domain/units.ts';
import type { Clock, TimerHandle } from '../ports/clock.ts';
import type { PersonalizationProfile } from '../domain/personalization.ts';
import {
  intensityAt,
  DEFAULT_DIFFICULTY_THRESHOLDS,
  DEFAULT_END_WALL_PROGRESS,
  type SessionConfig,
} from '../domain/session.ts';
import {
  TriggerSource,
  type Trigger,
  type TriggerArmContext,
  type TriggerSignal,
} from './trigger.ts';

export interface TipPoint {
  /** Offset from session start, in ms. */
  atMs: Millis;
  /** The crossed intensity threshold (or curve value at the end wall). */
  intensity: Unit;
  /** Why this tip exists, e.g. "crossing@0.75" or "wall@0.85". */
  reason: string;
}

/**
 * Trigger-timing seam (the deep hook). A planner can either NUDGE the default
 * tips (call `computeDefault()` then shift/add/remove) or FEED the computation
 * itself from the profile (ignore `computeDefault` and return its own tips) —
 * both without any engine change.
 */
export type TippingPlanner = (
  input: { config: SessionConfig; profile: PersonalizationProfile | undefined },
  computeDefault: () => TipPoint[],
) => TipPoint[];

/** Optional personalization of tipping-point computation. */
export interface TippingPersonalization {
  /** Opaque user profile forwarded to the planner. */
  profile?: PersonalizationProfile;
  /** Strategy that shapes the tips. If absent, timing is exactly V1. */
  planner?: TippingPlanner;
}

const WALK_STEPS = 1000;
/** Hysteresis: a threshold re-arms once intensity falls this far back below it. */
const REARM_HYSTERESIS = 0.02;
/** Dedup window for the end wall, as a fraction of session length. */
const WALL_DEDUP_FRACTION = 0.03;

/**
 * Compute the ordered tipping points for a session.
 *
 * With no `personalization` (or no `planner`), this returns exactly the V1
 * timing. When a planner is supplied it drives the result, receiving the opaque
 * profile plus a `computeDefault` thunk so it can nudge or fully replace the
 * default tips. The default computation itself remains pure (no clock, no I/O).
 */
export function computeTippingPoints(
  config: SessionConfig,
  personalization?: TippingPersonalization,
): TipPoint[] {
  const computeDefault = (): TipPoint[] => computeDefaultTippingPoints(config);
  const planner = personalization?.planner;
  if (!planner) return computeDefault();
  return planner({ config, profile: personalization?.profile }, computeDefault);
}

/**
 * The default tipping-point computation. Pure: no clock, no I/O.
 *
 * Walks the curve at 0.1%-progress resolution detecting upward crossings of each
 * difficulty threshold (re-arming after the curve dips, so interval curves yield
 * one tip per hump), then injects the end-wall tip unless a crossing already sits
 * within {@link WALL_DEDUP_FRACTION} of it.
 */
function computeDefaultTippingPoints(config: SessionConfig): TipPoint[] {
  const { lengthMs, curve } = config;
  const thresholds = [...(config.difficultyThresholds ?? DEFAULT_DIFFICULTY_THRESHOLDS)].sort(
    (a, b) => a - b,
  );
  const endWall = config.endWallProgress ?? DEFAULT_END_WALL_PROGRESS;

  const tips: TipPoint[] = [];
  const armed = thresholds.map(() => true);
  let prev = intensityAt(curve, 0);

  for (let step = 1; step <= WALK_STEPS; step++) {
    const p = step / WALK_STEPS;
    const cur = intensityAt(curve, p);
    for (let i = 0; i < thresholds.length; i++) {
      const threshold = thresholds[i]!;
      if (armed[i] && prev < threshold && cur >= threshold) {
        tips.push({
          atMs: Math.round(p * lengthMs),
          intensity: threshold,
          reason: `crossing@${threshold}`,
        });
        armed[i] = false;
      } else if (!armed[i] && cur < threshold - REARM_HYSTERESIS) {
        armed[i] = true;
      }
    }
    prev = cur;
  }

  // Canonical late-session "end wall".
  const wallAtMs = Math.round(endWall * lengthMs);
  const dedupWindow = lengthMs * WALL_DEDUP_FRACTION;
  const hasNearbyTip = tips.some((t) => Math.abs(t.atMs - wallAtMs) <= dedupWindow);
  if (!hasNearbyTip) {
    tips.push({ atMs: wallAtMs, intensity: intensityAt(curve, endWall), reason: `wall@${endWall}` });
  }

  tips.sort((a, b) => a.atMs - b.atMs);
  return tips;
}

export class TemporalTrigger implements Trigger {
  readonly source = TriggerSource.TEMPORAL;

  private handler: ((signal: TriggerSignal) => void) | null = null;
  private tips: TipPoint[] = [];
  private cursor = 0;
  private armed = false;
  private timers: TimerHandle[] = [];
  private readonly clock: Clock;
  private readonly personalization: TippingPersonalization | undefined;

  constructor(clock: Clock, personalization?: TippingPersonalization) {
    this.clock = clock;
    this.personalization = personalization;
  }

  onTip(handler: (signal: TriggerSignal) => void): void {
    this.handler = handler;
  }

  arm(ctx: TriggerArmContext): void {
    this.disarm();
    this.armed = true;
    if (this.tips.length === 0) {
      this.tips = computeTippingPoints(ctx.config, this.personalization);
    }
    if (this.cursor >= this.tips.length) return; // all temporal tips consumed

    const elapsed = this.clock.now() - ctx.sessionStartedAt;
    const tip = this.tips[this.cursor]!;
    const delay = Math.max(0, tip.atMs - elapsed);
    this.timers = [this.clock.setTimer(delay, () => this.fire())];
  }

  disarm(): void {
    for (const handle of this.timers) this.clock.clearTimer(handle);
    this.timers = [];
    this.armed = false;
  }

  reset(): void {
    this.disarm();
    this.tips = [];
    this.cursor = 0;
  }

  /** Total tipping points planned for the session (after the first arm). */
  get plannedTips(): readonly TipPoint[] {
    return this.tips;
  }

  private fire(): void {
    if (!this.armed) return;
    const tip = this.tips[this.cursor];
    if (!tip) return;
    this.cursor += 1;
    this.armed = false;
    this.timers = [];
    this.handler?.({
      source: TriggerSource.TEMPORAL,
      intensity: tip.intensity,
      reason: tip.reason,
      at: this.clock.now(),
    });
  }
}
