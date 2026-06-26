/**
 * Session configuration, the intensity-curve model, and engine tuning.
 *
 * PRD §4 (V1): "The user inputs the expected length and intensity curve of the
 * session." {@link SessionConfig} captures exactly that input; the
 * {@link IntensityCurve} types model the curve; {@link intensityAt} evaluates it.
 *
 * All behavioural constants live in {@link EngineTuning} with documented
 * defaults, so tuning the companion is a data change, not a logic change.
 */

import type { Millis, Unit } from './units.ts';
import { clamp01, lerp } from './units.ts';

/** Thrown when a {@link SessionConfig} is structurally invalid. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** A single control point of a custom curve. */
export interface CurvePoint {
  /** Progress through the session in [0,1]. */
  at: Unit;
  /** Intensity in [0,1]. */
  intensity: Unit;
}

/**
 * The shape of the session's exertion over normalised progress p ∈ [0,1].
 *   - linear   — intensity rises evenly from 0 to 1.
 *   - ramp     — rises to 1 by `peakAt`, then holds at 1 (e.g. a sustained hold).
 *   - interval — `segments` sawtooth humps (work/recover repeats).
 *   - custom   — piecewise-linear interpolation across explicit control points.
 */
export type IntensityCurve =
  | { kind: 'linear' }
  | { kind: 'ramp'; peakAt: Unit }
  | { kind: 'interval'; segments: number }
  | { kind: 'custom'; points: readonly CurvePoint[] };

/** Evaluate an intensity curve at progress `p` (clamped to [0,1]). Pure. */
export function intensityAt(curve: IntensityCurve, p: Unit): Unit {
  const x = clamp01(p);
  switch (curve.kind) {
    case 'linear':
      return x;
    case 'ramp': {
      const peak = clamp01(curve.peakAt);
      if (peak <= 0) return 1;
      return x < peak ? clamp01(x / peak) : 1;
    }
    case 'interval': {
      const segs = Math.max(1, Math.floor(curve.segments));
      // Triangle wave per segment: rises to 1 at the segment midpoint, falls back.
      const frac = (x * segs) % 1;
      return clamp01(frac < 0.5 ? frac * 2 : (1 - frac) * 2);
    }
    case 'custom': {
      const pts = curve.points;
      if (pts.length === 0) return 0;
      const first = pts[0]!;
      if (x <= first.at) return clamp01(first.intensity);
      const last = pts[pts.length - 1]!;
      if (x >= last.at) return clamp01(last.intensity);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        if (x <= b.at) {
          const span = b.at - a.at;
          const t = span <= 0 ? 0 : (x - a.at) / span;
          return clamp01(lerp(a.intensity, b.intensity, t));
        }
      }
      return clamp01(last.intensity);
    }
  }
}

/** Validate a curve, throwing {@link ConfigError} on malformed input. */
export function validateCurve(curve: IntensityCurve): void {
  switch (curve.kind) {
    case 'linear':
      return;
    case 'ramp':
      if (!(curve.peakAt >= 0 && curve.peakAt <= 1)) {
        throw new ConfigError(`ramp.peakAt must be within [0,1], got ${curve.peakAt}`);
      }
      return;
    case 'interval':
      if (!(curve.segments >= 1)) {
        throw new ConfigError(`interval.segments must be >= 1, got ${curve.segments}`);
      }
      return;
    case 'custom': {
      if (curve.points.length < 2) {
        throw new ConfigError('custom curve requires at least 2 points');
      }
      let prev = -Infinity;
      for (const pt of curve.points) {
        if (!(pt.at >= 0 && pt.at <= 1) || !(pt.intensity >= 0 && pt.intensity <= 1)) {
          throw new ConfigError('custom curve points must have at,intensity within [0,1]');
        }
        if (pt.at <= prev) {
          throw new ConfigError('custom curve points must be strictly increasing in `at`');
        }
        prev = pt.at;
      }
      return;
    }
  }
}

/**
 * Behavioural constants. Every value is a documented default; override any of
 * them per-session via {@link SessionConfig.tuning}.
 */
export interface EngineTuning {
  // ── Lifecycle pacing ────────────────────────────────────────────────────
  /** Pause after the BASELINE anchor cue before advancing to INTENTION. */
  baselineSettleMs: Millis;
  /** Cooldown between a cleared GROWTH and the next round's INTENTION. */
  interRoundCooldownMs: Millis;

  // ── Recalibration (ENCOUNTER → GROWTH) ──────────────────────────────────
  /** Settling window after an ENCOUNTER cue before recovery is judged. In V1
   *  (no biometrics) this doubles as the time-only path to STABILIZED. */
  recalGraceMs: Millis;
  /** Hard cap on the ENCOUNTER phase so it can never hang waiting on a sensor. */
  recalMaxWaitMs: Millis;
  /** Consecutive recovered samples required to declare STABILIZED. */
  recalStableSamples: number;
  /** HR must fall back within this fraction above the pre-cue reference. */
  hrRecoverPct: Unit;
  /** HRV must rise back within this fraction below the pre-cue reference. */
  hrvRecoverPct: Unit;
  /** HR climbing this fraction above reference (and trending up) = DESTABILIZED. */
  worseningPct: Unit;

