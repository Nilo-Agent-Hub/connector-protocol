// SPDX-License-Identifier: MIT
import type { ConnectorManifest } from '../session.mjs';
import type { RuntimeReport, RuntimeSelection, RuntimeRequest, RuntimeView } from '../contracts/runtime-core.js';
import { assertRuntimeSelection } from '../contracts/runtime-selection.js';

/** An independent implementation needs only its own identity and generic capabilities. */
export const manifest: ConnectorManifest = {
  schemaVersion: 1, id: 'org.example.independent-agent', name: 'Independent Agent', version: '1.0.0',
  protocol: { major: 1, minor: 2 }, capabilities: ['channel.receive', 'channel.send', 'runtime.manage'],
};
export const report: RuntimeReport = {
  runtimeInstanceId: '0b85c0e4-f7ba-43a6-9c87-9f57aeea41cd',
  conversationId: null, runtimeVersion: '1.0.0',
  capabilities: {
    inspect: true, switchModel: true, syncConnections: false, readFiles: false,
    sessionSelection: true, updateSettings: true, modelScopes: ['draft', 'conversation'],
    sideConversation: 'inline',
  },
  settings: { values: { 'custom.mode': 'safe' }, allowed: { 'custom.mode': ['safe', 'fast'] }, source: 'runtime' },
  model: { model: 'local-model', provider: 'example', providerLabel: 'Example', scope: 'instance', source: 'runtime' },
  lastUsedModel: null,
  models: [{ id: 'local', model: 'local-model', provider: 'example', providerLabel: 'Example' }],
  busy: false,
  usage: { contextTokens: null, contextLimit: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, contextSource: 'unknown', totalsSource: 'unknown' },
  skills: null, mcp: null, files: [],
};
export const selection: RuntimeSelection = { model: { model: 'local-model', provider: 'example' }, settings: { 'custom.mode': 'fast' } };

export function validateSelection(value: RuntimeSelection): void {
  // Validate immediately before the Connector's durable apply-once operation.
  // This helper does not perform upstream work or provide a recovery journal.
  assertRuntimeSelection(value, report);
}

export function selectedSetting(request: RuntimeRequest): string | undefined {
  if (request.kind !== 'update-settings') return;
  const settings = request.payload.settings;
  if (!settings) throw new Error('Missing settings');
  assertRuntimeSelection({ settings }, report);
  return settings['custom.mode'] as string | undefined;
}

export const view: RuntimeView = {
  enabled: true, online: true, lastSeenAt: null, observedAt: null, report,
  sync: { desiredRevision: 0, appliedRevision: null, error: null },
};
