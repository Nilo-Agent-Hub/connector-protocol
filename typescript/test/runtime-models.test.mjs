import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadContract } from './load-contract.mjs';

const core = await loadContract('runtime-core');
const compatibility = await loadContract('runtime');
const example = await import('../examples/custom-runtime.ts');
const vectors = JSON.parse(readFileSync(new URL('../../tests/vectors/runtime-capabilities.json', import.meta.url), 'utf8'));

test('independent Connector selects a generic model and settings without native contracts', () => {
  assert.equal(example.manifest.id, 'org.example.independent-agent');
  assert.equal(example.report.capabilities.nativeSettings, undefined);
  assert.equal(core.genericRuntimeCapabilityExtensionsError(example.report.capabilities), null);
  assert.doesNotThrow(() => example.validateSelection(example.selection));
  assert.equal(example.selectedSetting({ kind: 'update-settings', payload: { settings: { 'custom.mode': 'fast' } } }), 'fast');
  for (const settings of [{ 'custom.mode': 'unknown' }, { 'custom.mode': { mode: 'fast' } }, { unknown: true }]) {
    assert.throws(() => example.selectedSetting({ kind: 'update-settings', payload: { settings } }));
  }
});

test('generic and compatibility capability entry points preserve the shared valid cases', () => {
  const before = structuredClone(vectors);
  for (const value of vectors.valid) {
    const { nativeSettings, ...generic } = value;
    assert.equal(core.genericRuntimeCapabilityExtensionsError(generic), null);
    assert.equal(compatibility.runtimeCapabilityExtensionsError(value), null);
  }
  for (const value of vectors.invalid.filter(value => !Object.hasOwn(value, 'nativeSettings'))) {
    assert.notEqual(core.genericRuntimeCapabilityExtensionsError(value), null, JSON.stringify(value));
  }
  for (const nativeSettings of ['codex', 'claude']) {
    assert.equal(compatibility.runtimeCapabilityExtensionsError({ nativeSettings }), null);
  }
  for (const nativeSettings of ['org.example.independent-agent', '', null, {}, true]) {
    assert.equal(compatibility.runtimeCapabilityExtensionsError({ nativeSettings }), 'nativeSettings');
  }
  assert.deepEqual(vectors, before);
});

test('legacy version and error helpers retain their existing behavior', () => {
  for (const version of ['1.2.3', '1.2.3-rc.1+build', '01.2.3', null, '1.2']) {
    assert.equal(compatibility.isCodexRuntimeVersion(version), core.isRuntimeVersion(version));
  }
  assert.equal(compatibility.runtimeError('update_failed'), 'Codex 更新失败，请在主机检查安装权限与网络后重试。');
  assert.equal(compatibility.runtimeError('unrecognized'), compatibility.runtimeErrorMessages.failed);
});

test('public runtime and selection modules cannot depend on compatibility contracts', () => {
  const coreSource = readFileSync(new URL('../contracts/runtime-core.ts', import.meta.url), 'utf8');
  const selectionSource = readFileSync(new URL('../contracts/runtime-selection.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(coreSource, /codex|claude|qoder|\bpiInstanceId\b|bridgeUpdate|bridgeVersion|runtime-compat|provider-connections/i);
  assert.doesNotMatch(selectionSource, /from ['"]\.\/runtime(?:-compat)?\.js['"]/);
});
