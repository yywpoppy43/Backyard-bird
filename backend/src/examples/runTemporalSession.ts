/**
 * Demo: a V1 Temporal Friction Mapping session, run end-to-end under virtual
 * time so it prints instantly. Shows the full PRD §5 loop across several rounds.
 *
 *   node src/examples/runTemporalSession.ts
 */

import { createCompanion } from '../create-companion.ts';
import { ManualClock } from '../adapters/manual-clock.ts';
import { ConsoleTTS } from '../adapters/console-tts.ts';
import { MemoryEventBus } from '../adapters/memory-event-bus.ts';
import type { EngineEvent } from '../domain/events.ts';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function describe(e: EngineEvent): string | null {
  switch (e.type) {
    case 'SESSION_STARTED':
      return `▶ session started (${e.config.lengthMs / 60000}-min ${e.config.curve.kind} curve)`;
    case 'STATE_CHANGED':
      return `  ↪ ${e.from} → ${e.to}  [round ${e.round}]`;
    case 'TIPPING_POINT':
      return `  ⚡ tipping point via ${e.source} (intensity ${e.intensity.toFixed(2)}, ${e.reason})`;
    case 'RECALIBRATED':
      return `  ↺ recalibrated — ${e.stabilized ? 'STABILIZED' : 're-cue'}`;
    case 'ROUND_CLEARED':
      return `  ✓ round ${e.round} cleared`;
    case 'SESSION_ENDED':
      return `■ session ended (${e.reason}) after ${e.rounds} round(s)`;
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const clock = new ManualClock();
  const bus = new MemoryEventBus();
  const { engine } = createCompanion({ clock, bus, tts: new ConsoleTTS() });

  bus.on((e) => {
    const line = describe(e);
    if (line) console.log(line);
  });

  engine.start({
    lengthMs: 20 * 60_000, // 20-minute session
    curve: { kind: 'ramp', peakAt: 0.9 }, // a long, sustained climb
    enableBiometrics: false, // V1
    maxRounds: 4,
  });

  // Drive virtual time to the end, flushing async TTS continuations each step.
  await tick();
  const stepMs = 1_000;
  for (let elapsed = 0; elapsed <= 22 * 60_000; elapsed += stepMs) {
    if (bus.ofType('SESSION_ENDED').length > 0) break;
    clock.advance(stepMs);
    await tick();
  }
}

void main();
