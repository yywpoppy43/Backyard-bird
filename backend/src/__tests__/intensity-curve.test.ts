import { test } from 'node:test';
import assert from 'node:assert/strict';

import { intensityAt, validateCurve, ConfigError } from '../domain/session.ts';

test('linear curve maps progress to intensity', () => {
  assert.equal(intensityAt({ kind: 'linear' }, 0), 0);
  assert.equal(intensityAt({ kind: 'linear' }, 0.5), 0.5);
  assert.equal(intensityAt({ kind: 'linear' }, 1), 1);
});

test('progress is clamped to [0,1]', () => {
  assert.equal(intensityAt({ kind: 'linear' }, -1), 0);
  assert.equal(intensityAt({ kind: 'linear' }, 2), 1);
});

test('ramp rises to 1 by peakAt, then holds', () => {
  const ramp = { kind: 'ramp', peakAt: 0.5 } as const;
  assert.equal(intensityAt(ramp, 0.25), 0.5);
  assert.equal(intensityAt(ramp, 0.5), 1);
  assert.equal(intensityAt(ramp, 0.9), 1);
});

test('interval is a sawtooth peaking mid-segment', () => {
  const interval = { kind: 'interval', segments: 2 } as const;
  assert.equal(intensityAt(interval, 0.125), 0.5); // rising in first hump
  assert.equal(intensityAt(interval, 0.25), 1); // first hump peak
  assert.equal(intensityAt(interval, 0.75), 1); // second hump peak
});

test('custom curve interpolates piecewise-linearly', () => {
  const custom = {
    kind: 'custom',
    points: [
      { at: 0, intensity: 0 },
      { at: 0.5, intensity: 1 },
      { at: 1, intensity: 0 },
    ],
  } as const;
  assert.equal(intensityAt(custom, 0.25), 0.5);
  assert.equal(intensityAt(custom, 0.5), 1);
  assert.equal(intensityAt(custom, 0.75), 0.5);
});

test('validateCurve rejects malformed curves', () => {
  assert.throws(() => validateCurve({ kind: 'ramp', peakAt: 2 }), ConfigError);
  assert.throws(() => validateCurve({ kind: 'interval', segments: 0 }), ConfigError);
  assert.throws(() => validateCurve({ kind: 'custom', points: [{ at: 0, intensity: 0 }] }), ConfigError);
  assert.throws(
    () =>
      validateCurve({
        kind: 'custom',
        points: [
          { at: 0.5, intensity: 0 },
          { at: 0.5, intensity: 1 },
        ],
      }),
    ConfigError,
    'non-increasing points rejected',
  );
});
