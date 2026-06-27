/**
 * Cue-WORDING seam.
 *
 * After a cue is selected and before it is transmitted, the engine passes it
 * through a {@link CueCalibrator}. The default is a no-op (identity) pass-through
 * — see {@link IdentityCueCalibrator} — so V1 behaviour is unchanged.
 *
 * A future personalization layer can drop in a calibrator (constructed with a
 * user profile) to adjust *how a cue is phrased and toned* for a specific user,
 * without any engine change. A calibrator MUST preserve `CueID` (it changes
 * wording/tone, not identity), so cue history and rotation stay coherent.
 */

import type { Cue } from '../domain/cue.ts';
import type { FrictionState } from '../domain/friction-state.ts';
import type { TriggerSource } from '../triggers/trigger.ts';

export interface CalibrationContext {
  state: FrictionState;
  /** Why this cue is firing: a proactive lifecycle cue ('INIT') or a trigger. */
  source: TriggerSource | 'INIT';
  intensity: number;
  round: number;
}

export interface CueCalibrator {
  /** Return the cue to transmit — possibly a reworded copy. Must keep `CueID`. */
  calibrate(cue: Cue, ctx: CalibrationContext): Cue;
}
