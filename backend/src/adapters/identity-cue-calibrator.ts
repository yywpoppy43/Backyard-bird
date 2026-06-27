/**
 * The default {@link CueCalibrator}: a no-op pass-through. The selected cue is
 * transmitted verbatim. This keeps the cue-wording seam present (so a future
 * personalization layer plugs in without an engine change) while leaving V1
 * behaviour exactly as authored in the corpus.
 */

import type { Cue } from '../domain/cue.ts';
import type { CueCalibrator, CalibrationContext } from '../ports/cue-calibrator.ts';

export class IdentityCueCalibrator implements CueCalibrator {
  calibrate(cue: Cue, _ctx: CalibrationContext): Cue {
    return cue;
  }
}
