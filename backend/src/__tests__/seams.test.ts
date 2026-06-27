import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ManualClock } from '../adapters/manual-clock.ts';
import { MemoryEventBus } from '../adapters/memory-event-bus.ts';
import { RecordingTTS } from '../adapters/recording-tts.ts';
import { createCompanion } from '../create-companion.ts';
import { createSeedCueBank, SEED_CUES } from '../cue-bank/seed-cues.ts';
import { FrictionState } from '../domain/friction-state.ts';
import type { Cue } from '../domain/cue.ts';
import type { CueSelector, SelectionContext } from '../ports/cue-selector.ts';
import type { CueCalibrator, CalibrationContext } from '../ports/cue-calibrator.ts';
import { driveUntilEnded } from './helpers.ts';

const cfg = { lengthMs: 60_000, curve: { kind: 'linear' } as const, maxRounds: 1 };

test('cue-SELECTION seam: a custom selector overrides which cue fires', async () => {
  const pinned = SEED_CUES.find((c) => c.CueID === 'encounter.hold')!;
  const seenSources: string[] = [];

  // Decorator over the default deterministic bank: pin ENCOUNTER to one cue.
  class PinnedSelector implements CueSelector {
    private readonly base = createSeedCueBank();
    select(ctx: SelectionContext): Cue | null {
      if (ctx.targetState === FrictionState.ENCOUNTER) {
        seenSources.push(ctx.source);
        return pinned;
      }
      return this.base.select(ctx);
    }
  }

  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  const tts = new RecordingTTS();
  const { engine } = createCompanion({ clock, bus, tts, cueSelector: new PinnedSelector() });
  engine.start(cfg);
  await driveUntilEnded(clock, bus, { stepMs: 500, maxMs: 120_000 });

  const encounterCues = bus
    .ofType('CUE_SELECTED')
    .filter((e) => e.state === FrictionState.ENCOUNTER)
    .map((e) => e.cue.CueID);
  assert.ok(encounterCues.length >= 1);
  assert.ok(encounterCues.every((id) => id === 'encounter.hold'), 'selector pinned the cue');
  // The seam is not biometric-only: it sees the trigger source (here, TEMPORAL).
  assert.ok(seenSources.includes('TEMPORAL'));
});

test('cue-WORDING seam: a custom calibrator rewords cues, preserving CueID', async () => {
  class SuffixCalibrator implements CueCalibrator {
    calibrate(cue: Cue, ctx: CalibrationContext): Cue {
      return { ...cue, AudioTranscript: `${cue.AudioTranscript} [${ctx.state}]` };
    }
  }

  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  const tts = new RecordingTTS();
  const { engine } = createCompanion({
    clock,
    bus,
    tts,
    cueBank: createSeedCueBank(),
    calibrator: new SuffixCalibrator(),
  });
  engine.start(cfg);
  await driveUntilEnded(clock, bus, { stepMs: 500, maxMs: 120_000 });

  assert.ok(tts.utterances.length >= 4);
  // Every spoken transcript was calibrated…
  for (const u of tts.utterances) {
    assert.match(u.text, /\[(BASELINE|INTENTION|ENCOUNTER|GROWTH)\]$/);
  }
  // …and CueIDs (identity) are still real seed cues.
  const validIds = new Set(SEED_CUES.map((c) => c.CueID));
  for (const u of tts.utterances) assert.ok(validIds.has(u.cueId));
});
