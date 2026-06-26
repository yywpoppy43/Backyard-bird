import { test } from 'node:test';
import assert from 'node:assert/strict';

import { StabilizationDetector } from '../engine/stabilization.ts';
import { resolveTuning } from '../domain/session.ts';

const tuning = resolveTuning();
const GRACE = tuning.recalGraceMs;

test('no biometric reference stays PENDING (engine times out instead)', () => {
  const d = new StabilizationDetector(tuning);
  d.begin(null, 0);
  assert.equal(d.observe({ t: GRACE + 1000, hr: 80 }), 'PENDING');
});

test('samples within the grace window are ignored', () => {
  const d = new StabilizationDetector(tuning);
  d.begin({ t: 0, hr: 100 }, 0);
  assert.equal(d.observe({ t: GRACE - 1, hr: 70 }), 'PENDING');
});

test('STABILIZED after enough consecutive recovered samples', () => {
  const d = new StabilizationDetector(tuning);
  d.begin({ t: 0, hr: 100 }, 0);
  let t = GRACE + 1000;
  let last = 'PENDING';
  for (let i = 0; i < tuning.recalStableSamples; i++) {
    last = d.observe({ t, hr: 80 }); // 80 <= peak(100) * (1 - 0.1) = 90 → recovered
    t += 1000;
  }
  assert.equal(last, 'STABILIZED');
});

test('DESTABILIZED when HR keeps climbing past the worsening band', () => {
  const d = new StabilizationDetector(tuning);
  d.begin({ t: 0, hr: 100 }, 0);
  assert.equal(d.observe({ t: GRACE + 1000, hr: 112 }), 'PENDING'); // climbing, streak 1
  assert.equal(d.observe({ t: GRACE + 2000, hr: 116 }), 'DESTABILIZED'); // climbing, streak 2
});

test('metric reflects the latest comparable signal', () => {
  const d = new StabilizationDetector(tuning);
  d.begin({ t: 0, hr: 100 }, 0);
  d.observe({ t: GRACE + 1000, hr: 88 });
  assert.equal(d.metric, 88);
});