  // ── Biometric trigger (V2) ──────────────────────────────────────────────
  /** Rolling window over which the resting baseline is computed. */
  baselineWindowMs: Millis;
  /** Minimum samples before the trigger may fire (warmup guard). */
  minBaselineSamples: number;
  /** EWMA smoothing factor for the baseline (0..1; lower = smoother). */
  ewmaAlpha: Unit;
  /** HR spike: fraction above baseline that counts as a spike. */
  hrSpikePct: Unit;
  /** HR spike: absolute bpm above baseline that counts as a spike. */
  hrSpikeAbs: number;
  /** HRV drop: fraction below baseline that counts as systemic stress. */
  hrvDropPct: Unit;
  /** Consecutive breaching samples required to fire (debounce sensor glitches). */
  debounceSamples: number;
  /** Minimum gap between biometric tips (refractory period). */
  refractoryMs: Millis;
  /** Samples with quality below this are discarded. */
  minQuality: Unit;

  // ── Escalation & cue rotation ───────────────────────────────────────────
  /** Intensity added per consecutive DESTABILIZED re-cue. */
  escalationStep: Unit;
  /** Max consecutive ENCOUNTER re-cues before gracefully advancing. */
  maxConsecutiveEncounters: number;
  /** How many recently-spoken cues to avoid repeating. */
  recentCueCap: number;
}

export const DEFAULT_TUNING: Readonly<EngineTuning> = Object.freeze({
  baselineSettleMs: 4_000,
  interRoundCooldownMs: 8_000,

  recalGraceMs: 6_000,
  recalMaxWaitMs: 30_000,
  recalStableSamples: 4,
  hrRecoverPct: 0.1,
  hrvRecoverPct: 0.15,
  worseningPct: 0.1,

  baselineWindowMs: 30_000,
  minBaselineSamples: 8,
  ewmaAlpha: 0.1,
  hrSpikePct: 0.15,
  hrSpikeAbs: 25,
  hrvDropPct: 0.25,
  debounceSamples: 3,
  refractoryMs: 45_000,
  minQuality: 0.3,

  escalationStep: 0.15,
  maxConsecutiveEncounters: 3,
  recentCueCap: 3,
});

/** User-facing session input — PRD §4 V1 ("expected length and intensity curve"). */
export interface SessionConfig {
  /** Expected total session length in ms. */
  lengthMs: Millis;
  /** The intensity curve over the session. */
  curve: IntensityCurve;
  /**
   * Intensity thresholds whose upward crossings define candidate tipping points.
   * Defaults to [0.5, 0.75, 0.9].
   */
  difficultyThresholds?: Unit[];
  /**
   * Progress at which a canonical late-session "end wall" tip is injected even
   * on monotone curves. Defaults to 0.85.
   */
  endWallProgress?: Unit;
  /** Enable the biometric (V2) trigger and recovery-aware recalibration. */
  enableBiometrics?: boolean;
  /** Cap on the number of rounds; otherwise bounded by `lengthMs`. */
  maxRounds?: number;
  /** Per-session overrides of {@link EngineTuning}. */
  tuning?: Partial<EngineTuning>;
}

/** Merge per-session tuning over the defaults. */
export function resolveTuning(overrides?: Partial<EngineTuning>): EngineTuning {
  return { ...DEFAULT_TUNING, ...(overrides ?? {}) };
}

export const DEFAULT_DIFFICULTY_THRESHOLDS: readonly Unit[] = [0.5, 0.75, 0.9];
export const DEFAULT_END_WALL_PROGRESS: Unit = 0.85;

/** Validate a session config, throwing {@link ConfigError} before any side effect. */
export function validateSessionConfig(config: SessionConfig): void {
  if (!(config.lengthMs > 0)) {
    throw new ConfigError(`lengthMs must be > 0, got ${config.lengthMs}`);
  }
  validateCurve(config.curve);
  if (config.difficultyThresholds) {
    for (const t of config.difficultyThresholds) {
      if (!(t >= 0 && t <= 1)) {
        throw new ConfigError(`difficultyThresholds must be within [0,1], got ${t}`);
      }
    }
  }
  if (config.endWallProgress !== undefined && !(config.endWallProgress >= 0 && config.endWallProgress <= 1)) {
    throw new ConfigError(`endWallProgress must be within [0,1], got ${config.endWallProgress}`);
  }
  if (config.maxRounds !== undefined && !(config.maxRounds >= 1)) {
    throw new ConfigError(`maxRounds must be >= 1, got ${config.maxRounds}`);
  }
}
