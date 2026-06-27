import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ManualClock } from '../adapters/manual-clock.ts';
import {
  computeTippingPoints,
  TemporalTrigger,
  type TipPoint,
  type TippingPlanner,
} from '../triggers/temporal-trigger.ts';
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

test('timing seam: no personalization (or no planner) yields identical V1 timing', () => {
  const config: SessionConfig = { lengthMs: 20_000, curve: { kind: 'ramp', peakAt: 0.9 } };
  const base = computeTippingPoints(config);
  assert.deepEqual(computeTippingPoints(config, {}), base);
  assert.deepEqual(computeTippingPoints(config, { profile: { anxiety: 0.9 } }), base);
});

test('timing seam: a planner can nudge the default tips', () => {
  const config: SessionConfig = { lengthMs: 20_000, curve: { kind: 'linear' }, difficultyThresholds: [0.5] };
  // Pull every tipping point 10% earlier (a profile-driven nudge).
  const planner: TippingPlanner = (_input, computeDefault) =>
    computeDefault().map((t) => ({ ...t, atMs: Math.round(t.atMs * 0.9) }));
  const base = computeTippingPoints(config);
  const nudged = computeTippingPoints(config, { planner });
  assert.equal(nudged.length, base.length);
  assert.equal(nudged[0]!.atMs, Math.round(base[0]!.atMs * 0.9));
});

test('timing seam: a planner can feed the computation from the profile', () => {
  const config: SessionConfig = { lengthMs: 20_000, curve: { kind: 'linear' } };
  // Ignore the default entirely; compute tips straight from the profile.
  const planner: TippingPlanner = ({ profile }) => {
    const at = (profile?.['firstTipMs'] as number) ?? 1_000;
    const custom: TipPoint[] = [{ atMs: at, intensity: 1, reason: 'profile' }];
    return custom;
  };
  const tips = computeTippingPoints(config, { profile: { firstTipMs: 7_500 }, planner });
  assert.deepEqual(tips, [{ atMs: 7_500, intensity: 1, reason: 'profile' }]);
});

test('timing seam: TemporalTrigger honours an injected planner', () => {
  const clock = new ManualClock();
  const planner: TippingPlanner = () => [{ atMs: 3_000, intensity: 1, reason: 'profile' }];
  const trig = new TemporalTrigger(clock, { planner });
  const fired: TriggerSignal[] = [];
  trig.onTip((s) => fired.push(s));
  trig.arm({
    round: 1,
    sessionStartedAt: 0,
    config: { lengthMs: 20_000, curve: { kind: 'linear' } },
  });
  clock.advance(2_500);
  assert.equal(fired.length, 0);
  clock.advance(1_000); // now 3500 >= 3000
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.reason, 'profile');
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
