import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ManualClock } from '../adapters/manual-clock.ts';
import { MemoryEventBus } from '../adapters/memory-event-bus.ts';
import { RecordingTTS } from '../adapters/recording-tts.ts';
import { MockTelemetrySource, buildSampleStream, type ScriptedSample } from '../adapters/mock-telemetry.ts';
import { createCompanion } from '../create-companion.ts';
import { ConfigError, type SessionConfig } from '../domain/session.ts';
import { driveUntilEnded, tick } from './helpers.ts';

test('a V1 session runs the full PRD §5 loop and visits every state', async () => {
  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  const tts = new RecordingTTS();
  const { engine } = createCompanion({ clock, bus, tts });

  engine.start({ lengthMs: 60_000, curve: { kind: 'linear' }, maxRounds: 2 });
  await driveUntilEnded(clock, bus, { stepMs: 500, maxMs: 180_000 });

  assert.equal(bus.ofType('SESSION_STARTED').length, 1);
  assert.equal(bus.ofType('SESSION_ENDED').length, 1);
  assert.ok(bus.ofType('TIPPING_POINT').length >= 1);
  assert.equal(bus.ofType('ROUND_CLEARED').length, 2);

  const states = new Set(bus.ofType('STATE_CHANGED').flatMap((e) => [e.from, e.to]));
  for (const s of ['BASELINE', 'INTENTION', 'ENCOUNTER', 'GROWTH']) {
    assert.ok(states.has(s as never), `visited ${s}`);
  }

  // Every cue pulled matches the state it was selected for, and all four states
  // produced a cue (the default corpus is the master database).
  const selected = bus.ofType('CUE_SELECTED');
  for (const e of selected) {
    assert.equal(e.cue.PrimaryState, e.state, `cue ${e.cue.CueID} matches state ${e.state}`);
  }
  const cuedStates = new Set(selected.map((e) => e.state));
  for (const s of ['BASELINE', 'INTENTION', 'ENCOUNTER', 'GROWTH']) {
    assert.ok(cuedStates.has(s as never), `pulled a ${s} cue`);
  }
});

test('a V2 session is triggered by a biometric redline', async () => {
  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  const tts = new RecordingTTS();

  const resting = buildSampleStream(20, 1000, () => ({ hr: 70, hrvMs: 60, quality: 1 }));
  const spike: ScriptedSample[] = [];
  for (let i = 0; i < 6; i++) {
    spike.push({ atMs: (20 + i) * 1000, sample: { hr: 96 + i, hrvMs: 38, quality: 1 } });
  }
  const recovery: ScriptedSample[] = [];
  for (let i = 0; i < 12; i++) {
    recovery.push({ atMs: (26 + i) * 1000, sample: { hr: 74 - i, hrvMs: 55 + i, quality: 1 } });
  }
  const telemetry = new MockTelemetrySource(clock, [...resting, ...spike, ...recovery]);
  const { engine } = createCompanion({ clock, bus, tts, telemetry });

  engine.start({
    lengthMs: 120_000,
    curve: { kind: 'linear' },
    enableBiometrics: true,
    maxRounds: 1,
    difficultyThresholds: [0.99], // keep the temporal tip far away so biometrics win
  });
  await driveUntilEnded(clock, bus, { stepMs: 500, maxMs: 180_000 });

  const tips = bus.ofType('TIPPING_POINT');
  assert.ok(tips.some((t) => t.source === 'BIOMETRIC'), 'a biometric tip fired');
  assert.equal(bus.ofType('ROUND_CLEARED').length, 1);
});

test('the session recovers from a TTS failure without stranding', async () => {
  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  // Fail the first utterance (the BASELINE anchor) regardless of corpus.
  let failedFirst = false;
  const tts = new RecordingTTS({
    failOn: () => {
      if (failedFirst) return false;
      failedFirst = true;
      return true;
    },
  });
  const { engine } = createCompanion({ clock, bus, tts });

  engine.start({ lengthMs: 60_000, curve: { kind: 'linear' }, maxRounds: 1 });
  await driveUntilEnded(clock, bus, { stepMs: 500, maxMs: 120_000 });

  const ttsErrors = bus.ofType('ERROR').filter((e) => e.scope === 'tts');
  assert.ok(ttsErrors.length >= 1, 'emitted a recoverable TTS error');
  assert.equal(bus.ofType('SESSION_ENDED').length, 1, 'still completed the session');
  assert.ok(bus.ofType('ROUND_CLEARED').length >= 1, 'still cleared a round');
});

test('stop() ends the session immediately and idempotently', async () => {
  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  const { engine } = createCompanion({ clock, bus, tts: new RecordingTTS() });

  engine.start({ lengthMs: 60_000, curve: { kind: 'linear' } });
  await tick();
  engine.stop();
  engine.stop(); // idempotent

  const ended = bus.ofType('SESSION_ENDED');
  assert.equal(ended.length, 1);
  assert.equal(ended[0]!.reason, 'stopped');
  assert.equal(engine.isRunning, false);
});

test('invalid config is rejected before any side effect', () => {
  const bus = new MemoryEventBus();
  const { engine } = createCompanion({ clock: new ManualClock(), bus, tts: new RecordingTTS() });
  assert.throws(() => engine.start({ lengthMs: 0, curve: { kind: 'linear' } }), ConfigError);
  assert.equal(bus.log.length, 0, 'no events emitted on invalid start');
});

test('start() throws if already running', () => {
  const { engine } = createCompanion({ clock: new ManualClock(), tts: new RecordingTTS() });
  const cfg: SessionConfig = { lengthMs: 60_000, curve: { kind: 'linear' } };
  engine.start(cfg);
  assert.throws(() => engine.start(cfg), /already running/);
  engine.stop();
});

test('two identical V1 sessions produce identical event + cue sequences', async () => {
  async function run(): Promise<{ seq: string[]; spoken: string[] }> {
    const clock = new ManualClock();
    const bus = new MemoryEventBus();
    const tts = new RecordingTTS();
    const { engine } = createCompanion({ clock, bus, tts });
    engine.start({ lengthMs: 60_000, curve: { kind: 'ramp', peakAt: 0.9 }, maxRounds: 3 });
    await driveUntilEnded(clock, bus, { stepMs: 500, maxMs: 180_000 });
    const seq = bus.log.map((e) =>
      e.type === 'STATE_CHANGED' ? `${e.type}:${e.from}->${e.to}` : e.type,
    );
    return { seq, spoken: tts.spokenCueIds };
  }
  const a = await run();
  const b = await run();
  assert.deepEqual(a.seq, b.seq);
  assert.deepEqual(a.spoken, b.spoken);
});
