/**
 * Stabilization detection — PRD §5 "Recalibrate".
 *
 * "System awaits metric stabilization (mental and physical recovery aligning in
 * kind), then transitions to GROWTH state to demand the next physical lever."
 *
 * This decides the ENCOUNTER outcome from post-cue biometrics:
 *   - STABILIZED   → the Engine came back off its peak (recovery aligning) → GROWTH
 *   - DESTABILIZED → it kept redlining past the cue → re-cue, harder
 *   - PENDING      → not enough signal yet
 *
 * Recovery is measured against the PEAK HR (and HRV trough) observed during the
 * encounter — not the value at cue time — so "stabilized" means the redline
 * eased, not that the user instantly relaxed. In the time-only V1 path (no
 * biometrics) there is nothing to observe, so the engine resolves STABILIZED on
 * a grace timer instead; a hard max-wait timer guarantees ENCOUNTER never hangs.
 */

import type { Millis } from '../domain/units.ts';
import type { BiometricSample } from '../ports/telemetry-source.ts';
import type { EngineTuning } from '../domain/session.ts';

export type StabilizationOutcome = 'STABILIZED' | 'DESTABILIZED' | 'PENDING';

/** The recovery reference captured at cue time. */
export interface RecoveryReference {
  hr?: number;
  hrvMs?: number;
}

export class StabilizationDetector {
  private hasRef = false;
  private refHr: number | null = null;
  private peakHr: number | null = null;
  private troughHrv: number | null = null;
  private startedAt: Millis = 0;
  private recoveredStreak = 0;
  private worseningStreak = 0;
  private prevHr: number | null = null;
  private lastMetric: number | null = null;
  private readonly tuning: EngineTuning;

  constructor(tuning: EngineTuning) {
    this.tuning = tuning;
  }

  /** Begin a recalibration window with the cue-time signal as the reference. */
  begin(reference: BiometricSample | null, startedAt: Millis): void {
    this.hasRef = reference !== null && (reference.hr !== undefined || reference.hrvMs !== undefined);
    this.refHr = reference?.hr ?? null;
    this.peakHr = reference?.hr ?? null;
    this.troughHrv = reference?.hrvMs ?? null;
    this.startedAt = startedAt;
    this.recoveredStreak = 0;
    this.worseningStreak = 0;
    this.prevHr = reference?.hr ?? null;
    this.lastMetric = reference?.hr ?? reference?.hrvMs ?? null;
  }

  /** The most recent comparable metric value seen (for the RECALIBRATED event). */
  get metric(): number | null {
    return this.lastMetric;
  }

  /** Feed a post-cue sample; returns the recovery verdict so far. */
  observe(sample: BiometricSample): StabilizationOutcome {
    if (!this.hasRef) return 'PENDING'; // no biometric reference; engine times out
    if (sample.t - this.startedAt < this.tuning.recalGraceMs) return 'PENDING';

    // Track the encounter peak HR and HRV trough.
    if (sample.hr !== undefined) {
      this.peakHr = this.peakHr === null ? sample.hr : Math.max(this.peakHr, sample.hr);
    }
    if (sample.hrvMs !== undefined) {
      this.troughHrv = this.troughHrv === null ? sample.hrvMs : Math.min(this.troughHrv, sample.hrvMs);
    }
    if (sample.hr !== undefined || sample.hrvMs !== undefined) {
      this.lastMetric = sample.hr ?? sample.hrvMs ?? this.lastMetric;
    }

    const hrComparable = sample.hr !== undefined && this.peakHr !== null;
    const hrvComparable = sample.hrvMs !== undefined && this.troughHrv !== null;
    if (!hrComparable && !hrvComparable) return 'PENDING';

    const hrRecovered = hrComparable
      ? sample.hr! <= this.peakHr! * (1 - this.tuning.hrRecoverPct)
      : true;
    const hrvRecovered = hrvComparable
      ? sample.hrvMs! >= this.troughHrv! * (1 + this.tuning.hrvRecoverPct)
      : true;

    if (hrRecovered && hrvRecovered) {
      this.recoveredStreak += 1;
      this.worseningStreak = 0;
      this.prevHr = sample.hr ?? this.prevHr;
      return this.recoveredStreak >= this.tuning.recalStableSamples ? 'STABILIZED' : 'PENDING';
    }

    this.recoveredStreak = 0;

    // Worsening: HR still climbing AND above the worsening band over the reference.
    if (
      sample.hr !== undefined &&
      this.refHr !== null &&
      sample.hr > this.refHr * (1 + this.tuning.worseningPct)
    ) {
      this.worseningStreak = this.prevHr !== null && sample.hr > this.prevHr ? this.worseningStreak + 1 : 0;
      this.prevHr = sample.hr;
      if (this.worseningStreak >= 2) return 'DESTABILIZED';
    } else {
      this.worseningStreak = 0;
      this.prevHr = sample.hr ?? this.prevHr;
    }

    return 'PENDING';
  }
}
