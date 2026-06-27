/**
 * LIVE smoke test — ONE real Anthropic API call, to confirm real cue generation
 * works end to end against the actual model.
 *
 * This is deliberately NOT part of the offline `node --test` suite: the normal
 * tests never touch the network or need a key. Run this by hand, once, after you
 * set your key:
 *
 *   cd backend
 *   # set ANTHROPIC_API_KEY first — see README "Live smoke test", then:
 *   npm run smoke:live
 *
 * It instantiates the EXACT generator the engine uses in production —
 * `new AnthropicCueGenerator()`, which reads ANTHROPIC_API_KEY from the
 * environment — asks for one ENCOUNTER cue, runs the returned transcript back
 * through the same spoken-vocabulary guard the engine uses, and prints the
 * structured outcome (status / attempts / network retries). Exit code 0 = a
 * clean, on-spec cue came back; non-zero = something to look at.
 */

import { AnthropicCueGenerator } from '../generative/anthropic-cue-generator.ts';
import { findForbiddenVocabulary, isSpeakable } from '../generative/output-vocabulary.ts';
import { FrictionState } from '../domain/friction-state.ts';
import { FrictionCondition } from '../domain/friction-condition.ts';
import type { CueGenerationRequest } from '../ports/cue-generator.ts';

async function main(): Promise<void> {
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error('✖ ANTHROPIC_API_KEY is not set.\n');
    console.error('  Set it first, then re-run. For this project, either:');
    console.error('    • create backend/.env (gitignored) containing:');
    console.error('        ANTHROPIC_API_KEY=sk-ant-...');
    console.error('      then:  npm run smoke:live');
    console.error('    • or export it in your shell:');
    console.error('        export ANTHROPIC_API_KEY=sk-ant-...');
    console.error('        npm run smoke:live');
    process.exit(2);
  }

  // Exactly the production wiring: no options, key read from the environment.
  const generator = new AnthropicCueGenerator();

  const request: CueGenerationRequest = {
    state: FrictionState.ENCOUNTER,
    source: 'BIOMETRIC',
    intensity: 0.85,
    round: 2,
    frictionCondition: FrictionCondition.RESOURCE,
  };

  console.log('→ Requesting one ENCOUNTER cue from the live Anthropic API…\n');
  const outcome = await generator.generate(request);

  console.log(`  status:         ${outcome.status}`);
  console.log(`  attempts:       ${outcome.attempts}`);
  console.log(`  networkRetries: ${outcome.networkRetries}`);
  if (outcome.reason) console.log(`  reason:         ${outcome.reason}`);

  if (outcome.status !== 'ok' || !outcome.cue) {
    console.error('\n✖ Live generation did not return a usable cue (see status/reason above).');
    process.exit(1);
  }

  const cue = outcome.cue;
  console.log('\n  ── generated cue ────────────────────────────────────────');
  console.log(`  CueID:           ${cue.CueID}`);
  console.log(`  PrimaryState:    ${cue.PrimaryState}`);
  console.log(`  PhysicalLever:   ${cue.PhysicalLever}`);
  console.log(`  EnergeticVector: ${cue.EnergeticVector}`);
  console.log(`  StructuralYield: ${cue.StructuralYield}`);
  console.log(`  DeliveryTone:    ${cue.DeliveryTone}`);
  console.log(`  AudioTranscript: ${cue.AudioTranscript}`);

  // Re-check the spoken line with the same guard the engine applies.
  if (!isSpeakable(cue.AudioTranscript)) {
    const leaks = findForbiddenVocabulary(cue.AudioTranscript);
    console.error(`\n✖ Transcript failed the spoken-vocabulary check: ${leaks.join(', ')}`);
    process.exit(1);
  }

  console.log('\n✔ Live generation OK — the spoken transcript is clean and on-spec.');
}

void main().catch((err: unknown) => {
  console.error('\n✖ Live smoke test threw:', err instanceof Error ? err.message : err);
  process.exit(1);
});
