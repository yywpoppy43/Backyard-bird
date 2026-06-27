/**
 * Active Friction Voice Companion — backend SDK surface.
 *
 * The framework is headless: construct a {@link SessionEngine} (or use
 * {@link createCompanion}), subscribe to the {@link EngineEvent} stream over an
 * {@link EventBus}, and call `engine.start(config)`. Everything else — state
 * transitions, cue selection, trigger scheduling, TTS dispatch, recalibration —
 * runs internally and surfaces only as events. A UI/mobile client is purely a
 * consumer of those events plus the swappable TTS/Telemetry/Clock adapters.
 */

// ── Domain ──────────────────────────────────────────────────────────────────
export * from './domain/units.ts';
export * from './domain/friction-state.ts';
export * from './domain/cue.ts';
export * from './domain/session.ts';
export * from './domain/events.ts';
export * from './domain/relational.ts';
export * from './domain/personalization.ts';
export * from './domain/friction-condition.ts';

// ── Ports (interfaces / seams) ────────────────────────────────────────────
export * from './ports/clock.ts';
export * from './ports/event-bus.ts';
export * from './ports/tts.ts';
export * from './ports/telemetry-source.ts';
export * from './ports/cue-selector.ts';
export * from './ports/cue-calibrator.ts';
export * from './ports/cue-generator.ts';

// ── Triggers ──────────────────────────────────────────────────────────────
export * from './triggers/trigger.ts';
export * from './triggers/temporal-trigger.ts';
export * from './triggers/biometric-trigger.ts';

// ── Cue Bank ──────────────────────────────────────────────────────────────
export * from './cue-bank/cue-bank.ts';
export * from './cue-bank/seed-cues.ts';
export * from './cue-bank/cue-database.ts';
export * from './cue-bank/safe-defaults.ts';

// ── Engine ────────────────────────────────────────────────────────────────
export * from './engine/stabilization.ts';
export * from './engine/session-engine.ts';

// ── Generative (LLM) ──────────────────────────────────────────────────────
export * from './generative/system-prompt.ts';
export * from './generative/output-vocabulary.ts';
export * from './generative/anthropic-cue-generator.ts';

// ── Adapters ──────────────────────────────────────────────────────────────
export * from './adapters/system-clock.ts';
export * from './adapters/manual-clock.ts';
export * from './adapters/console-tts.ts';
export * from './adapters/recording-tts.ts';
export * from './adapters/mock-telemetry.ts';
export * from './adapters/memory-event-bus.ts';
export * from './adapters/identity-cue-calibrator.ts';

// ── Factory ───────────────────────────────────────────────────────────────
export * from './create-companion.ts';
