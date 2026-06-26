/** Production {@link Clock} over `Date.now` + `setTimeout`/`clearTimeout`. */

import type { Millis } from '../domain/units.ts';
import type { Clock, TimerHandle } from '../ports/clock.ts';

export class SystemClock implements Clock {
  private nextId = 1;
  private readonly handles = new Map<number, ReturnType<typeof setTimeout>>();

  now(): Millis {
    return Date.now();
  }

  setTimer(delayMs: Millis, cb: () => void): TimerHandle {
    const id = this.nextId++;
    const handle = setTimeout(() => {
      this.handles.delete(id);
      cb();
    }, Math.max(0, delayMs));
    // Do not keep the event loop alive solely for a pending cue timer.
    if (typeof handle === 'object' && handle !== null && 'unref' in handle) {
      (handle as { unref: () => void }).unref();
    }
    this.handles.set(id, handle);
    return { id };
  }

  clearTimer(handle: TimerHandle): void {
    const t = this.handles.get(handle.id);
    if (t !== undefined) {
      clearTimeout(t);
      this.handles.delete(handle.id);
    }
  }
}
