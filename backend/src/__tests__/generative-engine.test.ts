import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ManualClock } from '../adapters/manual-clock.ts';
import { MemoryEventBus } from '../adapters/memory-event-bus.ts';
import { RecordingTTS } from '../adapters/recording-tts.ts';
import { createCompanion } from '../create-companion.ts';
import { CueBank } from '../cue-bank/cue-bank.ts';
import { SEED_CUES } from '../cue-bank/seed-cues.ts';
import { FrictionState } from '../domain/friction-state.ts';
import type { CueGenerator, CueGenerationRequest, GenerationOutcome } from '../ports/cue-generator.ts';
import { driveUntilEnded } from './helpers.ts';

/** A no-network generator that returns a {@link GenerationOutcome}, like the real one. */
class FakeGenerator implements CueGenerator {
  readonly calls: CueGenerationRequest[] = [];
  private readonly mode: 'ok' | 'reject' | 'throw';
  constructor(mode: 'ok' | 'reject' | 'throw' = 'ok') {
    this.mode = mode;
  }
  async generate(request: CueGenerationRequest): Promise<GenerationOutcome> {
    this.calls.push(request);
    if (this.mode === 'throw') throw new Error('generator boom');
    if (this.mode === 'reject') {
      return { cue: null, status: 'rejected', attempts: 2, networkRetries: 0, reason: 'forbidden vocabulary: engine' };
    }
    return {
      cue: {
        CueID: `fake-${request.state.toLowerCase()}`,
        PrimaryState: request.state,
        PhysicalLever: 'Press one inch past the edge.',
        EnergeticVector: 'Channel the breath into the push.',
        StructuralYield: 'The capacity is yours now.',
        AudioTranscript: 'You held. Now take a little more. Open the edge out.',
        DeliveryTone: 'Direct, expansive',
      },
      status: 'ok',
      attempts: 1,
      networkRetries: 0,
    };
  }
}

// A corpus deliberately missing GROWTH cues, to force the generative fallback.
function bankWithoutGrowth(): CueBank {
  return new CueBank(SEED_CUES.filter((c) => c.PrimaryState !== FrictionState.GROWTH));
}

const cfg = { lengthMs: 60_000, curve: { kind: 'linear' } as const, maxRounds: 1 };

test('the LLM generates a cue when the corpus has none for a state', async () => {
  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  const generator = new FakeGenerator('ok');
  const { engine } = createCompanion({
    clock,
    bus,
    tts: new RecordingTTS(),
    cueBank: bankWithoutGrowth(),
    cueGenerator: generator,
  });
  engine.start(cfg);
  await driveUntilEnded(clock, bus, { stepMs: 500, maxMs: 120_000 });

  const selected = bus.ofType('CUE_SELECTED');
  const growth = selected.filter((e) => e.state === FrictionState.GROWTH);
  assert.ok(growth.length >= 1, 'a GROWTH cue was produced');
  assert.ok(growth.every((e) => e.origin === 'generated'), 'GROWTH cue came from the generator');
  assert.ok(growth.every((e) => e.cue.PrimaryState === FrictionState.GROWTH));

  // Database-backed states keep origin "database".
  const baseline = selected.filter((e) => e.state === FrictionState.BASELINE);
  assert.ok(baseline.length >= 1 && baseline.every((e) => e.origin === 'database'));

  // The generator was asked specifically for GROWTH.
  assert.ok(generator.calls.some((c) => c.state === FrictionState.GROWTH));

  // The generative attempt is observable on the stream for tuning.
  const gen = bus.ofType('CUE_GENERATION');
  assert.ok(gen.some((e) => e.state === FrictionState.GROWTH && e.status === 'ok'));
});

test('a rejected generation falls back to a static safe default and continues', async () => {
  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  const { engine } = createCompanion({
    clock,
    bus,
    tts: new RecordingTTS(),
    cueBank: bankWithoutGrowth(),
    cueGenerator: new FakeGenerator('reject'),
  });
  engine.start(cfg);
  await driveUntilEnded(clock, bus, { stepMs: 500, maxMs: 120_000 });

  // The rejected attempt is observable...
  assert.ok(bus.ofType('CUE_GENERATION').some((e) => e.status === 'rejected'));
  // ...and the engine never goes quiet: it speaks the safe default for GROWTH.
  assert.ok(bus.ofType('ERROR').some((e) => e.scope === 'cue-fallback'));
  const growth = bus.ofType('CUE_SELECTED').filter((e) => e.state === FrictionState.GROWTH);
  assert.ok(growth.length >= 1, 'a GROWTH cue was still produced');
  assert.ok(growth.every((e) => e.origin === 'fallback' && e.cue.CueID === 'safe-growth'));
  assert.ok(bus.ofType('CUE_SPOKEN').some((e) => e.cueId === 'safe-growth'), 'the fallback was actually spoken');
  assert.equal(bus.ofType('SESSION_ENDED').length, 1);
});

test('a throwing generator is caught, reported, and falls back to a safe default', async () => {
  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  const { engine } = createCompanion({
    clock,
    bus,
    tts: new RecordingTTS(),
    cueBank: bankWithoutGrowth(),
    cueGenerator: new FakeGenerator('throw'),
  });
  engine.start(cfg);
  await driveUntilEnded(clock, bus, { stepMs: 500, maxMs: 120_000 });

  // An unexpected throw is converted into an observable error outcome...
  assert.ok(bus.ofType('CUE_GENERATION').some((e) => e.status === 'error' && /threw/.test(e.reason ?? '')));
  // ...and still falls back rather than stranding the session.
  assert.ok(bus.ofType('ERROR').some((e) => e.scope === 'cue-fallback'));
  const growth = bus.ofType('CUE_SELECTED').filter((e) => e.state === FrictionState.GROWTH);
  assert.ok(growth.length >= 1 && growth.every((e) => e.origin === 'fallback'));
  assert.equal(bus.ofType('SESSION_ENDED').length, 1);
});

test('with no generator, a missing-state cue still falls back to a safe default (never silent)', async () => {
  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  const { engine } = createCompanion({
    clock,
    bus,
    tts: new RecordingTTS(),
    cueBank: bankWithoutGrowth(),
    // no cueGenerator at all
  });
  engine.start(cfg);
  await driveUntilEnded(clock, bus, { stepMs: 500, maxMs: 120_000 });

  assert.equal(bus.ofType('CUE_GENERATION').length, 0, 'no generator was consulted');
  assert.ok(bus.ofType('ERROR').some((e) => e.scope === 'cue-fallback'));
  const growth = bus.ofType('CUE_SELECTED').filter((e) => e.state === FrictionState.GROWTH);
  assert.ok(growth.length >= 1 && growth.every((e) => e.origin === 'fallback' && e.cue.CueID === 'safe-growth'));
  assert.equal(bus.ofType('SESSION_ENDED').length, 1);
});
