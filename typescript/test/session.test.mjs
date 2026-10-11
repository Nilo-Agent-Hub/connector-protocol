import assert from 'node:assert/strict';
import test from 'node:test';
import { NcpSession, NcpError } from '../session.mjs';

const manifest = { schemaVersion: 1, id: 'io.example.test', name: 'Fixture', version: '1.0.0', protocol: { major: 1, minor: 1 }, capabilities: ['channel.receive', 'channel.send', 'runtime.manage'] };
const reply = (input, options = {}) => Response.json({ protocol: { major: 1, minor: 1 }, connector: input.connector, instanceId: input.instanceId,
  agentId: 'agent-id', leaseExpiresAt: new Date(Date.now() + 90_000).toISOString(), heartbeatIntervalSeconds: 30, ...options });
function fixture(handler = () => Response.json({ ok: true })) {
  const calls = [];
  const session = new NcpSession({ baseUrl: 'https://hub.example', token: 'agent-only', managementToken: 'management-only', manifest,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      if (url.pathname.endsWith('/handshake')) return reply(JSON.parse(init.body));
      if (url.pathname.endsWith('/disconnect')) return new Response(null, { status: 204 });
      return handler(url, init, calls);
    } });
  return { session, calls };
}

test('concurrent message and control traffic share one handshake and preserve credential separation', async t => {
  const { session, calls } = fixture(); t.after(() => session.close());
  await Promise.all([session.fetch('/api/connector/inbox'), session.fetch('/api/connector/runtime/inbox', {}, true)]);
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/handshake')).length, 1);
  for (const { init } of calls) {
    assert.equal(init.headers.get('Authorization'), 'Bearer agent-only');
    assert.equal(init.headers.get('X-Nilo-Connector-Instance'), session.instanceId);
    assert.equal(init.redirect, 'error');
  }
  assert.equal(calls[0].init.headers.get('X-Agent-Inbox-Management-Token'), 'management-only');
  assert.equal(calls[1].init.headers.get('X-Agent-Inbox-Management-Token'), null);
  assert.equal(calls[2].init.headers.get('X-Agent-Inbox-Management-Token'), 'management-only');
});

test('caller supplied headers cannot override credentials or inject management access', async t => {
  const { session, calls } = fixture(); t.after(() => session.close());
  await session.fetch('/api/connector/profile', { headers: { Authorization: 'wrong', 'X-Nilo-Connector-Instance': 'wrong', 'X-Agent-Inbox-Management-Token': 'wrong' } });
  assert.equal(calls.at(-1).init.headers.get('Authorization'), 'Bearer agent-only');
  assert.equal(calls.at(-1).init.headers.get('X-Nilo-Connector-Instance'), session.instanceId);
  assert.equal(calls.at(-1).init.headers.get('X-Agent-Inbox-Management-Token'), null);
});

test('an expired lease renews the same process identity before retrying a rejected operation', async t => {
  let attempts = 0;
  const { session, calls } = fixture(() => ++attempts === 1 ? Response.json({ error: 'connector_instance_invalid' }, { status: 409 }) : Response.json({ id: 'once' }));
  t.after(() => session.close());
  const result = await session.fetch('/api/connector/conversations', { method: 'POST', body: JSON.stringify({ clientConversationId: 'stable' }) });
  assert.equal((await result.json()).id, 'once');
  const handshakes = calls.filter(call => call.url.pathname.endsWith('/handshake'));
  assert.equal(handshakes.length, 2);
  assert.equal(JSON.parse(handshakes[0].init.body).instanceId, JSON.parse(handshakes[1].init.body).instanceId);
  assert.equal(calls[1].init.body, calls[3].init.body);
});

test('lost mutation responses and generic conflicts are never automatically replayed', async t => {
  const { session, calls } = fixture(() => { throw new Error('network lost'); }); t.after(() => session.close());
  await assert.rejects(session.fetch('/api/connector/conversations', { method: 'POST', body: '{}' }), /network lost/);
  assert.equal(calls.length, 2);
  const f = fixture(() => Response.json({ error: 'reconnect' }, { status: 409 })); t.after(() => f.session.close());
  assert.equal((await f.session.fetch('/api/connector/runtime/report', { method: 'POST', body: '{}' }, true)).status, 409);
  assert.equal(f.calls.length, 2);
});

