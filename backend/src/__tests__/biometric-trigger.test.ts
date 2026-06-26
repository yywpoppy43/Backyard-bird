import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ManualClock } from '../adapters/manual-clock.ts';
import { BiometricTrigger } from '../triggers/biometric-trigger.ts';
import type { TriggerSignal } from '../triggers/trigger.ts';
import { resolveTuning, type SessionConfig } from '../domain/session.ts';

const CONFIG: SessionConfig = { lengthMs: 100_000, curve: { kind: 'linear' } };
const ARM = { round: 1, sessionStartedAt: 0, config: CONFIG };

function makeTrigger(): { clock: ManualClock; trig: BiometricTrigger; fired: TriggerSignal[] } {
  const clock = new ManualClock();
  const trig = new BiometricTrigger(clock, resolveTuning());
  const fired: TriggerSignal[] = [];
  trig.onTip((s) => fired.push(s));
  return { clock, trig, fired };
}

function feed(clock: ManualClock, trig: BiometricTrigger, t: number, hr?: number, hrvMs?: number) {
  clock.advance(t - clock.now());
  return trig.ingest({ t, hr, hrvMs, quality: 1 });
}

test('no fire before the baseline has warmed up', () => {
  const { clock, trig, fired } = makeTrigger();
  trig.arm(ARM);
  // Three big spikes, but the window has < minBaselineSamples readings.
  feed(clock, trig, 0, 120);
  feed(clock, trig, 1000, 121);
  feed(clock, trig, 2000, 122);
  assert.equal(fired.length, 0);
});

test('an HR spike fires after warmup + debounce', () => {
  const { clock, trig, fired } = makeTrigger();
  trig.arm(ARM);
  for (let i = 0; i < 8; i++) feed(clock, trig, i * 1000, 70, 60); // warmup at rest
  feed(clock, trig, 8000, 100, 60); // breach 1
  feed(clock, trig, 9000, 101, 60); // breach 2
  assert.equal(fired.length, 0, 'still debouncing');
  feed(clock, trig, 10_000, 102, 60); // breach 3 → fire
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.source, 'BIOMETRIC');
  assert.equal(fired[0]!.reason, 'HR_SPIKE');
});

test('refractory window suppresses immediate re-fires', () => {
  const { clock, trig, fired } = makeTrigger();
  trig.arm(ARM);
  for (let i = 0; i < 8; i++) feed(clock, trig, i * 1000, 70, 60);
  feed(clock, trig, 8000, 100, 60);
  feed(clock, trig, 9000, 101, 60);
  feed(clock, trig, 10_000, 102, 60); // fire
  feed(clock, trig, 11_000, 103, 60);
  feed(clock, trig, 12_000, 104, 60);
  feed(clock, trig, 13_000, 105, 60); // still within refractory
  assert.equal(fired.length, 1);
});

test('an HRV drop fires (HR alone need not spike)', () => {
  const { clock, trig, fired } = makeTrigger();
  trig.arm(ARM);
  for (let i = 0; i < 8; i++) feed(clock, trig, i * 1000, 70, 60);
  feed(clock, trig, 8000, 70, 40); // hrv drop (<= 60*0.75)
  feed(clock, trig, 9000, 70, 39);
  feed(clock, trig, 10_000, 70, 38); // fire
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.reason, 'HRV_DROP');
});

test('low-quality and out-of-order samples are rejected', () => {
  const { clock, trig } = makeTrigger();
  trig.arm(ARM);
  clock.advance(5000);
  const lowQ = trig.ingest({ t: 5000, hr: 70, quality: 0.1 });
  assert.equal(lowQ.rejected, true);
  trig.ingest({ t: 6000, hr: 70, quality: 1 });
  const stale = trig.ingest({ t: 5500, hr: 70, quality: 1 });
  assert.equal(stale.rejected, true);
});

test('a disarmed trigger keeps the baseline warm but never fires', () => {
  const { clock, trig, fired } = makeTrigger();
  // not armed
  for (let i = 0; i < 8; i++) feed(clock, trig, i * 1000, 70, 60);
  feed(clock, trig, 8000, 120, 60);
  feed(clock, trig, 9000, 121, 60);
  feed(clock, trig, 10_000, 122, 60);
  assert.equal(fired.length, 0);
  assert.ok(trig.baselineSampleCount > 0);
  assert.ok(trig.hrBaselineValue !== null);
});
