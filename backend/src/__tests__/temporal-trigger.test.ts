import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ManualClock } from '../adapters/manual-clock.ts';
import { computeTippingPoints, TemporalTrigger } from '../triggers/temporal-trigger.ts';
import type { TriggerSignal } from '../triggers/trigger.ts';
import type { SessionConfig } from '../domain/session.ts';

test('linear curve crosses each threshold once, plus an end wall', () => {
  const tips = computeTippingPoints({
    lengthMs: 1000,
    curve: { kind: 'linear' },
    difficultyThresholds: [0.5],
  });
  assert.equal(tips.length, 2);
  assert.equal(tips[0]!.atMs, 500);
  assert.equal(tips[0]!.intensity, 0.5);
  assert.equal(tips[0]!.reason, 'crossing@0.5');
  assert.equal(tips[1]!.reason, 'wall@0.85');
});

test('monotone curve still gets the canonical end wall', () => {
  const tips = computeTippingPoints({
    lengthMs: 1000,
    curve: { kind: 'linear' },
    difficultyThresholds: [], // no interior crossings
  });
  assert.equal(tips.length, 1);
  assert.equal(tips[0]!.reason, 'wall@0.85');
});

test('interval curve re-arms thresholds, yielding one tip per hump', () => {
  const tips = computeTippingPoints({
    lengthMs: 1000,
    curve: { kind: 'interval', segments: 2 },
    difficultyThresholds: [0.9],
  });
  const crossings = tips.filter((t) => t.reason === 'crossing@0.9');
  assert.equal(crossings.length, 2);
});

test('TemporalTrigger fires the next tip via the clock, one per round', () => {
  const clock = new ManualClock();
  const trig = new TemporalTrigger(clock);
  const fired: TriggerSignal[] = [];
  trig.onTip((s) => fired.push(s));

  const config: SessionConfig = {
    lengthMs: 1000,
    curve: { kind: 'linear' },
    difficultyThresholds: [0.5],
  };
  trig.arm({ round: 1, sessionStartedAt: 0, config });

  clock.advance(400);
  assert.equal(fired.length, 0, 'not yet at the first tip');
  clock.advance(200); // now 600 >= 500
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.source, 'TEMPORAL');
  assert.equal(fired[0]!.intensity, 0.5);

  // Next round consumes the next tip (the end wall at 850).
  trig.arm({ round: 2, sessionStartedAt: 0, config });
  clock.advance(300); // now 900 >= 850
  assert.equal(fired.length, 2);
  assert.equal(fired[1]!.reason, 'wall@0.85');
});

test('disarm cancels a pending tip', () => {
  const clock = new ManualClock();
  const trig = new TemporalTrigger(clock);
  const fired: TriggerSignal[] = [];
  trig.onTip((s) => fired.push(s));
  trig.arm({
    round: 1,
    sessionStartedAt: 0,
    config: { lengthMs: 1000, curve: { kind: 'linear' }, difficultyThresholds: [0.5] },
  });
  trig.disarm();
  clock.advance(1000);
  assert.equal(fired.length, 0);
});
