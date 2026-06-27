/**
 * The Master Engine Database — the primary cue corpus (PRD "Asset 1").
 *
 * The 20 verified foundational cues live in a local JSON store
 * (`cue-database.json`), matching the {@link Cue} schema exactly. They are loaded
 * through {@link CueBank.fromJson}, which validates every entry on load (a
 * malformed store throws `InvalidCueError` at startup, never mid-session).
 *
 * This bank is the default corpus wired into {@link createCompanion}, so when the
 * engine enters a state it pulls a cue of that state from this list — e.g.
 * entering ENCOUNTER pulls an ENCOUNTER cue.
 */

import { readFileSync } from 'node:fs';
import { CueBank } from './cue-bank.ts';

/** Location of the JSON store, resolved relative to this module. */
const DATABASE_URL = new URL('./cue-database.json', import.meta.url);

/** Read and parse the raw master-database JSON (unvalidated). */
export function loadCueDatabaseJson(): unknown {
  return JSON.parse(readFileSync(DATABASE_URL, 'utf8'));
}

/**
 * Build a {@link CueBank} from the master database JSON store, validating every
 * entry against the Cue schema on load.
 */
export function createDatabaseCueBank(): CueBank {
  return CueBank.fromJson(loadCueDatabaseJson());
}
