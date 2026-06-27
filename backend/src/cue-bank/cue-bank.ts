/**
 * The Cue Bank — PRD §3 / §5 ("cross-references the state machine and generates
 * the appropriate cue").
 *
 * `select()` is a TOTAL, DETERMINISTIC function: given the same context and
 * corpus it always returns the same cue. There is no `Math.random` anywhere in
 * this module (enforced by a determinism test). This is the literal realisation
 * of "a strict relational matrix, not randomized motivation".
 *
 * Ranking is a lexicographic comparator over deterministic tiers:
 *   1. relational overlap  — how well the cue's lever phrases match the target,
 *                            weighted by the state's emphasis ordering (desc)
 *   2. tone preference     — position in the (state × intensity) tone matrix (asc)
 *   3. freshness           — least-recently-spoken first (asc)
 *   4. CueID               — lexicographic tie-break, guaranteeing a total order
 */

import type { FrictionState } from '../domain/friction-state.ts';
import { FRICTION_STATES } from '../domain/friction-state.ts';
import { leverValue, loadCues } from '../domain/cue.ts';
import type { Cue } from '../domain/cue.ts';
import type { RelationalTarget } from '../domain/relational.ts';
import type { CueSelector, SelectionContext } from '../ports/cue-selector.ts';

export class CueBank implements CueSelector {
  private readonly byState: Map<FrictionState, Cue[]> = new Map();
  private readonly all: readonly Cue[];

  constructor(corpus: Cue[]) {
    this.all = corpus;
    for (const state of FRICTION_STATES) this.byState.set(state, []);
    for (const cue of corpus) {
      // Every cue's PrimaryState is a valid FrictionState (guaranteed by loadCues).
      this.byState.get(cue.PrimaryState)!.push(cue);
    }
  }

  /** Build a CueBank from untrusted JSON, validating the corpus up front. */
  static fromJson(data: unknown): CueBank {
    return new CueBank(loadCues(data));
  }

  get size(): number {
    return this.all.length;
  }

  cuesForState(state: FrictionState): readonly Cue[] {
    return this.byState.get(state) ?? [];
  }

  hasCuesFor(state: FrictionState): boolean {
    return this.cuesForState(state).length > 0;
  }

  /** States for which at least one cue exists. */
  statesCovered(): FrictionState[] {
    return FRICTION_STATES.filter((s) => this.hasCuesFor(s));
  }

  /**
   * Deterministically select the best cue for `ctx`, or `null` if the corpus has
   * no cue at all for the target state.
   */
  select(ctx: SelectionContext): Cue | null {
    const pool = this.byState.get(ctx.targetState) ?? [];
    if (pool.length === 0) return null;

    // Tier 0 (hard filters): never repeat the immediately-previous cue; avoid
    // recently spoken cues unless doing so would exhaust the pool.
    let candidates = pool.filter((c) => c.CueID !== ctx.lastCueId);
    if (candidates.length === 0) candidates = pool.slice();

    const recent = new Set(ctx.recentCueIds);
    const fresh = candidates.filter((c) => !recent.has(c.CueID));
    if (fresh.length > 0) candidates = fresh;

    // Tiered deterministic ranking.
    let best = candidates[0]!;
    for (let i = 1; i < candidates.length; i++) {
      if (this.compare(candidates[i]!, best, ctx) < 0) best = candidates[i]!;
    }
    return best;
  }

  /** Relational overlap score: matches weighted by emphasis priority. */
  private overlapScore(cue: Cue, target: RelationalTarget): number {
    let score = 0;
    const n = target.emphasis.length;
    target.emphasis.forEach((lever, i) => {
      const want = target.desired[lever];
      if (want !== undefined && leverValue(cue, lever) === want) {
        score += n - i; // top emphasis weighted highest
      }
    });
    return score;
  }

  private toneRank(cue: Cue, target: RelationalTarget): number {
    const idx = target.tonePreference.indexOf(cue.DeliveryTone);
    return idx === -1 ? target.tonePreference.length : idx;
  }

  /** Returns <0 if `a` should rank before `b`. Total order via CueID tie-break. */
  private compare(a: Cue, b: Cue, ctx: SelectionContext): number {
    const oa = this.overlapScore(a, ctx.target);
    const ob = this.overlapScore(b, ctx.target);
    if (oa !== ob) return ob - oa; // higher overlap first

    const ta = this.toneRank(a, ctx.target);
    const tb = this.toneRank(b, ctx.target);
    if (ta !== tb) return ta - tb; // earlier in tone preference first

    const fa = ctx.lastSpokenAt.get(a.CueID) ?? -1;
    const fb = ctx.lastSpokenAt.get(b.CueID) ?? -1;
    if (fa !== fb) return fa - fb; // least-recently-spoken (smaller) first

    return a.CueID < b.CueID ? -1 : a.CueID > b.CueID ? 1 : 0;
  }
}
