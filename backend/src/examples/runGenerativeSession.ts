/**
 * Demo: the generative fallback. The cue corpus here is deliberately missing
 * GROWTH cues, so when the session reaches GROWTH the engine asks the generator
 * for one. Each spoken cue is tagged database vs generated.
 *
 *   node src/examples/runGenerativeSession.ts
 *
 * For real generation, pass `cueGenerator: new AnthropicCueGenerator()` (reads
 * ANTHROPIC_API_KEY) instead of the local demo generator below. That makes a
 * network call per miss, so it needs the real (system) clock — this offline demo
 * uses a local generator + virtual time so it runs instantly and deterministically.
 */

import { createCompanion } from '../create-companion.ts';
import { ManualClock } from '../adapters/manual-clock.ts';
import { ConsoleTTS } from '../adapters/console-tts.ts';
import { MemoryEventBus } from '../adapters/memory-event-bus.ts';
import { CueBank } from '../cue-bank/cue-bank.ts';
import { SEED_CUES } from '../cue-bank/seed-cues.ts';
import { FrictionState } from '../domain/friction-state.ts';
import type { Cue } from '../domain/cue.ts';
import type { CueGenerator, CueGenerationRequest } from '../ports/cue-generator.ts';
import type { EngineEvent } from '../domain/events.ts';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// Stand-in for AnthropicCueGenerator so the demo runs with no network/key.
const demoGenerator: CueGenerator = {
  async generate(req: CueGenerationRequest): Promise<Cue> {
    return {
      CueID: `gen-${req.state.toLowerCase()}`,
      PrimaryState: req.state,
      PhysicalLever: 'Press one inch past the edge.',
      EnergeticVector: 'Send the breath into the push.',
      StructuralYield: 'The capacity is yours now — take more.',
      AudioTranscript: 'You held. Now reach past it. One inch more, and breathe.',
      DeliveryTone: 'Direct, expansive',
    };
  },
};

function describe(e: EngineEvent): string | null {
  switch (e.type) {
    case 'STATE_CHANGED':
      return `  ↪ ${e.from} → ${e.to}  [round ${e.round}]`;
    case 'CUE_SELECTED':
      return `  • cue ${e.cue.CueID} [${e.origin}] for ${e.state}`;
    case 'SESSION_ENDED':
      return `■ session ended (${e.reason})`;
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  const { engine } = createCompanion({
    clock,
    bus,
    tts: new ConsoleTTS(),
    cueBank: new CueBank(SEED_CUES.filter((c) => c.PrimaryState !== FrictionState.GROWTH)),
    cueGenerator: demoGenerator, // ← swap for `new AnthropicCueGenerator()` in production
  });

  bus.on((e) => {
    const line = describe(e);
    if (line) console.log(line);
  });

  engine.start({ lengthMs: 60_000, curve: { kind: 'linear' }, maxRounds: 1 });
  await tick();
  for (let elapsed = 0; elapsed <= 90_000; elapsed += 500) {
    if (bus.ofType('SESSION_ENDED').length > 0) break;
    clock.advance(500);
    await tick();
  }
}

void main();
