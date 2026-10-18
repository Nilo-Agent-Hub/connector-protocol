import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertRuntimeSelection, mergeRuntimeSelection } from '../contracts/runtime-selection.ts';

const report = { capabilities: { sessionSelection: true, switchModel: true, reasoning: true, updateSettings: true },
  models: [{ model: 'a', provider: 'one', reasoningEfforts: [{ id: 'high' }] }, { model: 'a', provider: 'two', reasoningEfforts: [] }],
  settings: { allowed: { mode: ['safe', 'fast'], nullable: [null, true] } } };
test('Python and TypeScript consume the same selection vectors', () => {
  const vectors = JSON.parse(readFileSync(new URL('../../tests/vectors/runtime-selection.json', import.meta.url)));
  const before = structuredClone(vectors);
  for (const selection of vectors.valid) assert.doesNotThrow(() => assertRuntimeSelection(selection, vectors.report));
  for (const selection of vectors.invalid) assert.throws(() => assertRuntimeSelection(selection, vectors.report));
  assert.deepEqual(vectors, before);
});
test('frozen selections validate provider, effort and exact scalar choices', () => {
  assert.doesNotThrow(() => assertRuntimeSelection({ model: { model: 'a', provider: 'one' }, effort: 'high', settings: { nullable: null } }, report));
  for (const selection of [null, [], { extra: true }, { effort: 'high' }, { model: { model: 'a', provider: 'missing' } },
    { model: { model: 'a', provider: 'two' }, effort: 'high' }, { settings: { mode: 'unsafe' } }, { settings: { nullable: false } }, { settings: { mode: {} } }]) {
    assert.throws(() => assertRuntimeSelection(selection, report));
  }
  assert.throws(() => assertRuntimeSelection({}, { ...report, capabilities: {} }));
});
test('override retains explicit null and drops incompatible inherited reasoning without mutation', () => {
  const defaults = { model: { model: 'a', provider: 'one' }, effort: 'high', settings: { mode: 'safe', nullable: true } };
  const before = structuredClone(defaults);
  assert.deepEqual(mergeRuntimeSelection(defaults, { model: { model: 'a', provider: 'two' }, settings: { nullable: null } }),
    { model: { model: 'a', provider: 'two' }, settings: { mode: 'safe', nullable: null } });
  assert.deepEqual(defaults, before);
});
