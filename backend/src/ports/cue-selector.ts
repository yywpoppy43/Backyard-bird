/**
 * Cue-SELECTION seam (PRD §5 "cross-references the state machine and generates
 * the appropriate cue").
 *
 * The engine depends only on this {@link CueSelector} port — it never references
 * a concrete Cue Bank. The default implementation is {@link CueBank} (the
 * deterministic relational matrix). A future personalization layer can drop in
 * its own selector (typically a decorator wrapping the CueBank, constructed with
 * a user profile) to influence *which* cue is chosen, without any engine change.
 *
 * The {@link SelectionContext} carries the full situational signal — state,
 * trigger source, intensity, round, history — so a selector is never coupled to
 * biometric state alone.
 */

import type { Millis } from '../domain/units.ts';
import type { FrictionState } from '../domain/friction-state.ts';
import type { Cue } from '../domain/cue.ts';
import type { RelationalTarget } from '../domain/relational.ts';
import type { TriggerSource } from '../triggers/trigger.ts';

/** Everything a selector needs to choose a cue. */
export interface SelectionContext {
  targetState: FrictionState;
  /** Why this cue is firing: a proactive lifecycle cue ('INIT') or a trigger. */
  source: TriggerSource | 'INIT';
  /** Current intensity in [0,1]. */
  intensity: number;
  round: number;
  now: Millis;
  /** The cue spoken immediately before (never repeated back-to-back). */
  lastCueId: string | null;
  /** Recently spoken cues to avoid (rotation), most-recent-last. */
  recentCueIds: readonly string[];
  /** The relational ideal for this moment (state × intensity matrix). */
  target: RelationalTarget;
  /** CueID → last spoken time, for the freshness tier. */
  lastSpokenAt: ReadonlyMap<string, Millis>;
}

export interface CueSelector {
  /** Choose the best cue for `ctx`, or `null` if none exists for the state. */
  select(ctx: SelectionContext): Cue | null;
}
