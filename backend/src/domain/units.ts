/** Shared primitive aliases and numeric helpers used across the framework. */

/** Milliseconds. All timestamps and durations are integers of this unit. */
export type Millis = number;

/** A normalised value in the inclusive range [0, 1] (intensity, progress, quality). */
export type Unit = number;

/** Clamp a number to an inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Clamp a number to the unit interval [0, 1]. */
export function clamp01(value: number): Unit {
  return clamp(value, 0, 1);
}

/** Linear interpolation between `a` and `b` at fraction `t` (t clamped to [0,1]). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}
