import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SAFE_DEFAULT_CUES, safeDefaultCue } from '../cue-bank/safe-defaults.ts';
import { isCue } from '../domain/cue.ts';
import { FRICTION_STATES } from '../domain/friction-state.ts';
import { findForbiddenVocabulary, isSpeakable } from '../generative/output-vocabulary.ts';

test('every state has a valid, vocabulary-clean safe default', () => {
  for (const state of FRICTION_STATES) {
    const cue = safeDefaultCue(state);
    assert.ok(isCue(cue), `safe default for ${state} is a valid Cue`);
    assert.equal(cue.PrimaryState, state, `safe default for ${state} is keyed to its own state`);
    // The fallback of last resort must itself pass the spoken-vocabulary guard.
    assert.ok(
      isSpeakable(cue.AudioTranscript),
      `safe default for ${state} leaked: ${findForbiddenVocabulary(cue.AudioTranscript).join(', ')}`,
    );
  }
});

test('safe defaults have unique CueIDs', () => {
  const ids = FRICTION_STATES.map((s) => SAFE_DEFAULT_CUES[s].CueID);
  assert.equal(new Set(ids).size, ids.length, 'CueIDs are unique');
});
