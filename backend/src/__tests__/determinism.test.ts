import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FrictionState } from '../domain/friction-state.ts';
import { deriveRelationalTarget } from '../domain/relational.ts';
import { createSeedCueBank } from '../cue-bank/seed-cues.ts';
import type { SelectionContext } from '../ports/cue-selector.ts';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, acc);
    else if (entry.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

test('the framework contains no nondeterministic randomness in src/', () => {
  const offenders: string[] = [];
  for (const file of collectSourceFiles(srcRoot)) {
    const text = readFileSync(file, 'utf8');
    // Match call syntax so prose in doc comments is not flagged.
    if (/Math\.random\s*\(/.test(text)) offenders.push(`${file} (Math.random)`);
    // Date.now() is permitted only in the SystemClock adapter (the time seam).
    if (!file.endsWith('system-clock.ts') && /Date\.now\s*\(/.test(text)) {
      offenders.push(`${file} (Date.now)`);
    }
  }
  assert.deepEqual(offenders, [], `nondeterministic source found: ${offenders.join(', ')}`);
});

test('cue selection is reproducible across repeated calls', () => {
  const bank = createSeedCueBank();
  const states = [
    FrictionState.BASELINE,
    FrictionState.INTENTION,
    FrictionState.ENCOUNTER,
    FrictionState.GROWTH,
  ];
  for (const state of states) {
    const ctx: SelectionContext = {
      targetState: state,
      source: 'INIT',
      intensity: 0.8,
      round: 2,
      now: 1234,
      lastCueId: null,
      recentCueIds: [],
      target: deriveRelationalTarget(state, 0.8, {}),
      lastSpokenAt: new Map(),
    };
    const first = bank.select(ctx)?.CueID;
    for (let i = 0; i < 5; i++) {
      assert.equal(bank.select(ctx)?.CueID, first, `stable selection for ${state}`);
    }
  }
});
