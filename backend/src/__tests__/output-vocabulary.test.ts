import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findForbiddenVocabulary, isSpeakable } from '../generative/output-vocabulary.ts';

test('clean somatic language passes the guard', () => {
  const clean = 'Feel that shake. Stay in it. Breathe low and keep your shoulders down.';
  assert.deepEqual(findForbiddenVocabulary(clean), []);
  assert.equal(isSpeakable(clean), true);
});

test('internal architectural vocabulary is caught', () => {
  for (const word of ['apparatus', 'Engine', 'the Pilot', 'operator', 'life force', 'soul']) {
    assert.ok(
      findForbiddenVocabulary(`Hold steady, ${word}.`).length > 0,
      `should flag "${word}"`,
    );
  }
});

test('framework/clinical terms and "structure" jargon are caught', () => {
  assert.ok(findForbiddenVocabulary('Stay in the structure.').length > 0);
  assert.ok(findForbiddenVocabulary('Override the cognitive escape.').length > 0);
  assert.ok(findForbiddenVocabulary('Your nervous system is fine.').length > 0);
});

test('generic motivation phrases are caught', () => {
  assert.ok(findForbiddenVocabulary("You can do it!").length > 0);
  assert.ok(findForbiddenVocabulary('Almost there, push through.').length > 0);
  assert.ok(findForbiddenVocabulary('dig deep').length > 0);
});

test('common somatic words near forbidden stems are not over-flagged', () => {
  // "drive", "anchor", "breathe", "spine" are allowed and must not trip the guard.
  const clean = 'Drive into the muscle. Anchor your hips. Lengthen your spine and breathe.';
  assert.deepEqual(findForbiddenVocabulary(clean), []);
});
