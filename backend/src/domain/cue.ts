/**
 * The Cue Object — PRD §3 "Data Schema".
 *
 * "The system will generate or select cues based on a strict relational matrix,
 * not randomized motivation."
 *
 * The {@link Cue} interface mirrors the PRD JSON schema field-for-field, so a
 * `Cue[]` validates 1:1 against an on-disk cue corpus:
 *
 *   {
 *     "CueID": "string",
 *     "PrimaryState": "enum [BASELINE, INTENTION, ENCOUNTER, GROWTH]",
 *     "PhysicalLever_Metal":   "string",
 *     "EnergeticVector_Water": "string",
 *     "StructuralYield_Wood":  "string",
 *     "AudioTranscript":       "string",
 *     "DeliveryTone":          "string"
 *   }
 *
 * Validation is hand-rolled (no Zod/ajv) to keep the framework dependency-free.
 */

import { FrictionState, FRICTION_STATES } from './friction-state.ts';

/**
 * The three relational dimensions of the "Cue Bank physics" (PRD §3). Each maps
 * to one descriptive string field on the {@link Cue}. These are the axes of the
 * "strict relational matrix" used by the {@link CueBank} to select cues.
 */
export const Lever = {
  /** PhysicalLever_Metal — the structural/postural instruction. */
  METAL: 'METAL',
  /** EnergeticVector_Water — the flow/intention instruction. */
  WATER: 'WATER',
  /** StructuralYield_Wood — the capacity/boundary instruction. */
  WOOD: 'WOOD',
} as const;

export type Lever = (typeof Lever)[keyof typeof Lever];

export const LEVERS: readonly Lever[] = [Lever.METAL, Lever.WATER, Lever.WOOD];

/** Maps a {@link Lever} dimension to its concrete field name on a {@link Cue}. */
export const LEVER_FIELD = {
  [Lever.METAL]: 'PhysicalLever_Metal',
  [Lever.WATER]: 'EnergeticVector_Water',
  [Lever.WOOD]: 'StructuralYield_Wood',
} as const satisfies Record<Lever, keyof Cue>;

/**
 * Canonical delivery tones. The PRD types `DeliveryTone` as a free string with
 * examples ("Clinical, grounding", "Sharp, commanding"), so {@link Cue.DeliveryTone}
 * stays `string`; this set is the controlled vocabulary used by the seed corpus,
 * and {@link CanonicalDeliveryTone} types the relational tone matrix so tone
 * typos are caught at compile time.
 */
export const DeliveryTone = {
  CLINICAL_GROUNDING: 'Clinical, grounding',
  STEADY_AFFIRMING: 'Steady, affirming',
  SHARP_COMMANDING: 'Sharp, commanding',
  DIRECT_EXPANSIVE: 'Direct, expansive',
} as const;

export type CanonicalDeliveryTone = (typeof DeliveryTone)[keyof typeof DeliveryTone];

/** The Cue Object, matching the PRD §3 schema exactly. */
export interface Cue {
  /** Stable unique identifier. */
  CueID: string;
  /** Which state of the Friction State Machine this cue belongs to. */
  PrimaryState: FrictionState;
  /** Metal — physical lever, e.g. "Lower center of gravity", "Extend spine". */
  PhysicalLever_Metal: string;
  /** Water — energetic vector, e.g. "Localize intention", "Release secondary tension". */
  EnergeticVector_Water: string;
  /** Wood — structural yield, e.g. "Capacity to handle asymmetry", "Boundary expansion". */
  StructuralYield_Wood: string;
  /** The exact verbal transmission handed to the TTS engine. */
  AudioTranscript: string;
  /** Delivery tone hint, e.g. "Clinical, grounding", "Sharp, commanding". */
  DeliveryTone: string;
}

/** Returns the lever string for a given dimension. */
export function leverValue(cue: Cue, lever: Lever): string {
  return cue[LEVER_FIELD[lever]];
}

/**
 * The three relational dimensions of a cue as `{ lever, value }` pairs, in
 * canonical Metal/Water/Wood order. Convenient for a UI rendering the relational
 * make-up of a selected cue.
 */
export function leverEntries(cue: Cue): { lever: Lever; value: string }[] {
  return LEVERS.map((lever) => ({ lever, value: leverValue(cue, lever) }));
}

function isFrictionState(value: unknown): value is FrictionState {
  return typeof value === 'string' && (FRICTION_STATES as readonly string[]).includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Structural type guard for a single Cue object. */
export function isCue(value: unknown): value is Cue {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    isNonEmptyString(c['CueID']) &&
    isFrictionState(c['PrimaryState']) &&
    isNonEmptyString(c['PhysicalLever_Metal']) &&
    isNonEmptyString(c['EnergeticVector_Water']) &&
    isNonEmptyString(c['StructuralYield_Wood']) &&
    isNonEmptyString(c['AudioTranscript']) &&
    isNonEmptyString(c['DeliveryTone'])
  );
}

/** Thrown when a cue corpus fails validation at load time. */
export class InvalidCueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCueError';
  }
}

/**
 * Validate and normalise an untrusted cue corpus (e.g. parsed JSON). Fails fast
 * with a descriptive error so malformed data is caught at startup, never
 * mid-session. Returns a defensively-copied, frozen `Cue[]`.
 */
export function loadCues(data: unknown): Cue[] {
  if (!Array.isArray(data)) {
    throw new InvalidCueError('Cue corpus must be an array of Cue objects.');
  }
  const seen = new Set<string>();
  const out: Cue[] = [];
  data.forEach((entry, i) => {
    if (!isCue(entry)) {
      throw new InvalidCueError(
        `Cue at index ${i} is malformed; required fields: CueID, PrimaryState ` +
          `(one of ${FRICTION_STATES.join('/')}), PhysicalLever_Metal, ` +
          `EnergeticVector_Water, StructuralYield_Wood, AudioTranscript, DeliveryTone.`,
      );
    }
    if (seen.has(entry.CueID)) {
      throw new InvalidCueError(`Duplicate CueID "${entry.CueID}" at index ${i}.`);
    }
    seen.add(entry.CueID);
    out.push(Object.freeze({ ...entry }));
  });
  return out;
}
