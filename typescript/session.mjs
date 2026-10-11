// SPDX-License-Identifier: MIT
import { randomUUID } from 'node:crypto';

export const INSTANCE_HEADER = 'X-Nilo-Connector-Instance';
export class NcpError extends Error {
  constructor(status, code) { super(`NCP request failed (${status}, ${code})`); this.status = status; this.code = code; }
}

const identity = manifest => JSON.stringify([manifest?.schemaVersion, manifest?.id, manifest?.name, manifest?.version,
  manifest?.protocol?.major, manifest?.protocol?.minor, [...(manifest?.capabilities ?? [])].sort()]);
const replayable = body => body == null || typeof body === 'string' || body instanceof Blob || body instanceof FormData
  || body instanceof URLSearchParams || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
async function waitFor(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  let abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { if (abort) signal.removeEventListener('abort', abort); }
}

/** The process lease is separate from any native runtime/session epoch. */
export class NcpSession {
  constructor(options) {
    this.options = options;
    this.base = new URL(options.baseUrl);
    if (this.base.username || this.base.password || this.base.search || this.base.hash || this.base.pathname !== '/'
      || (this.base.protocol !== 'https:' && !(this.base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname)))) {
      throw new Error('NCP baseUrl must be an HTTPS origin (HTTP allowed only on localhost)');
    }
    if (!options.token) throw new Error('NCP Agent credential required');
    this.manifest = structuredClone(options.manifest);
    this.instanceId = options.instanceId ?? randomUUID();
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.closed = false;
    this.established = false;
    this.leaseExpiresAt = 0;
    this.heartbeatInterval = 30_000;
  }

  async transport(path, init = {}, management = false) {
    if (!path.startsWith('/api/') || new URL(path, this.base).origin !== this.base.origin) throw new Error('Invalid NCP endpoint');
    const headers = new Headers(this.options.headers);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    headers.set('Authorization', `Bearer ${this.options.token}`);
    headers.set(INSTANCE_HEADER, this.instanceId);
    // Callers cannot inject a management credential into the message channel.
    headers.delete('X-Agent-Inbox-Management-Token');
    if (management) {
      if (!this.options.managementToken) throw new NcpError(403, 'management_credential_required');
      headers.set('X-Agent-Inbox-Management-Token', this.options.managementToken);
    }
    return this.fetcher(new URL(path, this.base), { ...init, headers, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(28_000) });
  }

  async ready() {
    if (this.closed) throw new NcpError(409, 'connector_session_closed');
    if (this.established && Date.now() < this.leaseExpiresAt - 1000) return;
    if (!this.handshake) {
      this.handshake = this.establish().finally(() => { this.handshake = undefined; });
    }
    await this.handshake;
    if (this.closed) throw new NcpError(409, 'connector_session_closed');
  }

  async establish() {
    const response = await this.transport('/api/connector/handshake', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connector: this.manifest, instanceId: this.instanceId }),
    }, this.manifest.capabilities.includes('runtime.manage'));
    await this.acceptSession(response);
    this.established = true;
    this.scheduleHeartbeat();
  }

  async acceptSession(response) {
    const value = await response.json().catch(() => ({}));
    const body = value && typeof value === 'object' ? value : {};
    if (!response.ok) throw new NcpError(response.status, /^[a-z0-9_]{1,100}$/.test(body.error ?? '') ? body.error : 'request_failed');
    const expires = Date.parse(body.leaseExpiresAt);
    if (body.protocol?.major !== 1 || body.protocol?.minor < this.manifest.protocol.minor
      || body.instanceId !== this.instanceId || identity(body.connector) !== identity(this.manifest)
      || typeof body.agentId !== 'string' || !Number.isFinite(expires) || expires <= Date.now()
      || !Number.isFinite(body.heartbeatIntervalSeconds) || body.heartbeatIntervalSeconds < 1 || body.heartbeatIntervalSeconds > 60) {
      throw new NcpError(502, 'invalid_connector_session');
    }
    this.agentId = body.agentId;
    this.leaseExpiresAt = expires;
    this.heartbeatInterval = body.heartbeatIntervalSeconds * 1000;
  }

  scheduleHeartbeat() {
    clearTimeout(this.timer);
    if (this.closed) return;
    this.timer = setTimeout(() => { void this.heartbeat(); }, this.heartbeatInterval);
    this.timer.unref?.();
  }

  async heartbeat() {
    if (this.closed) return;
    try {
      if (!this.established || Date.now() >= this.leaseExpiresAt - 1000) await this.ready();
      else await this.acceptSession(await this.transport('/api/connector/heartbeat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }));
    } catch (error) {
      if (error instanceof NcpError && [401, 403, 409].includes(error.status)) this.established = false;
      this.options.onError?.(error instanceof NcpError ? error : new NcpError(503, 'connector_unreachable'));
    } finally { this.scheduleHeartbeat(); }
  }

  async fetch(path, init = {}, management = false) {
    init.signal?.throwIfAborted();
    await waitFor(this.ready(), init.signal);
    let response = await this.transport(path, init, management);
    if (response.status === 409) {
      const error = await response.clone().json().catch(() => ({}));
      if (error.error === 'connector_instance_invalid') {
        this.established = false;
        // This specific rejection happens before execution. An expired current
        // instance may renew; a retired instance may never replace its successor.
        if (replayable(init.body)) {
          await response.body?.cancel();
          await waitFor(this.ready(), init.signal);
          response = await this.transport(path, init, management);
        }
      }
    }
    return response;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    await this.handshake?.catch(() => {});
    if (!this.established) return;
    this.established = false;
    try {
      const response = await this.transport('/api/connector/disconnect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000),
      });
      await response.body?.cancel();
    } catch { /* The server lease bounds an interrupted shutdown. */ }
  }
}
