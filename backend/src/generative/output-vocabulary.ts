/**
 * Code-level enforcement of the spoken-output constraint.
 *
 * The system prompt forbids internal architectural vocabulary and generic
 * motivation in spoken output, but prompts can leak. This module re-checks every
 * generated `AudioTranscript` programmatically before it reaches TTS — the
 * "double seal" the spec calls for. If anything is found, the generator rejects
 * the cue and regenerates.
 *
 * This applies ONLY to generated cues. Static corpus cues are authored/trusted
 * and are not run through this guard.
 */

/**
 * Internal architectural / clinical-theory terms that must never be spoken.
 * Derived from the YAML `Output_Vocabulary_Rule.NEVER_SPEAK`. Matched as whole
 * words / stems, case-insensitively.
 */
const INTERNAL_VOCABULARY: readonly RegExp[] = [
  /\bapparatus\b/i,
  /\bengine\b/i,
  /\bpilot\b/i,
  /\boperator\b/i,
  /\blife\s?force\b/i,
  /\bsoul\b/i,
  /\bsoftware\b/i,
  /\bcognit\w*/i, // cognitive, cognition
  /\bnervous system\b/i,
  /\bdefen[cs]e\b/i,
  /\bstructur\w*/i, // structure, structural (as jargon)
];

/** Generic motivation phrases (YAML `Forbidden_Phrases`). Matched as substrings. */
const GENERIC_MOTIVATION: readonly string[] = [
  'you can do it',
  'believe in yourself',
  'almost there',
  'good job',
  "you've got this",
  'push through',
  'no pain no gain',
  'dig deep',
];

/**
 * Returns the list of forbidden terms/phrases found in `text` (lower-cased).
 * An empty array means the text is clean and safe to speak.
 */
export function findForbiddenVocabulary(text: string): string[] {
  const found: string[] = [];
  for (const pattern of INTERNAL_VOCABULARY) {
    const m = pattern.exec(text);
    if (m) found.push(m[0].toLowerCase());
  }
  const lower = text.toLowerCase();
  for (const phrase of GENERIC_MOTIVATION) {
    if (lower.includes(phrase)) found.push(phrase);
  }
  return found;
}

/** True when `text` contains no forbidden internal vocabulary or generic motivation. */
export function isSpeakable(text: string): boolean {
  return findForbiddenVocabulary(text).length === 0;
}
