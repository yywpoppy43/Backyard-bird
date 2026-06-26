/** Shared test utilities (not a test file itself). */

import type { ManualClock } from '../adapters/manual-clock.ts';
import type { MemoryEventBus } from '../adapters/memory-event-bus.ts';

/** Flush the microtask queue (lets awaited TTS continuations run). */
export const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Drive a ManualClock-backed engine to SESSION_ENDED, flushing async
 * continuations between virtual-time steps.
 */
export async function driveUntilEnded(
  clock: ManualClock,
  bus: MemoryEventBus,
  opts: { stepMs?: number; maxMs?: number } = {},
): Promise<void> {
  const stepMs = opts.stepMs ?? 500;
  const maxMs = opts.maxMs ?? 60 * 60 * 1000;
  await tick(); // flush the synchronous start() baseline cue
  let elapsed = 0;
  while (elapsed < maxMs) {
    if (bus.ofType('SESSION_ENDED').length > 0) return;
    clock.advance(stepMs);
    await tick();
    elapsed += stepMs;
  }
}
