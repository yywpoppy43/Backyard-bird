/**
 * The "strict relational matrix" — PRD §3.
 *
 * "The system will generate or select cues based on a strict relational matrix,
 * not randomized motivation."
 *
 * This module encodes the relationship between the Friction State, the current
 * intensity, and the three Cue Bank dimensions (PhysicalLever / EnergeticVector /
 * StructuralYield) plus the Delivery Tone. It produces a {@link RelationalTarget}
 * — the deterministic
 * "what kind of cue does this exact moment call for?" — which the
 * {@link CueBank} ranks candidate cues against. There is no randomness anywhere.
 */

import type { Unit } from './units.ts';
import { FrictionState } from './friction-state.ts';
import { Lever, DeliveryTone, leverValue, type Cue, type CanonicalDeliveryTone } from './cue.ts';

/** Controlled vocabulary for each lever dimension (shared with the seed corpus). */
export const LEVER_VOCABULARY = {
  [Lever.PHYSICAL]: ['Lower center of gravity', 'Extend spine', 'Root through the floor', 'Stack the joints'],
  [Lever.ENERGETIC]: ['Localize intention', 'Release secondary tension', 'Channel the breath', 'Flood the target'],
  [Lever.STRUCTURAL]: ['Capacity to handle asymmetry', 'Boundary expansion', 'Absorb the load', 'Yield then hold'],
} as const satisfies Record<Lever, readonly string[]>;

/** Intensity bands used to index the tone matrix. */
export type IntensityBand = 'LOW' | 'MID' | 'HIGH';

export function intensityBand(intensity: Unit): IntensityBand {
  if (intensity < 0.5) return 'LOW';
  if (intensity < 0.75) return 'MID';
  return 'HIGH';
}

/**
 * Per-state ordered priority of the lever dimensions, derived from each state's
 * "Target Logic" in PRD §2:
 *   BASELINE  — establish the physical fact of capability → structural grounding (PhysicalLever)
 *   INTENTION — direct energetic focus; prevent energy leakage (EnergeticVector)
 *   ENCOUNTER — force the Pilot to remain in the structure; "breathe, stay" (PhysicalLever/EnergeticVector)
 *   GROWTH    — expand the edge; new capacity (StructuralYield)
 */
export const STATE_EMPHASIS: Readonly<Record<FrictionState, readonly Lever[]>> = {
  [FrictionState.BASELINE]: [Lever.PHYSICAL, Lever.STRUCTURAL, Lever.ENERGETIC],
  [FrictionState.INTENTION]: [Lever.ENERGETIC, Lever.PHYSICAL, Lever.STRUCTURAL],
  [FrictionState.ENCOUNTER]: [Lever.PHYSICAL, Lever.ENERGETIC, Lever.STRUCTURAL],
  [FrictionState.GROWTH]: [Lever.STRUCTURAL, Lever.PHYSICAL, Lever.ENERGETIC],
};

/**
 * The tone matrix: (state × intensity band) → ordered Delivery Tone preference.
 * Higher intensity pulls sharper, more commanding tones (PRD §2 State 3: "Sharp,
 * commanding"; "Command a physical override").
 */
const T = DeliveryTone;
export const TONE_MATRIX: Readonly<
  Record<FrictionState, Record<IntensityBand, readonly CanonicalDeliveryTone[]>>
