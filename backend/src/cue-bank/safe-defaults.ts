/**
 * Static safe-default cues — the engine's last-resort line so a tipping point is
 * never met with silence.
 *
 * When neither the static corpus nor the generator can produce a cue for a state
 * (an empty corpus for that state AND a network/API failure, or a generation
 * that kept leaking forbidden vocabulary), the engine speaks the safe default
 * for the current state instead of going quiet. These are deliberately plain,
 * universal, and on-spec for each state: a real user mid-session always hears
 * *something* grounded.
 *
 * Like the seed corpus and the master cue database, these are hand-authored,
 * trusted cues — plain somatic language only (state acknowledgment → physical
 * command → reframe), no internal/framework vocabulary. The companion test
 * additionally asserts every one is a valid Cue and passes the spoken-vocabulary
 * guard, so an authoring slip is caught before it can ship.
 */

import type { Cue } from '../domain/cue.ts';
import { DeliveryTone, isCue } from '../domain/cue.ts';
import { FrictionState, FRICTION_STATES } from '../domain/friction-state.ts';

const SAFE_DEFAULTS: Record<FrictionState, Cue> = {
  [FrictionState.BASELINE]: {
    CueID: 'safe-baseline',
    PrimaryState: FrictionState.BASELINE,
    PhysicalLever: 'Let your shoulders drop and your jaw loosen.',
    EnergeticVector: 'Breath slow and low in the belly.',
    StructuralYield: 'This calm is the ground you build from.',
    AudioTranscript: 'Settle in. Let your shoulders drop and your breath go slow. This is your ground.',
    DeliveryTone: DeliveryTone.CLINICAL_GROUNDING,
  },
  [FrictionState.INTENTION]: {
    CueID: 'safe-intention',
    PrimaryState: FrictionState.INTENTION,
    PhysicalLever: 'Plant your feet and set your gaze on one point.',
    EnergeticVector: 'Breath steady, drawn in through the nose.',
    StructuralYield: 'You choose the edge before you meet it.',
    AudioTranscript: 'Plant your feet. Pick your one point and breathe into it. You set the edge now.',
    DeliveryTone: DeliveryTone.STEADY_AFFIRMING,
  },
  [FrictionState.ENCOUNTER]: {
    CueID: 'safe-encounter',
    PrimaryState: FrictionState.ENCOUNTER,
    PhysicalLever: 'Drop your breath low and hold your line.',
    EnergeticVector: 'Send the exhale into the hardest part.',
    StructuralYield: 'Staying here is what makes the room wider.',
    AudioTranscript: 'This is the hard part. Drop your breath low and hold your line. Stay, and it opens.',
    DeliveryTone: DeliveryTone.SHARP_COMMANDING,
  },
  [FrictionState.GROWTH]: {
    CueID: 'safe-growth',
    PrimaryState: FrictionState.GROWTH,
    PhysicalLever: 'Stand tall and take one fuller breath.',
    EnergeticVector: 'Let the breath ride all the way out.',
    StructuralYield: 'What you just held is yours to keep.',
    AudioTranscript: 'You held. Stand tall and take one fuller breath. That edge is yours now — take more.',
    DeliveryTone: DeliveryTone.DIRECT_EXPANSIVE,
  },
};

// Fail fast at startup if a safe default is ever malformed — these can never be
// allowed to be the thing that breaks, since they are the fallback of last resort.
for (const state of FRICTION_STATES) {
  const cue = SAFE_DEFAULTS[state];
  if (!isCue(cue) || cue.PrimaryState !== state) {
    throw new Error(`safe-defaults: malformed safe default for state ${state}`);
  }
  Object.freeze(cue);
}

/** All safe-default cues, keyed by state (frozen). */
export const SAFE_DEFAULT_CUES: Readonly<Record<FrictionState, Cue>> = Object.freeze(SAFE_DEFAULTS);

/** The guaranteed safe-default cue for a state. Never returns null. */
export function safeDefaultCue(state: FrictionState): Cue {
  return SAFE_DEFAULT_CUES[state];
}
