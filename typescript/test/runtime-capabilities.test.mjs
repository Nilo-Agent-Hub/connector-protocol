import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runtimeCapabilityExtensionsError, startsNewTopicCommand } from '../contracts/runtime.ts';

const vectors = JSON.parse(readFileSync(new URL('../../tests/vectors/runtime-capabilities.json', import.meta.url), 'utf8'));

test('NCP 1.2 runtime capability declarations follow the shared vectors', () => {
  for (const value of vectors.valid) assert.equal(runtimeCapabilityExtensionsError(value), null, JSON.stringify(value));
  for (const value of vectors.invalid) assert.notEqual(runtimeCapabilityExtensionsError(value), null, JSON.stringify(value));
});

test('newTopic commands match the first word, optionally with @name', () => {
  for (const [text, expected] of vectors.newTopic.cases) assert.equal(startsNewTopicCommand(vectors.newTopic.commands, text), expected, text);
});
