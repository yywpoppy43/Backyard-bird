import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ManualClock } from '../adapters/manual-clock.ts';
import { MemoryEventBus } from '../adapters/memory-event-bus.ts';
import { RecordingTTS } from '../adapters/recording-tts.ts';
import { createCompanion } from '../create-companion.ts';
import { createDatabaseCueBank, loadCueDatabaseJson } from '../cue-bank/cue-database.ts';
import { isCue } from '../domain/cue.ts';
import { FrictionState, FRICTION_STATES } from '../domain/friction-state.ts';
import { deriveRelationalTarget } from '../domain/relational.ts';
import type { SelectionContext } from '../ports/cue-selector.ts';
import { driveUntilEnded } from './helpers.ts';

test('the master database loads, validates, and has 20 well-formed cues', () => {
  const raw = loadCueDatabaseJson();
  assert.ok(Array.isArray(raw));
  assert.equal(raw.length, 20);
  for (const entry of raw as unknown[]) {
    assert.ok(isCue(entry), 'every entry matches the Cue schema');
  }
});

test('the database covers all four states with the expected counts', () => {
  const bank = createDatabaseCueBank();
  assert.deepEqual(bank.statesCovered().sort(), ['BASELINE', 'ENCOUNTER', 'GROWTH', 'INTENTION']);
  const counts = Object.fromEntries(
    FRICTION_STATES.map((s) => [s, bank.cuesForState(s).length]),
  );
  assert.deepEqual(counts, { BASELINE: 3, INTENTION: 6, ENCOUNTER: 6, GROWTH: 5 });
});

test('selecting for a state pulls a cue of that state (ENCOUNTER → ENCOUNTER)', () => {
  const bank = createDatabaseCueBank();
  for (const state of FRICTION_STATES) {
    const ctx: SelectionContext = {
      targetState: state,
      source: 'INIT',
      intensity: 0.8,
      round: 1,
      now: 0,
      lastCueId: null,
      recentCueIds: [],
      target: deriveRelationalTarget(state, 0.8, {}),
      lastSpokenAt: new Map(),
    };
    const cue = bank.select(ctx);
    assert.ok(cue, `a cue exists for ${state}`);
    assert.equal(cue?.PrimaryState, state);
  }
});

test('the default companion runs on the master database and cues match state', async () => {
  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  const tts = new RecordingTTS();
  const { engine } = createCompanion({ clock, bus, tts }); // default corpus = master DB
  engine.start({ lengthMs: 60_000, curve: { kind: 'linear' }, maxRounds: 1 });
  await driveUntilEnded(clock, bus, { stepMs: 500, maxMs: 120_000 });

  const selected = bus.ofType('CUE_SELECTED');
  assert.ok(selected.length >= 4);
  for (const e of selected) assert.equal(e.cue.PrimaryState, e.state);
  // The ENCOUNTER intervention specifically pulled an ENCOUNTER cue.
  const encounter = selected.filter((e) => e.state === FrictionState.ENCOUNTER);
  assert.ok(encounter.length >= 1);
  assert.ok(encounter.every((e) => e.cue.PrimaryState === FrictionState.ENCOUNTER));
});
