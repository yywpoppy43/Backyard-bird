import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FrictionState,
  FrictionEvent,
  nextState,
  canTransition,
  legalEvents,
  IllegalTransitionError,
  FRICTION_STATES,
} from '../domain/friction-state.ts';

test('the four PRD states exist in stage order', () => {
  assert.deepEqual(FRICTION_STATES, ['BASELINE', 'INTENTION', 'ENCOUNTER', 'GROWTH']);
});

test('legal transitions follow the PRD lifecycle', () => {
  assert.equal(nextState(FrictionState.BASELINE, FrictionEvent.ADVANCE), FrictionState.INTENTION);
  assert.equal(
    nextState(FrictionState.INTENTION, FrictionEvent.TIPPING_POINT_DETECTED),
    FrictionState.ENCOUNTER,
  );
  assert.equal(nextState(FrictionState.ENCOUNTER, FrictionEvent.STABILIZED), FrictionState.GROWTH);
  assert.equal(
    nextState(FrictionState.ENCOUNTER, FrictionEvent.DESTABILIZED),
    FrictionState.ENCOUNTER,
    'DESTABILIZED is a self-loop (re-cue, escalate)',
  );
  assert.equal(nextState(FrictionState.GROWTH, FrictionEvent.NEXT_ROUND), FrictionState.INTENTION);
});

test('illegal transitions throw IllegalTransitionError', () => {
  assert.throws(
    () => nextState(FrictionState.BASELINE, FrictionEvent.STABILIZED),
    IllegalTransitionError,
  );
  assert.throws(
    () => nextState(FrictionState.GROWTH, FrictionEvent.TIPPING_POINT_DETECTED),
    IllegalTransitionError,
  );
  assert.throws(
    () => nextState(FrictionState.INTENTION, FrictionEvent.NEXT_ROUND),
    IllegalTransitionError,
  );
});

test('canTransition mirrors the table', () => {
  assert.equal(canTransition(FrictionState.BASELINE, FrictionEvent.ADVANCE), true);
  assert.equal(canTransition(FrictionState.BASELINE, FrictionEvent.STABILIZED), false);
});

test('legalEvents lists exactly the allowed events for a state', () => {
  assert.deepEqual(legalEvents(FrictionState.ENCOUNTER).sort(), ['DESTABILIZED', 'STABILIZED']);
  assert.deepEqual(legalEvents(FrictionState.BASELINE), ['ADVANCE']);
});
