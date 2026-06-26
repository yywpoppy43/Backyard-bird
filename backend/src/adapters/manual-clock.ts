/**
 * Test {@link Clock} with virtual time. The linchpin of deterministic testing:
 * nothing happens until {@link advance} (or {@link runAll}) is called, and timers
 * fire in strict chronological order — including timers scheduled by other timers.
 */

import type { Millis } from '../domain/units.ts';
import type { Clock, TimerHandle } from '../ports/clock.ts';

interface ScheduledTimer {
  id: number;
  fireAt: Millis;
  /** Insertion order, for stable tie-breaking among equal `fireAt`. */
  seq: number;
  cb: () => void;
}

export class ManualClock implements Clock {
  private current: Millis;
  private nextId = 1;
  private seq = 0;
  private queue: ScheduledTimer[] = [];

  constructor(start: Millis = 0) {
    this.current = start;
  }

  now(): Millis {
    return this.current;
  }

  setTimer(delayMs: Millis, cb: () => void): TimerHandle {
    const id = this.nextId++;
    this.queue.push({ id, fireAt: this.current + Math.max(0, delayMs), seq: this.seq++, cb });
    return { id };
  }

  clearTimer(handle: TimerHandle): void {
    this.queue = this.queue.filter((t) => t.id !== handle.id);
  }

  /** Number of timers still pending. */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Advance virtual time by `ms`, firing every timer due at or before the new
   * time in chronological (then insertion) order. Timers scheduled during a
   * callback are honoured if they also fall within the window.
   */
  advance(ms: Millis): void {
    const target = this.current + ms;
    for (;;) {
      const next = this.earliestDueBy(target);
      if (next === null) break;
      this.queue = this.queue.filter((t) => t !== next);
      this.current = next.fireAt;
      next.cb();
    }
    this.current = target;
  }

  /** Fire all pending timers regardless of delay (chronological order). */
  runAll(maxSteps = 100_000): void {
    let steps = 0;
    for (;;) {
      const next = this.earliestDueBy(Infinity);
      if (next === null) break;
      if (steps++ >= maxSteps) {
        throw new Error('ManualClock.runAll exceeded maxSteps (possible timer loop)');
      }
      this.queue = this.queue.filter((t) => t !== next);
      this.current = next.fireAt;
      next.cb();
    }
  }

  private earliestDueBy(target: Millis): ScheduledTimer | null {
    let best: ScheduledTimer | null = null;
    for (const t of this.queue) {
      if (t.fireAt > target) continue;
      if (best === null || t.fireAt < best.fireAt || (t.fireAt === best.fireAt && t.seq < best.seq)) {
        best = t;
      }
    }
    return best;
  }
}