test('retired process and occupied lease cannot silently acquire a new identity', async () => {
  for (const code of ['connector_instance_invalid', 'connector_instance_busy']) {
    const ids = [];
    const session = new NcpSession({ baseUrl: 'https://hub.example', token: 'agent', managementToken: 'mgmt', manifest,
      fetcher: async (_url, init) => { ids.push(JSON.parse(init.body).instanceId); return Response.json({ error: code }, { status: 409 }); } });
    await assert.rejects(session.fetch('/api/connector/inbox'), error => error instanceof NcpError && error.code === code);
    await assert.rejects(session.fetch('/api/connector/inbox'));
    assert.equal(new Set(ids).size, 1);
    await session.close();
  }
});

test('missing or mismatched protocol, manifest and instance cannot downgrade to the legacy channel', async () => {
  for (const changed of [{ protocol: { major: 1, minor: 0 } }, { connector: { ...manifest, capabilities: ['channel.send'] } }, { instanceId: 'other' }, { leaseExpiresAt: 'invalid' }]) {
    const session = new NcpSession({ baseUrl: 'https://hub.example', token: 'agent', managementToken: 'mgmt', manifest,
      fetcher: async (_url, init) => reply(JSON.parse(init.body), changed) });
    await assert.rejects(session.fetch('/api/connector/inbox'), error => error.code === 'invalid_connector_session');
    await session.close();
  }
});

test('stream bodies are not retried after they may have been consumed', async t => {
  const { session, calls } = fixture(() => Response.json({ error: 'connector_instance_invalid' }, { status: 409 })); t.after(() => session.close());
  const response = await session.fetch('/api/connector/file-transfers/id/content', { method: 'POST', body: new ReadableStream() });
  assert.equal(response.status, 409);
  assert.equal(calls.length, 2);
});

test('close retires the session and refuses subsequent traffic', async () => {
  const { session, calls } = fixture();
  await session.fetch('/api/connector/inbox'); await session.close(); await session.close();
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/disconnect')).length, 1);
  await assert.rejects(session.fetch('/api/connector/inbox'), error => error.code === 'connector_session_closed');
});

test('heartbeat uses the same process lease and message credential only', async t => {
  let connected;
  const calls = [];
  const session = new NcpSession({ baseUrl: 'https://hub.example', token: 'agent', managementToken: 'management', manifest,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      if (url.pathname.endsWith('/handshake')) { connected = JSON.parse(init.body); return reply(connected); }
      if (url.pathname.endsWith('/heartbeat')) return reply(connected);
      return new Response(null, { status: 204 });
    } });
  t.after(() => session.close());
  await session.ready(); await session.heartbeat();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.pathname, '/api/connector/heartbeat');
  assert.equal(calls[1].init.headers.get('X-Nilo-Connector-Instance'), connected.instanceId);
  assert.equal(calls[1].init.headers.get('X-Agent-Inbox-Management-Token'), null);
});

test('cancelling one waiter does not cancel another request sharing the handshake', async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  let handshakes = 0;
  const session = new NcpSession({ baseUrl: 'https://hub.example', token: 'agent', managementToken: 'management', manifest,
    fetcher: async (url, init) => {
      if (url.pathname.endsWith('/handshake')) { handshakes++; await pending; return reply(JSON.parse(init.body)); }
      return new Response(null, { status: 204 });
    } });
  t.after(() => session.close());
  const abort = new AbortController();
  const cancelled = session.fetch('/api/connector/inbox', { signal: abort.signal });
  const live = session.fetch('/api/connector/profile');
  abort.abort(); await assert.rejects(cancelled, { name: 'AbortError' });
  finish(); assert.equal((await live).status, 204); assert.equal(handshakes, 1);
});
