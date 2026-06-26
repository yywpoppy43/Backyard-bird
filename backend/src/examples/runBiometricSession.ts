/**
 * Demo: a V2 Biometric Telemetry session. A scripted heart-rate stream warms up
 * a resting baseline, then spikes — redlining the Engine and triggering an
 * ENCOUNTER intervention precisely on the spike (PRD §4 V2). Recovery samples
 * then drive stabilization → GROWTH.
 *
 *   node src/examples/runBiometricSession.ts
 */

import { createCompanion } from '../create-companion.ts';
import { ManualClock } from '../adapters/manual-clock.ts';
import { ConsoleTTS } from '../adapters/console-tts.ts';
import { MemoryEventBus } from '../adapters/memory-event-bus.ts';
import { MockTelemetrySource, buildSampleStream, type ScriptedSample } from '../adapters/mock-telemetry.ts';
import type { EngineEvent } from '../domain/events.ts';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const SAMPLE_EVERY = 1_000;

function buildScript(): ScriptedSample[] {
  // 20 resting samples (~hr 70, hrv 60), then a spike block, then recovery.
  const resting = buildSampleStream(20, SAMPLE_EVERY, () => ({ hr: 70, hrvMs: 60, quality: 1 }));
  const spike: ScriptedSample[] = [];
  for (let i = 0; i < 10; i++) {
    spike.push({ atMs: (20 + i) * SAMPLE_EVERY, sample: { hr: 92 + i, hrvMs: 38 - i, quality: 1 } });
  }
  const recovery: ScriptedSample[] = [];
  for (let i = 0; i < 12; i++) {
    recovery.push({ atMs: (30 + i) * SAMPLE_EVERY, sample: { hr: 78 - i, hrvMs: 55 + i, quality: 1 } });
  }
  return [...resting, ...spike, ...recovery];
}

function describe(e: EngineEvent): string | null {
  switch (e.type) {
    case 'SESSION_STARTED':
      return '▶ biometric session started';
    case 'STATE_CHANGED':
      return `  ↪ ${e.from} → ${e.to}  [round ${e.round}]`;
    case 'TIPPING_POINT':
      return `  ⚡ REDLINE via ${e.source} (${e.reason}, intensity ${e.intensity.toFixed(2)})`;
    case 'RECALIBRATED':
      return `  ↺ recalibrated — ${e.stabilized ? 'STABILIZED' : 're-cue'} (metric ${e.metric ?? 'n/a'})`;
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
  const telemetry = new MockTelemetrySource(clock, buildScript());
  const { engine } = createCompanion({ clock, bus, tts: new ConsoleTTS(), telemetry });

  bus.on((e) => {
    const line = describe(e);
    if (line) console.log(line);
  });

  engine.start({
    lengthMs: 60_000, // short 60s window
    curve: { kind: 'linear' },
    enableBiometrics: true, // V2
    maxRounds: 1,
  });

  await tick();
  const stepMs = 500;
  for (let elapsed = 0; elapsed <= 90_000; elapsed += stepMs) {
    if (bus.ofType('SESSION_ENDED').length > 0) break;
    clock.advance(stepMs);
    await tick();
  }
}

void main();
