/**
 * Clock port.
 *
 * Every piece of timing in the framework — temporal tipping points, biometric
 * refractory windows, recalibration grace periods, inter-round cooldowns and the
 * session-length deadline — flows through this seam. Nothing calls `Date.now`,
 * `setTimeout` or `setInterval` directly. That makes the entire engine
 * deterministically testable by swapping the real clock for a virtual one.
 *
 * @see SystemClock — production adapter over `Date.now` + `setTimeout`.
 * @see ManualClock — test adapter that advances virtual time on demand.
 */

import type { Millis } from '../domain/units.ts';

/** Opaque handle to a scheduled timer, returned by {@link Clock.setTimer}. */
export interface TimerHandle {
  readonly id: number;
}

export interface Clock {
  /** Current time in milliseconds. */
  now(): Millis;
  /**
   * Schedule `cb` to run once after `delayMs`. A non-positive delay still fires
   * asynchronously on the next tick (or next {@link ManualClock.advance}).
   */
  setTimer(delayMs: Millis, cb: () => void): TimerHandle;
  /** Cancel a previously scheduled timer. No-op if already fired or cleared. */
  clearTimer(handle: TimerHandle): void;
}
