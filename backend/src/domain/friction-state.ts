/**
 * The Friction State Machine.
 *
 * PRD §2 — "The companion does not play a static audio file. It operates as a
 * dynamic State Machine, tracking the user's progression through the four
 * physical states of the apparatus."
 *
 * The four states are fixed by the PRD and are also the exact value set of the
 * Cue object's `PrimaryState` field (PRD §3):
 *
 *   1. BASELINE  (Anchor)              — onboarding / start of exertion
 *   2. INTENTION (Vector)              — early-stage exertion; form establishment
 *   3. ENCOUNTER (Tipping Point)       — high demand; biometric/timed threshold reached
 *   4. GROWTH    (Expansion)           — friction sustained; capacity stabilized
 *
 * This module is a PURE, side-effect-free, data-driven transition table. It
 * performs no I/O, emits no events and logs nothing. The {@link SessionEngine}
 * owns every side effect; the machine only answers "given I am in state X and
 * event E occurs, what is the next state?". Illegal transitions throw loudly so
 * that a logic bug surfaces immediately rather than corrupting the session.
 */

export const FrictionState = {
  /** Stage I — establish the physical fact of capability; neutralize self-doubt. */
  BASELINE: 'BASELINE',
  /** Stage II — enforce physical boundaries; direct energetic focus. */
  INTENTION: 'INTENTION',
  /** Stage III — hijack the cognitive escape; command a physical override. */
  ENCOUNTER: 'ENCOUNTER',
  /** Stage IV — capitalize on newly forged capacity; demand the next edge. */
  GROWTH: 'GROWTH',
} as const;

export type FrictionState = (typeof FrictionState)[keyof typeof FrictionState];

/** Ordered list of states, matching the PRD's Stage I–IV progression. */
export const FRICTION_STATES: readonly FrictionState[] = [
  FrictionState.BASELINE,
  FrictionState.INTENTION,
  FrictionState.ENCOUNTER,
  FrictionState.GROWTH,
];

/**
 * Events that drive transitions between states. These are internal control
 * signals, distinct from the user-facing {@link EngineEvent} stream.
 */
export const FrictionEvent = {
  /** Baseline anchor delivered; move into early-stage exertion. */
  ADVANCE: 'ADVANCE',
  /** A temporal or biometric tipping point was detected during INTENTION. */
  TIPPING_POINT_DETECTED: 'TIPPING_POINT_DETECTED',
  /** The Engine redlined further during the intervention; re-cue (escalate). */
  DESTABILIZED: 'DESTABILIZED',
  /** Metric stabilization achieved; the push was sustained. */
  STABILIZED: 'STABILIZED',
  /** Inter-round cooldown elapsed; begin the next, higher-demand round. */
  NEXT_ROUND: 'NEXT_ROUND',
} as const;

export type FrictionEvent = (typeof FrictionEvent)[keyof typeof FrictionEvent];

/**
 * The transition table. Rows are the current state; the inner map is the set of
 * legal events for that state and their resulting state.
 *
 *   BASELINE  --ADVANCE-------------> INTENTION
 *   INTENTION --TIPPING_POINT-------> ENCOUNTER
 *   ENCOUNTER --DESTABILIZED--------> ENCOUNTER   (self-loop: re-cue, escalate)
 *   ENCOUNTER --STABILIZED---------> GROWTH
 *   GROWTH    --NEXT_ROUND---------> INTENTION    (loop-back for the next round)
 *
 * Session termination (`SESSION_ENDED`) is intentionally NOT modelled here: it
 * is a lifecycle concern owned by the engine and never changes `PrimaryState`,
 * so the four PRD states remain the only inhabitants of this type.
 */
const TRANSITIONS: Readonly<
  Record<FrictionState, Partial<Record<FrictionEvent, FrictionState>>>
> = {
  [FrictionState.BASELINE]: {
    [FrictionEvent.ADVANCE]: FrictionState.INTENTION,
  },
  [FrictionState.INTENTION]: {
    [FrictionEvent.TIPPING_POINT_DETECTED]: FrictionState.ENCOUNTER,
  },
  [FrictionState.ENCOUNTER]: {
    [FrictionEvent.DESTABILIZED]: FrictionState.ENCOUNTER,
    [FrictionEvent.STABILIZED]: FrictionState.GROWTH,
  },
  [FrictionState.GROWTH]: {
    [FrictionEvent.NEXT_ROUND]: FrictionState.INTENTION,
  },
};

/** Thrown when a transition is requested that the table does not permit. */
export class IllegalTransitionError extends Error {
  readonly from: FrictionState;
  readonly event: FrictionEvent;

  constructor(from: FrictionState, event: FrictionEvent) {
    super(`Illegal transition: no rule for event "${event}" in state "${from}"`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.event = event;
  }
}

/** Returns true when `event` is a legal transition out of `from`. */
export function canTransition(from: FrictionState, event: FrictionEvent): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

/**
 * The pure transition function. Returns the next state, or throws
 * {@link IllegalTransitionError} if the (state, event) pair is not in the table.
 */
export function nextState(from: FrictionState, event: FrictionEvent): FrictionState {
  const to = TRANSITIONS[from][event];
  if (to === undefined) {
    throw new IllegalTransitionError(from, event);
  }
  return to;
}

/** The legal events available from a given state (useful for introspection/UI). */
export function legalEvents(from: FrictionState): FrictionEvent[] {
  return Object.keys(TRANSITIONS[from]) as FrictionEvent[];
}
