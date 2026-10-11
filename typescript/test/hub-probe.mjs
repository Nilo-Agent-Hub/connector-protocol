// Integration harness for a disposable Hub database; never runs native models.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NcpSession } from '../session.mjs';

const manifest = JSON.parse(process.env.NCP_MANIFEST_JSON ?? await readFile(process.env.NCP_MANIFEST_PATH, 'utf8'));
const session = new NcpSession({ baseUrl: process.env.NCP_HUB_URL, token: process.env.NCP_TOKEN,
  managementToken: process.env.NCP_MANAGEMENT_TOKEN, manifest });
const epoch = randomUUID();
async function call(path, body, management = false) {
  const response = await session.fetch('/api' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, management);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${(await response.json()).error}`);
  return response.status === 204 ? undefined : response.json();
}
try {
  await session.ready();
  const profile = await call('/connector/profile');
  assert.equal(profile.id, session.agentId);
  await call('/connector/coding/connect', { instanceId: epoch, version: '1.2.3', account: 'apiKey', projects: [{ id: 'fixture', name: 'Fixture' }] }, true);
  const report = process.env.NCP_RUNTIME_REPORT ? JSON.parse(process.env.NCP_RUNTIME_REPORT) : {
    conversationId: null, runtimeInstanceId: epoch, runtimeVersion: '1.2.3',
    capabilities: { inspect: true, switchModel: false, syncConnections: false, readFiles: false, createSession: true, steerInput: false },
    model: null, lastUsedModel: null, models: [], busy: false,
    usage: { contextTokens: null, contextLimit: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, contextSource: 'unknown', totalsSource: 'unknown' },
    skills: null, mcp: null, files: [],
  };
  report.runtimeInstanceId = epoch;
  await call('/connector/runtime/report', report, true);
  const inbox = await call(`/connector/inbox?wait=0&pollId=${randomUUID()}&codingInstanceId=${epoch}`);
  assert.ok(Array.isArray(inbox.deliveries));
  const controls = await call(`/connector/coding/inbox?instanceId=${epoch}&wait=0`, undefined, true);
  assert.ok(Array.isArray(controls.actions));
  const denied = await session.fetch('/api/connector/runtime/inbox?wait=0&instanceId=' + epoch);
  assert.ok([401, 403].includes(denied.status), 'message credential must not grant management access');
  await denied.body?.cancel();
  const unfenced = await fetch(process.env.NCP_HUB_URL + '/api/connector/profile', { headers: { Authorization: `Bearer ${process.env.NCP_TOKEN}` }, redirect: 'error' });
  assert.equal(unfenced.status, 409, 'missing instance header must not downgrade to a legacy request');
  await unfenced.body?.cancel();
  console.log(JSON.stringify({ ok: true, connectorId: manifest.id }));
} finally { await session.close(); }
