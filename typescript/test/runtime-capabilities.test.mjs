import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadContract } from './load-contract.mjs';
const { runtimeCapabilityExtensionsError, startsNewTopicCommand, supportsNextTurnModel } = await loadContract('runtime');

const vectors = JSON.parse(readFileSync(new URL('../../tests/vectors/runtime-capabilities.json', import.meta.url), 'utf8'));

test('NCP 1.2 runtime capability declarations follow the shared vectors', () => {
  for (const value of vectors.valid) assert.equal(runtimeCapabilityExtensionsError(value), null, JSON.stringify(value));
  for (const value of vectors.invalid) assert.notEqual(runtimeCapabilityExtensionsError(value), null, JSON.stringify(value));
});

test('newTopic commands match the first word, optionally with @name', () => {
  for (const [text, expected] of vectors.newTopic.cases) assert.equal(startsNewTopicCommand(vectors.newTopic.commands, text), expected, text);
});

test('saving a model for the next turn requires explicit model switching and next-turn support', () => {
  for (const capabilities of [undefined, {}, { switchModel: true }, { nextTurnModel: true },
    { switchModel: false, nextTurnModel: true }, { switchModel: true, nextTurnModel: false },
    { switchModel: 1, nextTurnModel: true }, { switchModel: true, nextTurnModel: 1 }]) {
    assert.equal(supportsNextTurnModel(capabilities), false, JSON.stringify(capabilities));
  }
  assert.equal(supportsNextTurnModel({ switchModel: true, nextTurnModel: true }), true);
});
