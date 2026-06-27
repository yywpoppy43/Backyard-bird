/**
 * Seed Cue corpus — the initial Cue Bank.
 *
 * Each cue is a complete PRD §3 Cue Object. Lever phrasings are drawn from the
 * controlled {@link LEVER_VOCABULARY} so the relational matrix differentiates
 * cues from the very first round. Transcripts and tones follow each state's
 * "Target Logic" from PRD §2. This data is meant to be edited/extended freely —
 * changing it requires no code changes.
 */

import type { Cue } from '../domain/cue.ts';
import { FrictionState } from '../domain/friction-state.ts';
import { DeliveryTone } from '../domain/cue.ts';
import { CueBank } from './cue-bank.ts';

const S = FrictionState;
const T = DeliveryTone;

export const SEED_CUES: Cue[] = [
  // ── Stage I · BASELINE (Anchor) — establish the fact of capability ─────────
  {
    CueID: 'baseline.root',
    PrimaryState: S.BASELINE,
    PhysicalLever: 'Root through the floor',
    EnergeticVector: 'Localize intention',
    StructuralYield: 'Capacity to handle asymmetry',
    AudioTranscript: 'You are here. The body is capable. Feel the floor meet you — this is the fact we begin from.',
    DeliveryTone: T.CLINICAL_GROUNDING,
  },
  {
    CueID: 'baseline.drop',
    PrimaryState: S.BASELINE,
    PhysicalLever: 'Lower center of gravity',
    EnergeticVector: 'Release secondary tension',
    StructuralYield: 'Absorb the load',
    AudioTranscript: 'Drop your weight into the ground. Nothing to prove yet. The structure already holds you.',
    DeliveryTone: T.STEADY_AFFIRMING,
  },
  {
    CueID: 'baseline.lengthen',
    PrimaryState: S.BASELINE,
    PhysicalLever: 'Extend spine',
    EnergeticVector: 'Channel the breath',
    StructuralYield: 'Boundary expansion',
    AudioTranscript: 'Lengthen the spine. One breath in, one breath out. You have done harder than what comes next.',
    DeliveryTone: T.CLINICAL_GROUNDING,
  },

  // ── Stage II · INTENTION (Vector) — direct focus, prevent leakage ──────────
  {
    CueID: 'intention.line',
    PrimaryState: S.INTENTION,
    PhysicalLever: 'Stack the joints',
    EnergeticVector: 'Localize intention',
    StructuralYield: 'Capacity to handle asymmetry',
    AudioTranscript: 'Set the line. Stack the joints and send everything to the working edge. No leaks.',
    DeliveryTone: T.STEADY_AFFIRMING,
  },
  {
    CueID: 'intention.spend',
    PrimaryState: S.INTENTION,
    PhysicalLever: 'Extend spine',
    EnergeticVector: 'Release secondary tension',
    StructuralYield: 'Yield then hold',
    AudioTranscript: 'Soften what is not working. Spend energy only where it earns its keep.',
    DeliveryTone: T.CLINICAL_GROUNDING,
  },
  {
    CueID: 'intention.channel',
    PrimaryState: S.INTENTION,
    PhysicalLever: 'Lower center of gravity',
    EnergeticVector: 'Channel the breath',
    StructuralYield: 'Absorb the load',
    AudioTranscript: 'Find the channel. The breath feeds the structure. Hold the shape and let it carry the load.',
    DeliveryTone: T.DIRECT_EXPANSIVE,
  },

  // ── Stage III · ENCOUNTER (Tipping Point) — hijack the escape, command stay ─
  {
    CueID: 'encounter.stay',
    PrimaryState: S.ENCOUNTER,
    PhysicalLever: 'Stack the joints',
    EnergeticVector: 'Channel the breath',
    StructuralYield: 'Capacity to handle asymmetry',
    AudioTranscript: 'Stay. Breathe here. Do not leave the structure — the mind wants out, the body does not.',
    DeliveryTone: T.SHARP_COMMANDING,
  },
  {
    CueID: 'encounter.hold',
    PrimaryState: S.ENCOUNTER,
    PhysicalLever: 'Root through the floor',
    EnergeticVector: 'Localize intention',
    StructuralYield: 'Absorb the load',
    AudioTranscript: 'Hold the line. One breath. You are not in danger — you are at the edge. Remain.',
    DeliveryTone: T.SHARP_COMMANDING,
  },
  {
    CueID: 'encounter.into',
    PrimaryState: S.ENCOUNTER,
    PhysicalLever: 'Lower center of gravity',
    EnergeticVector: 'Release secondary tension',
    StructuralYield: 'Boundary expansion',
    AudioTranscript: 'Breathe into it. Drop, release the noise, keep the load. This is the work itself.',
    DeliveryTone: T.DIRECT_EXPANSIVE,
  },
  {
    CueID: 'encounter.pass',
    PrimaryState: S.ENCOUNTER,
    PhysicalLever: 'Extend spine',
    EnergeticVector: 'Channel the breath',
    StructuralYield: 'Yield then hold',
    AudioTranscript: 'Spine long. Stay. The escape is only a thought — let it pass and remain in the shape.',
    DeliveryTone: T.SHARP_COMMANDING,
  },

  // ── Stage IV · GROWTH (Expansion) — capitalize, demand the next edge ───────
  {
    CueID: 'growth.more',
    PrimaryState: S.GROWTH,
    PhysicalLever: 'Stack the joints',
    EnergeticVector: 'Localize intention',
    StructuralYield: 'Boundary expansion',
    AudioTranscript: 'You held. Now take more. Push the boundary outward — this capacity is yours now.',
    DeliveryTone: T.DIRECT_EXPANSIVE,
  },
  {
    CueID: 'growth.newfloor',
    PrimaryState: S.GROWTH,
    PhysicalLever: 'Root through the floor',
    EnergeticVector: 'Channel the breath',
    StructuralYield: 'Capacity to handle asymmetry',
    AudioTranscript: 'That edge is your new floor. Reach past it. Demand the next inch.',
    DeliveryTone: T.STEADY_AFFIRMING,
  },
  {
    CueID: 'growth.claim',
    PrimaryState: S.GROWTH,
    PhysicalLever: 'Extend spine',
    EnergeticVector: 'Flood the target',
    StructuralYield: 'Yield then hold',
    AudioTranscript: 'Expand. Flood the target and grow the shape. Claim the ground you just forged.',
    DeliveryTone: T.DIRECT_EXPANSIVE,
  },
];

/** Construct a Cue Bank from the seed corpus (validated on the way in). */
export function createSeedCueBank(): CueBank {
  return CueBank.fromJson(SEED_CUES);
}
