/**
 * Text-to-Speech port — PRD §5 "Transmit".
 *
 * "Text-to-Speech (TTS) engine delivers the cue with sharp, unpadded vocal
 * execution."
 *
 * The engine depends only on this interface; a concrete adapter wraps a cloud
 * TTS API, an on-device synthesizer, or (for tests) a recorder. The
 * {@link AbortSignal} lets the engine cancel an in-flight utterance when the
 * session ends mid-transmission.
 */

import type { Millis } from '../domain/units.ts';

export interface TtsRequest {
  /** CueID being spoken (for correlation/telemetry). */
  cueId: string;
  /** The exact transcript to vocalize. */
  text: string;
  /** Delivery tone hint, passed through from the Cue. */
  tone: string;
}

export interface TtsResult {
  cueId: string;
  /** False if synthesis failed in a recoverable way. */
  ok: boolean;
  /** How long the utterance lasts, in ms (used by the engine for pacing). */
  durationMs: Millis;
}

export interface TTS {
  /**
   * Speak a request. Resolves when delivery completes (or is meaningfully
   * dispatched). Rejects only on unrecoverable error; recoverable failures
   * should resolve with `ok: false`. Should honour `signal` for cancellation.
   */
  speak(request: TtsRequest, signal?: AbortSignal): Promise<TtsResult>;
}
