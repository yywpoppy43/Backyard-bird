/**
 * Biometric Telemetry trigger — PRD §4 V2 ("API Hook").
 *
 * "The system ingests real-time external data (e.g. heart rate spikes or Heart
 * Rate Variability drops indicating systemic stress) to dynamically trigger a
 * Stage III intervention precisely when the physical Engine redlines."
 *
 * Robustness comes from four layers:
 *   - warmup    — never fire before a resting baseline is established
 *   - baseline  — rolling EWMA, frozen during a breach so a sustained-high
 *                 stretch can't drag the baseline up and mask a real spike
 *   - debounce  — N consecutive breaching samples required (kills sensor glitches)
 *   - refractory— minimum gap between tips
 *
 * Samples are pushed in via {@link ingest} (the engine forwards every reading so
 * the baseline stays warm across states); the trigger only *fires* while armed.
 */

import type { Millis, Unit } from '../domain/units.ts';
import { clamp01 } from '../domain/units.ts';
import type { Clock } from '../ports/clock.ts';
import type { BiometricSample } from '../ports/telemetry-source.ts';
import type { EngineTuning } from '../domain/session.ts';
import { FrictionCondition } from '../domain/friction-condition.ts';
import {
  TriggerSource,
  type Trigger,
  type TriggerArmContext,
  type TriggerSignal,
} from './trigger.ts';

/** Outcome of ingesting a sample (useful for tests/telemetry). */
export interface IngestResult {
  fired: boolean;
  /** Whether the sample was rejected (low quality / out of order). */
  rejected: boolean;
  reason?: string;
}

/**
 * A {@link Trigger} that is also fed raw samples via {@link ingest}. This is the
 * seam for live-biometric-reactive behaviour: the engine forwards every sample
 * to `ingest` and the trigger decides when to fire. A future personalization
 * layer can supply its own `BiometricListener` (e.g. one whose thresholds adapt
 * to a profile and live signal) by composition — the engine depends on this
 * interface, not the concrete {@link BiometricTrigger}, so no engine change is
 * needed.
 */
export interface BiometricListener extends Trigger {
  ingest(sample: BiometricSample): IngestResult;
}

export class BiometricTrigger implements BiometricListener {
  readonly source = TriggerSource.BIOMETRIC;

  private handler: ((signal: TriggerSignal) => void) | null = null;
  private armed = false;

  private window: BiometricSample[] = [];
  private hrBaseline: number | null = null;
  private hrvBaseline: number | null = null;
  private breachStreak = 0;
  private lastTipAt: Millis | null = null;
  private lastSampleT = -Infinity;
  private readonly clock: Clock;
  private readonly tuning: EngineTuning;

  constructor(clock: Clock, tuning: EngineTuning) {
    this.clock = clock;
    this.tuning = tuning;
  }

  onTip(handler: (signal: TriggerSignal) => void): void {
    this.handler = handler;
  }

  arm(_ctx: TriggerArmContext): void {
    this.armed = true;
    // Fresh debounce + refractory per round; keep the baseline warm.
    this.breachStreak = 0;
    this.lastTipAt = null;
  }

  disarm(): void {
    this.armed = false;
  }

  reset(): void {
    this.armed = false;
    this.window = [];
    this.hrBaseline = null;
    this.hrvBaseline = null;
    this.breachStreak = 0;
    this.lastTipAt = null;
    this.lastSampleT = -Infinity;
  }

  get baselineSampleCount(): number {
    return this.window.length;
  }
  get hrBaselineValue(): number | null {
    return this.hrBaseline;
  }
  get hrvBaselineValue(): number | null {
    return this.hrvBaseline;
  }

  /**
   * Ingest a single biometric sample. Always maintains the baseline; fires the
   * tip handler only when armed and all robustness gates pass.
   */
  ingest(sample: BiometricSample): IngestResult {
    const { tuning } = this;

    if (sample.quality !== undefined && sample.quality < tuning.minQuality) {
      return { fired: false, rejected: true, reason: 'low_quality' };
    }
    if (sample.t <= this.lastSampleT) {
      return { fired: false, rejected: true, reason: 'nonmonotonic' };
    }
    this.lastSampleT = sample.t;

    // Maintain the rolling window (for the warmup count).
    this.window.push(sample);
    const cutoff = sample.t - tuning.baselineWindowMs;
    while (this.window.length > 0 && this.window[0]!.t < cutoff) {
      this.window.shift();
    }

    const warmedUp = this.window.length >= tuning.minBaselineSamples;

    // Judge breach against the EXISTING baseline (before updating it).
    const hrSpike =
      sample.hr !== undefined &&
      this.hrBaseline !== null &&
      (sample.hr >= this.hrBaseline * (1 + tuning.hrSpikePct) ||
        sample.hr >= this.hrBaseline + tuning.hrSpikeAbs);
    const hrvDrop =
      sample.hrvMs !== undefined &&
      this.hrvBaseline !== null &&
      sample.hrvMs <= this.hrvBaseline * (1 - tuning.hrvDropPct);
    const breach = warmedUp && (hrSpike || hrvDrop);

    if (breach) {
      this.breachStreak += 1;
      // Freeze baseline during a breach so it can't normalise the spike away.
    } else {
      this.breachStreak = 0;
      this.updateBaseline(sample);
    }

    if (!this.armed || !breach) {
      return { fired: false, rejected: false };
    }
    if (this.breachStreak < tuning.debounceSamples) {
      return { fired: false, rejected: false, reason: 'debouncing' };
    }

    const now = this.clock.now();
    if (this.lastTipAt !== null && now - this.lastTipAt < tuning.refractoryMs) {
      return { fired: false, rejected: false, reason: 'refractory' };
    }

    const spikeMag =
      hrSpike && sample.hr !== undefined && this.hrBaseline
        ? (sample.hr / this.hrBaseline - 1) / tuning.hrSpikePct
        : 0;
    const dropMag =
      hrvDrop && sample.hrvMs !== undefined && this.hrvBaseline
        ? (1 - sample.hrvMs / this.hrvBaseline) / tuning.hrvDropPct
        : 0;
    const intensity: Unit = clamp01(Math.max(spikeMag, dropMag, 0.5));

    this.lastTipAt = now;
    this.breachStreak = 0;
    // Rough classification (intentionally imprecise — V1): an HR spike reads as a
    // breath/oxygen redline (RESOURCE); an HRV drop reads as systemic bracing (TENSION).
    const frictionCondition = hrSpike ? FrictionCondition.RESOURCE : FrictionCondition.TENSION;
    this.handler?.({
      source: TriggerSource.BIOMETRIC,
      intensity,
      reason: hrSpike ? 'HR_SPIKE' : 'HRV_DROP',
      frictionCondition,
      at: now,
    });
    return { fired: true, rejected: false, reason: hrSpike ? 'HR_SPIKE' : 'HRV_DROP' };
  }

  private updateBaseline(sample: BiometricSample): void {
    const a = this.tuning.ewmaAlpha;
    if (sample.hr !== undefined) {
      this.hrBaseline = this.hrBaseline === null ? sample.hr : a * sample.hr + (1 - a) * this.hrBaseline;
    }
    if (sample.hrvMs !== undefined) {
      this.hrvBaseline =
        this.hrvBaseline === null ? sample.hrvMs : a * sample.hrvMs + (1 - a) * this.hrvBaseline;
    }
  }
}
