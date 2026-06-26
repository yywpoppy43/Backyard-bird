/**
 * A scripted {@link TelemetrySource} for exercising the biometric (V2) path
 * without hardware. Samples are emitted via the injected {@link Clock} at the
 * scripted offsets from {@link start}, so they interleave deterministically with
 * the engine's own timers under a {@link ManualClock}.
 *
 * Each emitted sample's `t` is stamped with the clock time at firing, keeping it
 * on the same timeline the engine uses for monotonicity and recovery math.
 */

import type { Millis } from '../domain/units.ts';
import type { Clock, TimerHandle } from '../ports/clock.ts';
import type { TelemetrySource, BiometricSample } from '../ports/telemetry-source.ts';

export interface ScriptedSample {
  /** Offset from `start()` at which to emit, in ms. */
  atMs: Millis;
  /** The sample to emit (its `t` is overwritten with the firing clock time). */
  sample: Omit<BiometricSample, 't'> & { t?: Millis };
}

export class MockTelemetrySource implements TelemetrySource {
  private started = false;
  private timers: TimerHandle[] = [];
  private readonly clock: Clock;
  private readonly script: ScriptedSample[];

  constructor(clock: Clock, script: ScriptedSample[]) {
    this.clock = clock;
    this.script = script;
  }

  start(onSample: (sample: BiometricSample) => void): void {
    if (this.started) return;
    this.started = true;
    for (const entry of this.script) {
      const handle = this.clock.setTimer(Math.max(0, entry.atMs), () => {
        if (!this.started) return;
        onSample({ ...entry.sample, t: this.clock.now() });
      });
      this.timers.push(handle);
    }
  }

  stop(): void {
    this.started = false;
    for (const handle of this.timers) this.clock.clearTimer(handle);
    this.timers = [];
  }
}

/**
 * Helper: build a steady stream of `count` samples spaced `everyMs` apart,
 * transformed by `shape(i)` → partial sample. Useful for baselines + spikes.
 */
export function buildSampleStream(
  count: number,
  everyMs: Millis,
  shape: (index: number) => Omit<BiometricSample, 't'>,
): ScriptedSample[] {
  const out: ScriptedSample[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ atMs: i * everyMs, sample: shape(i) });
  }
  return out;
}
