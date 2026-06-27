import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AnthropicCueGenerator,
  parseToolInput,
  type FetchLike,
} from '../generative/anthropic-cue-generator.ts';
import { GENERATIVE_SYSTEM_PROMPT } from '../generative/system-prompt.ts';
import { FrictionState } from '../domain/friction-state.ts';
import { FrictionCondition } from '../domain/friction-condition.ts';
import type { CueGenerationRequest } from '../ports/cue-generator.ts';

const REQUEST: CueGenerationRequest = {
  state: FrictionState.ENCOUNTER,
  source: 'BIOMETRIC',
  intensity: 0.9,
  round: 2,
  frictionCondition: FrictionCondition.RESOURCE,
};

const CLEAN_CUE = {
  PhysicalLever: 'Drop the breath low and force the exhale on the hard part.',
  EnergeticVector: 'Breath and oxygen under load.',
  StructuralYield: 'A full breath returns you to steady ground.',
  AudioTranscript: "Your breath's gone shallow. Drop it low and push the air out. The breath steadies you.",
  DeliveryTone: 'Sharp, commanding',
};

function fakeFetch(inputs: Record<string, unknown>[]): { fetch: FetchLike; calls: () => number } {
  let i = 0;
  const fetch: FetchLike = async () => {
    const input = inputs[Math.min(i, inputs.length - 1)];
    i += 1;
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ content: [{ type: 'tool_use', name: 'emit_cue', input }] }),
    };
  };
  return { fetch, calls: () => i };
}

test('buildRequestBody sets the YAML system prompt, forces the cue tool, and includes context', () => {
  const gen = new AnthropicCueGenerator({ apiKey: 'k', fetchImpl: fakeFetch([CLEAN_CUE]).fetch });
  const body = gen.buildRequestBody(REQUEST) as Record<string, unknown>;
  assert.equal(body['system'], GENERATIVE_SYSTEM_PROMPT);
  assert.equal(body['model'], 'claude-haiku-4-5');
  assert.equal(body['temperature'], 0.4); // Haiku supports sampling params
  const tools = body['tools'] as Array<{ name: string }>;
  assert.equal(tools[0]!.name, 'emit_cue');
  assert.deepEqual(body['tool_choice'], { type: 'tool', name: 'emit_cue' });
  const messages = body['messages'] as Array<{ content: string }>;
  assert.match(messages[0]!.content, /STATE: ENCOUNTER/);
  assert.match(messages[0]!.content, /FRICTION CONDITION: RESOURCE/);
});

test('temperature is omitted for models that reject sampling params (Opus 4.8)', () => {
  const gen = new AnthropicCueGenerator({ apiKey: 'k', model: 'claude-opus-4-8', fetchImpl: fakeFetch([CLEAN_CUE]).fetch });
  const body = gen.buildRequestBody(REQUEST) as Record<string, unknown>;
  assert.equal('temperature' in body, false);
});

test('generate returns a validated cue with PrimaryState from the request', async () => {
  const gen = new AnthropicCueGenerator({ apiKey: 'k', fetchImpl: fakeFetch([CLEAN_CUE]).fetch });
  const cue = await gen.generate(REQUEST);
  assert.ok(cue);
  assert.equal(cue?.PrimaryState, FrictionState.ENCOUNTER);
  assert.equal(cue?.AudioTranscript, CLEAN_CUE.AudioTranscript);
  assert.match(cue!.CueID, /^gen-encounter-/);
});

test('generate regenerates when a transcript leaks internal vocabulary', async () => {
  const leaky = { ...CLEAN_CUE, AudioTranscript: 'Stay in the structure. The apparatus holds.' };
  const { fetch, calls } = fakeFetch([leaky, CLEAN_CUE]);
  const gen = new AnthropicCueGenerator({ apiKey: 'k', maxAttempts: 2, fetchImpl: fetch });
  const cue = await gen.generate(REQUEST);
  assert.ok(cue);
  assert.equal(cue?.AudioTranscript, CLEAN_CUE.AudioTranscript);
  assert.equal(calls(), 2, 'retried once after the leak');
});

test('generate returns null when every attempt leaks forbidden vocabulary', async () => {
  const leaky = { ...CLEAN_CUE, AudioTranscript: 'The Engine redlines. Push through.' };
  const gen = new AnthropicCueGenerator({ apiKey: 'k', maxAttempts: 2, fetchImpl: fakeFetch([leaky]).fetch });
  assert.equal(await gen.generate(REQUEST), null);
});

test('parseToolInput extracts the forced tool input, or null when absent', () => {
  assert.deepEqual(
    parseToolInput({ content: [{ type: 'tool_use', name: 'emit_cue', input: { a: 1 } }] }),
    { a: 1 },
  );
  assert.equal(parseToolInput({ content: [{ type: 'text', text: 'hi' }] }), null);
  assert.equal(parseToolInput({}), null);
});

test('generate surfaces a non-2xx API response as an error', async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: false,
    status: 429,
    text: async () => 'rate limited',
    json: async () => ({}),
  });
  const gen = new AnthropicCueGenerator({ apiKey: 'k', fetchImpl });
  await assert.rejects(() => gen.generate(REQUEST), /429/);
});
