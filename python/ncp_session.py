"""NCP 1.1 sessions for native channels and standalone Connector transports.

SPDX-License-Identifier: MIT
MIT License

Copyright (c) 2026 Nilo Connector Protocol contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Canonical source: Nilo-Agent-Hub/connector-protocol/python/ncp_session.py.
Generated distribution copies must not be edited independently.

Session coordination contains no credentials. A locked private descriptor lets
tools in another local process join an active channel's instance. It never lets
a stale process take over a newer instance, nor retries a business mutation.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
from pathlib import Path
import stat
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid
from multiprocessing import AuthenticationError
from multiprocessing.connection import Client as _PipeClient, Listener as _PipeListener

INSTANCE_HEADER = "X-Nilo-Connector-Instance"
_sessions = {}
_sessions_lock = threading.RLock()


def _encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


class GatewayError(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, str(code)[:100]
        super().__init__(f"gateway {status}: {self.code}")


def manifest_from(path):
    with open(path, encoding="utf-8") as stream:
        value = json.load(stream)
    if value.get("schemaVersion") != 1 or value.get("protocol") != {"major": 1, "minor": 1}:
        raise ValueError("NCP 1.1 manifest required")
    if not {"channel.receive", "channel.send"}.issubset(value.get("capabilities", [])):
        raise ValueError("NCP channel capabilities required")
    return value


def _private_file(path):
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    info = os.fstat(fd)
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
            or (hasattr(os, "getuid") and info.st_uid != os.getuid())
            or info.st_mode & 0o077):
        os.close(fd)
        raise ValueError("NCP session files must be private regular files")
    return os.fdopen(fd, "r+b", buffering=0)


def _lock(file):
    if os.name == "nt":
        import msvcrt
        file.seek(0)
        if not file.read(1):
            file.write(b"0")
        file.seek(0)
        try:
            msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
            return True
        except OSError:
            return False
    import fcntl
    try:
        fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except BlockingIOError:
        return False


class Session:
    """One credential/manifest scope, shared across threads and local processes.

    Call ``acquire``/``release`` for each transport. Control request callbacks
    receive (method, absolute_api_path, body, headers). ``ensure_async`` uses the
    caller's HTTP transport, preserving its proxy and Access policy. Callers
    maintain a heartbeat task while their native model can be busy.
    """
    @classmethod
    def acquire(cls, hub_url, token, manifest, *, state_dir=None):
        digest = hashlib.sha256(_encoded([hub_url.rstrip("/"), token, manifest]).encode()).hexdigest()
        directory = Path(state_dir) if state_dir else Path.home() / ".local" / "state" / "nilo-link" / "ncp-sessions"
        key = (os.getpid(), str(directory.absolute()), digest)
        with _sessions_lock:
            session = _sessions.get(key)
            if session is None:
                peer_key = hmac.new(token.encode(), _encoded([hub_url.rstrip("/"), manifest, "ncp-local-peer-v1"]).encode(), hashlib.sha256).digest()
                session = cls(directory, digest, manifest, peer_key=peer_key)
                session.key = key
                _sessions[key] = session
            session.references += 1
            return session

    def __init__(self, directory, digest, manifest, *, peer_key):
        self.manifest = manifest
        self.references = 0
        self.guard = threading.Lock()
        self.established = False
        self.closed = False
        self.heartbeat_interval = 25.0
        self.next_heartbeat = 0.0
        self.lockfile = None
        if os.name == "nt":
            # A named pipe is the Windows coordinator. multiprocessing.connection
            # performs an HMAC challenge with this in-memory key; no token or
            # instance descriptor is written to disk and no ACL claim is made.
            self._pipe_address = r"\\.\pipe\nilo-ncp-" + digest
            self._pipe_key = peer_key
            try:
                self._pipe_listener = _PipeListener(self._pipe_address, authkey=self._pipe_key)
                self.leader = True
                self.instance_id = str(uuid.uuid4())
                self._pipe_stop = threading.Event()
                self._pipe_thread = threading.Thread(target=self._pipe_loop, daemon=True, name="ncp-pipe")
                self._pipe_thread.start()
            except (OSError, PermissionError):
                self.leader = False
                self._pipe_listener = None
                self.instance_id = self._pipe_peer()
            return
        directory.mkdir(parents=True, mode=0o700, exist_ok=True)
        info = directory.lstat()
        if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)
                or (hasattr(os, "getuid") and info.st_uid != os.getuid()) or info.st_mode & 0o077):
            raise ValueError("NCP session directory must be private and owned by this user")
        self.lockfile = _private_file(directory / (digest + ".lock"))
        self.leader = _lock(self.lockfile)
        self.descriptor = directory / (digest + ".json")
        if self.leader:
            self.instance_id = str(uuid.uuid4())
            with _private_file(self.descriptor) as stream:
                stream.truncate(0)
                stream.write(_encoded({"instanceId": self.instance_id}).encode())
                stream.flush()
                os.fsync(stream.fileno())
        else:
            with _private_file(self.descriptor) as stream:
                raw = stream.read(4097)
                if len(raw) > 4096:
                    raise ValueError("Invalid NCP session descriptor")
                self.instance_id = str(uuid.UUID(json.loads(raw)["instanceId"]))
        self.established = False
        self.closed = False
        self.heartbeat_interval = 25.0
        self.next_heartbeat = 0.0

    def _pipe_loop(self):
        while not self._pipe_stop.is_set():
            try:
                peer = self._pipe_listener.accept()
                try:
                    message = json.loads(peer.recv_bytes(4096))
                    if message == {"op": "join"}:
                        peer.send_bytes(_encoded({"status": "ok", "instanceId": self.instance_id}).encode())
                finally:
                    peer.close()
            except (OSError, EOFError, ValueError, AuthenticationError):
                if not self._pipe_stop.is_set():
                    time.sleep(0.05)

    def _pipe_peer(self):
        try:
            with _PipeClient(self._pipe_address, authkey=self._pipe_key) as peer:
                peer.send_bytes(b'{"op":"join"}')
                if not peer.poll(5):
                    raise GatewayError(409, "connector_session_owner_unavailable")
                response = json.loads(peer.recv_bytes(4096))
            if not isinstance(response, dict) or response.get("status") != "ok":
                raise ValueError("invalid peer")
            return str(uuid.UUID(response["instanceId"]))
        except (OSError, EOFError, ValueError, AuthenticationError):
            raise GatewayError(409, "connector_session_owner_stopped") from None

    def headers(self):
        if self.closed:
            raise GatewayError(409, "connector_session_closed")
        if os.name == "nt" and not self.leader:
            if self._pipe_peer() != self.instance_id:
                raise GatewayError(409, "connector_session_superseded")
        if os.name != "nt" and not self.leader:
            # The flock, rather than a PID, is the liveness boundary. A joiner
            # never becomes the new leader or mutates its generation in place.
            if _lock(self.lockfile):
                self.closed = True
                self.lockfile.close()
                raise GatewayError(409, "connector_session_owner_stopped")
            with _private_file(self.descriptor) as stream:
                current = json.loads(stream.read(4096))
            if current.get("instanceId") != self.instance_id:
                raise GatewayError(409, "connector_session_superseded")
        return {INSTANCE_HEADER: self.instance_id}

    def _control(self):
        headers = self.headers()
        if not self.established:
            return "/api/connector/handshake", {"connector": self.manifest, "instanceId": self.instance_id}, headers
        if time.monotonic() >= self.next_heartbeat:
            return "/api/connector/heartbeat", {}, headers
        return None

    def _accepted(self, path, result):
        if path.endswith("handshake"):
            if (not isinstance(result, dict) or result.get("protocol") != {"major": 1, "minor": 1}
                    or result.get("instanceId") != self.instance_id or result.get("connector") != self.manifest):
                raise GatewayError(502, "connector_handshake_invalid")
            interval = result.get("heartbeatIntervalSeconds", 30)
            if not isinstance(interval, (int, float)) or isinstance(interval, bool) or not 1 <= interval <= 30:
                raise GatewayError(502, "connector_heartbeat_interval_invalid")
            self.heartbeat_interval = max(0.5, interval * 0.8)
        self.established = True
        self.next_heartbeat = time.monotonic() + self.heartbeat_interval

    def _recover_expired_lease(self, path, error):
        # A suspended process or a network outage may outlast the 90s lease.
        # Only this control-plane rejection can trigger re-handshake. Reusing
        # the original UUID lets Hub distinguish an expired current instance
        # from a retired/replaced one; never create a generation or replay a
        # business request to work around a fencing decision.
        if (path != "/api/connector/heartbeat" or getattr(error, "status", None) != 409
                or getattr(error, "code", None) != "connector_instance_invalid"):
            return None
        self.established = False
        return self._control()

    def ensure(self, request):
        with self.guard:
            pending = self._control()
            if pending:
                path, body, headers = pending
                try:
                    result = request("POST", path, body, headers)
                except Exception as error:
                    recovery = self._recover_expired_lease(path, error)
                    if recovery is None:
                        raise
                    path, body, headers = recovery
                    result = request("POST", path, body, headers)
                self._accepted(path, result)
            return self.headers()

    async def ensure_async(self, request):
        # Try-lock cooperatively so an HTTP callback can await without
        # blocking another coroutine or a tool running on another event loop.
        while not self.guard.acquire(blocking=False):
            await asyncio.sleep(0.01)
        try:
            pending = self._control()
            if pending:
                path, body, headers = pending
                try:
                    result = await request("POST", path, body, headers)
                except Exception as error:
                    recovery = self._recover_expired_lease(path, error)
                    if recovery is None:
                        raise
                    path, body, headers = recovery
                    result = await request("POST", path, body, headers)
                self._accepted(path, result)
            return self.headers()
        finally:
            self.guard.release()

    def release(self):
        """Release a local reference. Return True only for the final leader.

        The last leader releases its private lock. Lease expiry fences a crashed
        leader; a graceful transport may disconnect immediately before release.
        """
        with _sessions_lock:
            self.references -= 1
            if self.references:
                return False
            _sessions.pop(self.key, None)
            self.closed = True
            if os.name == "nt" and self.leader:
                self._pipe_stop.set()
                self._pipe_listener.close()
                if self._pipe_thread is not threading.current_thread():
                    self._pipe_thread.join(timeout=1)
            if self.lockfile is not None:
                self.lockfile.close()
            return self.leader and self.established


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class SyncGateway:
    """Strict NCP transport. Missing/rejected handshakes never use legacy HTTP."""
    def __init__(self, url, token, management="", *, manifest, timeout=20, state_dir=None):
        parsed = urlsplit(url)
        if ((parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}))
                or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}):
            raise ValueError("Gateway requires HTTPS (or HTTP loopback for local tests)")
        if not token:
            raise ValueError("Connector credential is required")
        self.url, self.timeout = url.rstrip("/"), timeout
        self.headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json"}
        if "runtime.manage" in manifest["capabilities"]:
            if not management:
                raise ValueError("Independent management credential is required for runtime.manage")
            self.headers["X-Agent-Inbox-Management-Token"] = management
        self.opener = build_opener(_NoRedirect())
        self.session = Session.acquire(self.url, token, manifest, state_dir=state_dir)
        self.instance_id = self.session.instance_id
        self._stopped = threading.Event()
        self._heartbeat = None

    def _raw_call(self, method, path, body=None, headers=None):
        request = Request(self.url + path, data=None if body is None else _encoded(body).encode(),
                          headers={**self.headers, **(headers or {})}, method=method)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise GatewayError(502, "response_too_large")
                try:
                    return json.loads(raw) if raw else None
                except ValueError:
                    raise GatewayError(502, "invalid_json") from None
        except HTTPError as exc:
            try:
                raw = json.loads(exc.read(4096))
                error = raw.get("error", "request_failed")
                code = error.get("code", "request_failed") if isinstance(error, dict) else error
            except (ValueError, AttributeError):
                code = "request_failed"
            raise GatewayError(exc.code, code) from None
        except (URLError, TimeoutError, OSError) as exc:
            raise GatewayError(0, type(exc).__name__) from None

    def call(self, method, path, body=None):
        if not path.startswith("/api/connector/") and not path.startswith("/api/attachments"):
            raise ValueError("Connector transport only supports the public NCP API")
        headers = self.session.ensure(self._raw_call)
        if self._heartbeat is None:
            self._heartbeat = threading.Thread(target=self._heartbeat_loop, name="ncp-heartbeat", daemon=True)
            self._heartbeat.start()
        return self._raw_call(method, path, body, headers)

    def _heartbeat_loop(self):
        while not self._stopped.wait(1):
            try:
                self.session.ensure(self._raw_call)
            except Exception:
                # The next foreground call reports the bounded transport error.
                # A rejected lease is never replaced with a fresh generation.
                pass

    def close(self):
        if self._stopped.is_set():
            return
        self._stopped.set()
        if self._heartbeat is not None:
            self._heartbeat.join(timeout=self.timeout + 1)
        headers = {INSTANCE_HEADER: self.instance_id}
        if self.session.release():
            try:
                self._raw_call("POST", "/api/connector/disconnect", {}, headers)
            except Exception:
                pass
