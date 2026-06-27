import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ManualClock } from '../adapters/manual-clock.ts';
import { MemoryEventBus } from '../adapters/memory-event-bus.ts';
import { RecordingTTS } from '../adapters/recording-tts.ts';
import { createCompanion } from '../create-companion.ts';
import { CueBank } from '../cue-bank/cue-bank.ts';
import { SEED_CUES } from '../cue-bank/seed-cues.ts';
import { FrictionState } from '../domain/friction-state.ts';
import type { Cue } from '../domain/cue.ts';
import type { CueGenerator, CueGenerationRequest } from '../ports/cue-generator.ts';
import { driveUntilEnded } from './helpers.ts';

/** A no-network generator that returns a canned cue for the requested state. */
class FakeGenerator implements CueGenerator {
  readonly calls: CueGenerationRequest[] = [];
  private readonly mode: 'ok' | 'null' | 'throw';
  constructor(mode: 'ok' | 'null' | 'throw' = 'ok') {
    this.mode = mode;
  }
  async generate(request: CueGenerationRequest): Promise<Cue | null> {
    this.calls.push(request);
    if (this.mode === 'throw') throw new Error('generator boom');
    if (this.mode === 'null') return null;
    return {
      CueID: `fake-${request.state.toLowerCase()}`,
      PrimaryState: request.state,
      PhysicalLever: 'Press one inch past the edge.',
      EnergeticVector: 'Channel the breath into the push.',
      StructuralYield: 'The capacity is yours now.',
      AudioTranscript: 'You held. Now take a little more. Push the edge out.',
      DeliveryTone: 'Direct, expansive',
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
});

test('a generator returning null leaves a recoverable error and the session continues', async () => {
  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  const { engine } = createCompanion({
    clock,
    bus,
    tts: new RecordingTTS(),
    cueBank: bankWithoutGrowth(),
    cueGenerator: new FakeGenerator('null'),
  });
  engine.start(cfg);
  await driveUntilEnded(clock, bus, { stepMs: 500, maxMs: 120_000 });

  assert.ok(bus.ofType('ERROR').some((e) => e.scope === 'cue-bank'));
  assert.equal(bus.ofType('SESSION_ENDED').length, 1);
});

test('a throwing generator surfaces a recoverable error and the session continues', async () => {
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

  assert.ok(bus.ofType('ERROR').some((e) => e.scope === 'cue-generator'));
  assert.equal(bus.ofType('SESSION_ENDED').length, 1);
});
