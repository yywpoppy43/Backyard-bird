/**
 * Friction typology — a finer classification *within* the trigger logic.
 *
 * This is an ADDITION to the PRD (not a change to it): the four-state Friction
 * State Machine is unchanged, but a tipping point can be tagged with which kind
 * of friction is present, so the generative layer can produce a precisely-matched
 * cue. The conditions come from the Generative Cue Engine spec:
 *
 *   VELOCITY  — rushing/erratic pace, or freezing (rhythm & cadence)
 *   RESOURCE  — breath holding, shallow breathing, bracing (breath & oxygen)
 *   ALIGNMENT — collapsing chest, dropping gaze, losing form (skeletal line)
 *   TENSION   — clenching, wasted effort leaking to non-target muscles
 *
 * It is optional everywhere: a trigger MAY tag a signal with a condition, and
 * the generator falls back to inferring one when none is supplied.
 */
export const FrictionCondition = {
  VELOCITY: 'VELOCITY',
  RESOURCE: 'RESOURCE',
  ALIGNMENT: 'ALIGNMENT',
  TENSION: 'TENSION',
} as const;

export type FrictionCondition = (typeof FrictionCondition)[keyof typeof FrictionCondition];

export const FRICTION_CONDITIONS: readonly FrictionCondition[] = [
  FrictionCondition.VELOCITY,
  FrictionCondition.RESOURCE,
  FrictionCondition.ALIGNMENT,
  FrictionCondition.TENSION,
];
