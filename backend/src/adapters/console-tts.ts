/**
 * A logging {@link TTS} stub — PRD §5 "Transmit".
 *
 * Stands in for a real synthesizer: it prints the cue and reports a plausible
 * `durationMs` derived from the transcript length. Swap for a cloud/on-device
 * TTS adapter implementing the same port. Resolves synchronously (no real
 * delay); the engine paces everything through the {@link Clock}.
 */

import type { TTS, TtsRequest, TtsResult } from '../ports/tts.ts';

export interface ConsoleTtsOptions {
  /** Sink for the rendered line (defaults to `console.log`). */
  log?: (line: string) => void;
  /** Approximate speaking rate, ms per character. */
  msPerChar?: number;
}

export class ConsoleTTS implements TTS {
  private readonly log: (line: string) => void;
  private readonly msPerChar: number;

  constructor(opts: ConsoleTtsOptions = {}) {
    this.log = opts.log ?? ((line) => console.log(line));
    this.msPerChar = opts.msPerChar ?? 55;
  }

  async speak(request: TtsRequest): Promise<TtsResult> {
    const durationMs = Math.max(800, Math.round(request.text.length * this.msPerChar));
    this.log(`[TTS · ${request.tone}] ${request.text}`);
    return { cueId: request.cueId, ok: true, durationMs };
  }
}
