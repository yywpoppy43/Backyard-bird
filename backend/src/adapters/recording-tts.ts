/**
 * A capturing {@link TTS} for tests. Records every request and can inject
 * recoverable failures to exercise the engine's TTS-failure recovery path.
 */

import type { TTS, TtsRequest, TtsResult } from '../ports/tts.ts';

export interface RecordingTtsOptions {
  /** Return true to make `speak` reject for a given request. */
  failOn?: (request: TtsRequest) => boolean;
  /** Reported utterance duration. */
  durationMs?: number;
}

export class RecordingTTS implements TTS {
  readonly utterances: TtsRequest[] = [];
  private readonly opts: RecordingTtsOptions;

  constructor(opts: RecordingTtsOptions = {}) {
    this.opts = opts;
  }

  async speak(request: TtsRequest, signal?: AbortSignal): Promise<TtsResult> {
    this.utterances.push({ ...request });
    if (signal?.aborted) throw new Error('aborted');
    if (this.opts.failOn?.(request)) {
      throw new Error(`injected TTS failure for ${request.cueId}`);
    }
    return { cueId: request.cueId, ok: true, durationMs: this.opts.durationMs ?? 1_000 };
  }

  /** CueIDs spoken so far, in order. */
  get spokenCueIds(): string[] {
    return this.utterances.map((u) => u.cueId);
  }
}
