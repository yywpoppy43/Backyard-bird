import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadCues, InvalidCueError } from '../domain/cue.ts';
import { FrictionState } from '../domain/friction-state.ts';
import { deriveRelationalTarget } from '../domain/relational.ts';
import { CueBank } from '../cue-bank/cue-bank.ts';
import type { SelectionContext } from '../ports/cue-selector.ts';
import { createSeedCueBank, SEED_CUES } from '../cue-bank/seed-cues.ts';

function ctxFor(
  state: FrictionState,
  intensity: number,
  over: Partial<SelectionContext> = {},
): SelectionContext {
  return {
    targetState: state,
    source: 'INIT',
    intensity,
    round: 1,
    now: 0,
    lastCueId: null,
    recentCueIds: [],
    target: deriveRelationalTarget(state, intensity, {}),
    lastSpokenAt: new Map(),
    ...over,
  };
}

test('loadCues validates the corpus and rejects malformed data', () => {
  assert.throws(() => loadCues({}), InvalidCueError);
  assert.throws(() => loadCues([{ CueID: 'x' }]), InvalidCueError);
  assert.throws(
    () =>
      loadCues([
        { ...SEED_CUES[0] },
        { ...SEED_CUES[0] }, // duplicate CueID
      ]),
    InvalidCueError,
  );
  assert.equal(loadCues(SEED_CUES).length, SEED_CUES.length);
});

test('the seed bank covers all four states', () => {
  const bank = createSeedCueBank();
  assert.deepEqual(bank.statesCovered().sort(), ['BASELINE', 'ENCOUNTER', 'GROWTH', 'INTENTION']);
});

test('selection is deterministic and respects the relational matrix', () => {
  const bank = createSeedCueBank();
  const ctx = ctxFor(FrictionState.ENCOUNTER, 0.9);
  const a = bank.select(ctx);
  const b = bank.select(ctx);
  assert.ok(a);
  assert.equal(a?.CueID, b?.CueID, 'same context yields the same cue');
  // ENCOUNTER target desires PhysicalLever "Stack the joints" + EnergeticVector
  // "Channel the breath", both present on encounter.stay → highest relational overlap.
  assert.equal(a?.CueID, 'encounter.stay');
});

test('selection never repeats the immediately-previous cue', () => {
  const bank = createSeedCueBank();
  const first = bank.select(ctxFor(FrictionState.ENCOUNTER, 0.9));
  assert.ok(first);
  const second = bank.select(ctxFor(FrictionState.ENCOUNTER, 0.9, { lastCueId: first!.CueID }));
  assert.ok(second);
  assert.notEqual(second?.CueID, first?.CueID);
});

test('selection rotates away from recently-spoken cues', () => {
  const bank = createSeedCueBank();
  const pool = bank.cuesForState(FrictionState.GROWTH).map((c) => c.CueID);
  const recent = pool.slice(0, pool.length - 1);
  const chosen = bank.select(ctxFor(FrictionState.GROWTH, 0.6, { recentCueIds: recent }));
  assert.ok(chosen);
  assert.equal(chosen?.CueID, pool[pool.length - 1], 'picks the only non-recent cue');
});

test('select returns null for a state with no cues', () => {
  const bank = new CueBank(SEED_CUES.filter((c) => c.PrimaryState !== FrictionState.GROWTH));
  assert.equal(bank.select(ctxFor(FrictionState.GROWTH, 0.6)), null);
});