> = {
  [FrictionState.BASELINE]: {
    LOW: [T.CLINICAL_GROUNDING, T.STEADY_AFFIRMING, T.DIRECT_EXPANSIVE, T.SHARP_COMMANDING],
    MID: [T.CLINICAL_GROUNDING, T.STEADY_AFFIRMING, T.DIRECT_EXPANSIVE, T.SHARP_COMMANDING],
    HIGH: [T.STEADY_AFFIRMING, T.CLINICAL_GROUNDING, T.DIRECT_EXPANSIVE, T.SHARP_COMMANDING],
  },
  [FrictionState.INTENTION]: {
    LOW: [T.CLINICAL_GROUNDING, T.STEADY_AFFIRMING, T.DIRECT_EXPANSIVE, T.SHARP_COMMANDING],
    MID: [T.STEADY_AFFIRMING, T.CLINICAL_GROUNDING, T.DIRECT_EXPANSIVE, T.SHARP_COMMANDING],
    HIGH: [T.STEADY_AFFIRMING, T.DIRECT_EXPANSIVE, T.SHARP_COMMANDING, T.CLINICAL_GROUNDING],
  },
  [FrictionState.ENCOUNTER]: {
    LOW: [T.DIRECT_EXPANSIVE, T.SHARP_COMMANDING, T.STEADY_AFFIRMING, T.CLINICAL_GROUNDING],
    MID: [T.SHARP_COMMANDING, T.DIRECT_EXPANSIVE, T.STEADY_AFFIRMING, T.CLINICAL_GROUNDING],
    HIGH: [T.SHARP_COMMANDING, T.DIRECT_EXPANSIVE, T.STEADY_AFFIRMING, T.CLINICAL_GROUNDING],
  },
  [FrictionState.GROWTH]: {
    LOW: [T.DIRECT_EXPANSIVE, T.STEADY_AFFIRMING, T.CLINICAL_GROUNDING, T.SHARP_COMMANDING],
    MID: [T.DIRECT_EXPANSIVE, T.STEADY_AFFIRMING, T.SHARP_COMMANDING, T.CLINICAL_GROUNDING],
    HIGH: [T.DIRECT_EXPANSIVE, T.SHARP_COMMANDING, T.STEADY_AFFIRMING, T.CLINICAL_GROUNDING],
  },
};

/** Default desired lever phrase for each state's primary emphasis dimension. */
export const STATE_DEFAULT_DESIRED: Readonly<Record<FrictionState, Partial<Record<Lever, string>>>> = {
  [FrictionState.BASELINE]: { [Lever.PHYSICAL]: 'Root through the floor' },
  [FrictionState.INTENTION]: { [Lever.ENERGETIC]: 'Localize intention' },
  [FrictionState.ENCOUNTER]: { [Lever.PHYSICAL]: 'Stack the joints', [Lever.ENERGETIC]: 'Channel the breath' },
  [FrictionState.GROWTH]: { [Lever.STRUCTURAL]: 'Boundary expansion' },
};

/**
 * A persistent, deterministic per-session bias on the desired lever phrases.
 * Recalibration nudges this so cue selection adapts across rounds.
 */
export type RelationalOverride = Partial<Record<Lever, string>>;

/** The concrete "ideal cue profile" for a single selection. */
export interface RelationalTarget {
  state: FrictionState;
  band: IntensityBand;
  /** Ordered lever-dimension priority. */
  emphasis: readonly Lever[];
  /** Desired phrase per dimension (drives the lever-overlap ranking tier). */
  desired: Partial<Record<Lever, string>>;
  /** Ordered Delivery Tone preference. */
  tonePreference: readonly string[];
}

/** The primary (highest-priority) lever dimension for a state. */
export function topEmphasis(state: FrictionState): Lever {
  // STATE_EMPHASIS always has three entries; index 0 is guaranteed.
  return STATE_EMPHASIS[state][0]!;
}

/**
 * Build the relational target for a (state, intensity), merging any persistent
 * override over the state defaults. Pure and deterministic.
 */
export function deriveRelationalTarget(
  state: FrictionState,
  intensity: Unit,
  override: RelationalOverride = {},
): RelationalTarget {
  const band = intensityBand(intensity);
  return {
    state,
    band,
    emphasis: STATE_EMPHASIS[state],
    desired: { ...STATE_DEFAULT_DESIRED[state], ...override },
    tonePreference: TONE_MATRIX[state][band],
  };
}

/**
 * STABILIZED nudge: reinforce the override toward the just-worked cue's primary
 * lever phrase, so the next round favours cues in the same relational vein.
 */
export function reinforceOverride(
  override: RelationalOverride,
  state: FrictionState,
  cue: Cue,
): RelationalOverride {
  const lever = topEmphasis(state);
  return { ...override, [lever]: leverValue(cue, lever) };
}

/**
 * DESTABILIZED / give-up nudge: rotate the desired phrase for the state's
 * primary lever to the next entry in the controlled vocabulary — a deterministic
 * "try a different relational tack".
 */
export function rotateOverride(override: RelationalOverride, state: FrictionState): RelationalOverride {
  const lever = topEmphasis(state);
  const vocab: readonly string[] = LEVER_VOCABULARY[lever];
  const current = override[lever] ?? STATE_DEFAULT_DESIRED[state][lever] ?? vocab[0]!;
  const idx = vocab.indexOf(current);
  const next = vocab[(idx + 1 + vocab.length) % vocab.length]!;
  return { ...override, [lever]: next };
}
