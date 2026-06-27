/**
 * Convenience factory that wires the engine to sensible default adapters. Pass
 * overrides to swap in real adapters (cloud TTS, a wearable telemetry source) or
 * test doubles (ManualClock, RecordingTTS, MockTelemetrySource).
 *
 * Note on tuning: lifecycle + recalibration tuning is read from
 * `SessionConfig.tuning` at `engine.start()`. Biometric *detection* thresholds
 * live on the {@link BiometricTrigger} and are fixed at construction; pass
 * `biometricTuning` here to override them.
 */

import type { Clock } from './ports/clock.ts';
import type { TTS } from './ports/tts.ts';
import type { EventBus } from './ports/event-bus.ts';
import type { TelemetrySource } from './ports/telemetry-source.ts';
import type { CueSelector } from './ports/cue-selector.ts';
import type { CueCalibrator } from './ports/cue-calibrator.ts';
import type { CueGenerator } from './ports/cue-generator.ts';
import { resolveTuning, type EngineTuning } from './domain/session.ts';
import { SystemClock } from './adapters/system-clock.ts';
import { ConsoleTTS } from './adapters/console-tts.ts';
import { MemoryEventBus } from './adapters/memory-event-bus.ts';
import { TemporalTrigger, type TippingPersonalization } from './triggers/temporal-trigger.ts';
import { BiometricTrigger } from './triggers/biometric-trigger.ts';
import { CueBank } from './cue-bank/cue-bank.ts';
import { createDatabaseCueBank } from './cue-bank/cue-database.ts';
import { SessionEngine } from './engine/session-engine.ts';

export interface CreateCompanionOptions {
  clock?: Clock;
  tts?: TTS;
  bus?: EventBus;
  cueBank?: CueBank;
  /** Cue-selection seam override (a personalization layer). Defaults to `cueBank`. */
  cueSelector?: CueSelector;
  /** Cue-wording seam override (a personalization layer). Defaults to identity. */
  calibrator?: CueCalibrator;
  /** Generative fallback (e.g. AnthropicCueGenerator). When set, the engine
   *  generates a cue if the corpus has none for a state. Off by default. */
  cueGenerator?: CueGenerator;
  /** Trigger-timing seam override (a personalization layer). Defaults to V1 timing. */
  tippingPersonalization?: TippingPersonalization;
  /** Biometric source; supplying it (or `withBiometrics`) builds a BiometricTrigger. */
  telemetry?: TelemetrySource;
  /** Force-build the biometric trigger even without supplying a telemetry source. */
  withBiometrics?: boolean;
  /** Overrides for biometric detection thresholds. */
  biometricTuning?: Partial<EngineTuning>;
}

export interface Companion {
  engine: SessionEngine;
  bus: EventBus;
  clock: Clock;
  cueBank: CueBank;
  temporal: TemporalTrigger;
  biometric: BiometricTrigger | undefined;
}

export function createCompanion(options: CreateCompanionOptions = {}): Companion {
  const clock = options.clock ?? new SystemClock();
  const bus = options.bus ?? new MemoryEventBus();
  const tts = options.tts ?? new ConsoleTTS();
  const cueBank = options.cueBank ?? createDatabaseCueBank();
  const temporal = new TemporalTrigger(clock, options.tippingPersonalization);
  const biometric =
    options.withBiometrics || options.telemetry
      ? new BiometricTrigger(clock, resolveTuning(options.biometricTuning))
      : undefined;

  const engine = new SessionEngine({
    clock,
    tts,
    bus,
    cueSelector: options.cueSelector ?? cueBank,
    calibrator: options.calibrator,
    cueGenerator: options.cueGenerator,
    temporal,
    biometric,
    telemetry: options.telemetry,
  });

  return { engine, bus, clock, cueBank, temporal, biometric };
}
