# SPDX-License-Identifier: MIT
"""Nilo Connector Protocol 1.2, hub-http-v1 profile. Python 3.10+, stdlib only.

Credentials arrive through a private stdin pipe; never persist or print Bootstrap.
DurableRunner is a small synchronous reference for short work (<60 seconds).
"""
from __future__ import annotations

import dataclasses
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
from typing import Callable, TextIO
import urllib.error
import urllib.parse
import urllib.request
import uuid


VERSION = "1.2.0"
SUPPORTED_PROTOCOLS = ({"major": 1, "minor": 0}, {"major": 1, "minor": 1}, {"major": 1, "minor": 2})
RUNTIME_MODEL_SCOPES = ("draft", "conversation", "defaults")
RUNTIME_NATIVE_SETTINGS = ("codex", "claude")
RUNTIME_MAX_INPUT_LENGTH = 1_000_000
RUNTIME_MAX_COMMANDS = 64
_RUNTIME_COMMAND = re.compile(r"/[A-Za-z0-9][A-Za-z0-9_-]{0,63}")


def _bounded_text(value) -> bool:
    return isinstance(value, str) and 1 <= len(value) <= 200


def validate_runtime_capabilities(capabilities: dict) -> None:
    """Raise ValueError if the NCP 1.2 fields of RuntimeReport.capabilities are invalid."""
    if not isinstance(capabilities, dict):
        raise ValueError("capabilities")
    if "maxInputLength" in capabilities:
        n = capabilities["maxInputLength"]
        if isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= RUNTIME_MAX_INPUT_LENGTH:
            raise ValueError("maxInputLength")
    if "modelScopes" in capabilities:
        scopes = capabilities["modelScopes"]
        if (not isinstance(scopes, list) or len(set(map(str, scopes))) != len(scopes)
                or any(scope not in RUNTIME_MODEL_SCOPES for scope in scopes)):
            raise ValueError("modelScopes")
    if "nativeSettings" in capabilities and capabilities["nativeSettings"] not in RUNTIME_NATIVE_SETTINGS:
        raise ValueError("nativeSettings")
    if "boundSessionSettings" in capabilities and not isinstance(capabilities["boundSessionSettings"], bool):
        raise ValueError("boundSessionSettings")
    if "commands" in capabilities:
        commands = capabilities["commands"]
        if not isinstance(commands, list) or len(commands) > RUNTIME_MAX_COMMANDS:
            raise ValueError("commands")
        seen = set()
        for item in commands:
            if (not isinstance(item, dict) or not set(item) <= {"command", "description", "usage", "newTopic"}
                    or not isinstance(item.get("command"), str) or not _RUNTIME_COMMAND.fullmatch(item["command"])
                    or item["command"].lower() in seen or not _bounded_text(item.get("description"))
                    or ("usage" in item and not _bounded_text(item["usage"]))
                    or ("newTopic" in item and not isinstance(item["newTopic"], bool))):
                raise ValueError("commands")
            seen.add(item["command"].lower())


def starts_new_topic(commands, text: str) -> bool:
    """True when text's first word is a declared newTopic command, optionally followed by @name."""
    words = text.split()
    if not words:
        return False
    head = words[0].lower().split("@", 1)[0]
    return any(item.get("newTopic") is True and item.get("command", "").lower() == head for item in commands or [])


def validate_runtime_selection(selection: dict, report: dict) -> None:
    """Validate a frozen selection against current choices before native work.

    This is validation only: the Connector still owns durable apply-once state,
    ordering and recovery. Model scope authorization occurs when Hub freezes the
    explicit draft or inherited defaults, whose provenance is not in this value.
    """
    def invalid():
        raise ValueError("Session selection is invalid or no longer supported")

    def text(value, limit=256):
        return isinstance(value, str) and 0 < len(value.encode("utf-8")) <= limit

    def scalar(value):
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            try:
                return math.isfinite(value)
            except OverflowError:
                return False
        return (value is None or isinstance(value, bool)
                or isinstance(value, str) and len(value.encode("utf-8")) <= 1024)

    def same(left, right):
        # JSON booleans are not numbers, unlike Python's True == 1.
        if isinstance(left, bool) != isinstance(right, bool):
            return False
        return left == right

    caps = report.get("capabilities", {})
    if (caps.get("sessionSelection") is not True or not isinstance(selection, dict)
            or not set(selection) <= {"model", "effort", "settings"}):
        invalid()
    if "model" in selection:
        model = selection["model"]
        if (not isinstance(model, dict) or set(model) != {"model", "provider"}
                or not text(model.get("model")) or not text(model.get("provider"))):
            invalid()
        choice = next((item for item in report.get("models", [])
                       if item.get("model") == model["model"] and item.get("provider") == model["provider"]), None)
        if caps.get("switchModel") is not True or choice is None:
            invalid()
        if "effort" in selection and (not text(selection["effort"]) or caps.get("reasoning") is not True
                or not any(item.get("id") == selection["effort"] for item in choice.get("reasoningEfforts", []))):
            invalid()
    elif "effort" in selection:
        invalid()
    if "settings" in selection:
        settings = selection["settings"]
        if (not isinstance(settings, dict) or len(settings) > 64
                or settings and caps.get("updateSettings") is not True):
            invalid()
        allowed = (report.get("settings") or {}).get("allowed", {})
        for key, value in settings.items():
            if (not isinstance(key, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,63}", key)
                    or not scalar(value) or not any(same(option, value) for option in allowed.get(key, []))):
                invalid()


class ProtocolError(RuntimeError):
    """Safe to log: intentionally excludes response bodies and credentials."""

    def __init__(self, code: str, status: int = 0):
        self.code = code if isinstance(code, str) and re.fullmatch(r"[a-z_]{1,80}", code) else "protocol_error"
        self.status = status
        super().__init__(f"{self.code} (HTTP {status})" if status else self.code)


class TransportError(ProtocolError):
    def __init__(self):
        super().__init__("transport_unavailable")


class SafeToRetry(Exception):
    """Raise ONLY when the upstream action certainly has not started."""


@dataclasses.dataclass(repr=False, frozen=True)
class Bootstrap:
    hub_url: str
    token: str
    instance_id: str
    agent_id: str
    connector_id: str
    manifest: dict
    state_dir: Path
    management_token: str | None = None

    def __repr__(self) -> str:
        return "Bootstrap(<private>)"

    @classmethod
    def read(cls, stream: TextIO | None = None) -> Bootstrap:
        stream = stream or sys.stdin
        line = stream.readline(131073)
        try:
            if len(line) > 131072:
                raise ValueError()
            value = json.loads(line)
            if value["protocol"] != "nilo-connector-bootstrap" or value["version"] != 1:
                raise ValueError()
            hub_url = validate_hub_url(value["hubUrl"])
            token = value["token"]
            if not isinstance(token, str) or not token or len(token) > 4096 or any(c.isspace() for c in token):
                raise ValueError()
            instance_id = str(uuid.UUID(value["instanceId"]))
            agent_id = str(uuid.UUID(value["agentId"]))
            manifest = value["manifest"]
            if not isinstance(manifest, dict) or manifest["id"] != value["connectorId"]:
                raise ValueError()
            state_dir = Path(value["stateDir"])
            if not state_dir.is_absolute():
                raise ValueError()
            management = value.get("managementToken")
            if "runtime.manage" in manifest.get("capabilities", []):
                if (not isinstance(management, str) or not management or len(management) > 4096
                        or any(c.isspace() for c in management) or management == token):
                    raise ValueError()
            elif management is not None:
                raise ValueError()
            return cls(hub_url, token, instance_id, agent_id, manifest["id"], manifest, state_dir, management)
        except (KeyError, TypeError, ValueError, AttributeError):
            raise ProtocolError("invalid_bootstrap") from None


def validate_hub_url(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(value)
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ValueError()
        if not parsed.hostname or parsed.port == 0:
            raise ValueError()
        if parsed.scheme != "https":
            loopback = parsed.hostname == "localhost"
            try:
                loopback = loopback or ipaddress.ip_address(parsed.hostname).is_loopback
            except ValueError:
                pass
            if parsed.scheme != "http" or not loopback:
                raise ValueError()
        return value.rstrip("/")
    except (ValueError, TypeError, AttributeError):
        raise ProtocolError("invalid_hub_url") from None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # In particular, never forward Authorization to another origin.
        return None


class Client:
    def __init__(self, bootstrap: Bootstrap, *, attempts: int = 3):
        self.bootstrap = bootstrap
        self.attempts = max(1, min(attempts, 5))
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        self.ready = False
        self.last_heartbeat = 0.0

    def request(self, method: str, path: str, body=None):
        if not path.startswith("/api/connector/") or "#" in path or "\r" in path or "\n" in path:
            raise ProtocolError("invalid_path")
        data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
        if data is not None and len(data) > 131072:
            raise ProtocolError("payload_too_large")
        headers = {"Authorization": "Bearer " + self.bootstrap.token,
                   "X-Nilo-Connector-Instance": self.bootstrap.instance_id,
                   "Accept": "application/json", "Content-Type": "application/json"}
        management = path.split("?", 1)[0] == "/api/connector/handshake" or path.startswith((
            "/api/connector/runtime/", "/api/connector/coding/", "/api/connector/native/"))
        if management and "runtime.manage" in self.bootstrap.manifest.get("capabilities", []):
            if not self.bootstrap.management_token:
                raise ProtocolError("management_credential_required")
            headers["X-Agent-Inbox-Management-Token"] = self.bootstrap.management_token
        for attempt in range(self.attempts):
            request = urllib.request.Request(self.bootstrap.hub_url + path, data=data, headers=headers, method=method)
            try:
                with self.opener.open(request, timeout=25) as response:
                    raw = response.read(1048577)
                    if len(raw) > 1048576:
                        raise ProtocolError("response_too_large")
                    if not raw:
                        return None
                    try:
                        return json.loads(raw)
                    except (ValueError, UnicodeError):
                        raise ProtocolError("invalid_response") from None
            except urllib.error.HTTPError as error:
                try:
                    value = json.loads(error.read(4096))
                    nested = value.get("error", {})
                    code = nested.get("code", "request_failed") if isinstance(nested, dict) else nested
                except (ValueError, UnicodeError, AttributeError):
                    code = "request_failed"
                finally:
                    error.close()
                if error.code not in (429, 502, 503, 504) or attempt + 1 == self.attempts:
                    raise ProtocolError(code, error.code) from None
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
                if attempt + 1 == self.attempts:
                    raise TransportError() from None
            time.sleep(min(0.2 * (2 ** attempt), 2))
        raise TransportError()

    def handshake(self):
        value = self.request("POST", "/api/connector/handshake", {
            "connector": self.bootstrap.manifest, "instanceId": self.bootstrap.instance_id})
        protocol = value.get("protocol") if isinstance(value, dict) else None
        declared = self.bootstrap.manifest.get("protocol", {})
        if (not isinstance(value, dict) or value.get("instanceId") != self.bootstrap.instance_id
                or value.get("agentId") != self.bootstrap.agent_id
                or protocol not in SUPPORTED_PROTOCOLS
                or protocol != declared):
            raise ProtocolError("handshake_mismatch")
        self.ready = True
        self.last_heartbeat = time.monotonic()
        return value

    def heartbeat(self):
        value = self.request("POST", "/api/connector/heartbeat", {})
        self.last_heartbeat = time.monotonic()
        return value

    def disconnect(self):
        value = self.request("POST", "/api/connector/disconnect", {})
        self.ready = False
        return value

    def maintain(self):
        if not self.ready:
            self.handshake()
        elif time.monotonic() - self.last_heartbeat >= 25:
            try:
                self.heartbeat()
            except ProtocolError as error:
                if error.status != 409 or error.code != "connector_instance_invalid":
                    raise
                # An expired lease may still belong to this exact process.
                # Hub rejects retired/replaced identities; never rotate the UUID
                # or replay upstream work to recover from that rejection.
                self.handshake()

    def poll(self, poll_id: str, wait: int = 20) -> list[dict]:
        self.maintain()
        poll_id = str(uuid.UUID(poll_id))
        query = urllib.parse.urlencode({"wait": max(0, min(wait, 20)), "pollId": poll_id})
        value = self.request("GET", "/api/connector/inbox?" + query)
        if not isinstance(value, dict) or not isinstance(value.get("deliveries"), list):
            raise ProtocolError("invalid_response")
        return value["deliveries"]

    def send(self, conversation_id: str, text: str, client_message_id: str):
        conversation_id = str(uuid.UUID(conversation_id))
        client_message_id = str(uuid.UUID(client_message_id))
        return self.request("POST", f"/api/connector/conversations/{conversation_id}/messages", {
            "text": text, "clientMessageId": client_message_id})

    def ack(self, delivery_id: str, *, ok: bool, uncertain: bool = False, error: str = ""):
        delivery_id = str(uuid.UUID(delivery_id))
        if ok and uncertain:
            raise ValueError("successful acknowledgement cannot be uncertain")
        body = {"ok": ok}
        if uncertain:
            body["uncertain"] = True
        if error:
            body["error"] = error
        return self.request("POST", f"/api/connector/deliveries/{delivery_id}/ack", body)


class Journal:
    """Exclusive, private SQLite journal; no bearer token is ever stored here."""

    def __init__(self, bootstrap: Bootstrap):
        self.directory = bootstrap.state_dir
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.directory.is_symlink():
            raise ProtocolError("unsafe_state_directory")
        if os.name != "nt":
            info = self.directory.stat()
            if info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ProtocolError("unsafe_state_directory")
        self.lock = self._private_file(self.directory / "connector.lock")
        try:
            if os.name == "nt":
                import msvcrt
                if os.fstat(self.lock).st_size == 0:
                    os.write(self.lock, b"0")
                os.lseek(self.lock, 0, os.SEEK_SET)
                msvcrt.locking(self.lock, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(self.lock)
            self.lock = None
            raise ProtocolError("state_in_use") from None
        try:
            path = self.directory / "journal.sqlite3"
            os.close(self._private_file(path))
            # Parent mode 0700 also protects journal/WAL sidecars.
            self.db = sqlite3.connect(str(path))
            self.db.row_factory = sqlite3.Row
            self.db.execute("PRAGMA synchronous=FULL")
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS deliveries (
                    id TEXT PRIMARY KEY, payload TEXT NOT NULL, state TEXT NOT NULL,
                    reply TEXT, reply_id TEXT NOT NULL, error TEXT
                );
            """)
            binding = hashlib.sha256(json.dumps([bootstrap.hub_url, bootstrap.agent_id, bootstrap.connector_id]).encode()).hexdigest()
            previous = self.get("binding")
            if previous is not None and previous != binding:
                raise ProtocolError("state_identity_mismatch")
            with self.db:
                self.set("binding", binding)
                # An upstream call may have happened before a crash. Never repeat it.
                self.db.execute("UPDATE deliveries SET state='uncertain',error='Execution outcome is unknown; reconcile before retrying.' WHERE state='running'")
        except BaseException:
            self.close()
            raise

    @staticmethod
    def _private_file(path: Path) -> int:
        if path.is_symlink():
            raise ProtocolError("unsafe_state_file")
        fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
        if os.name != "nt":
            info = os.fstat(fd)
            if info.st_uid != os.getuid() or info.st_mode & 0o077:
                os.close(fd)
                raise ProtocolError("unsafe_state_file")
        return fd

    def get(self, key: str):
        row = self.db.execute("SELECT value FROM metadata WHERE key=?", (key,)).fetchone()
        return row[0] if row else None

    def set(self, key: str, value: str):
        self.db.execute("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

    def poll_id(self) -> str:
        with self.db:
            poll_id = self.get("poll_id")
            if not poll_id:
                poll_id = str(uuid.uuid4())
                self.set("poll_id", poll_id)
        return poll_id

    def received(self, deliveries: list[dict]):
        with self.db:
            for delivery in deliveries:
                try:
                    delivery_id = str(uuid.UUID(delivery["id"]))
                    uuid.UUID(delivery["conversation"]["id"])
                    uuid.UUID(delivery["message"]["id"])
                    if not isinstance(delivery["message"]["text"], str):
                        raise ValueError()
                except (KeyError, ValueError, TypeError, AttributeError):
                    raise ProtocolError("invalid_delivery") from None
                reply_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "nilo-connector:reply:" + delivery_id))
                self.db.execute("INSERT OR IGNORE INTO deliveries(id,payload,state,reply_id) VALUES(?,?,'pending',?)", (delivery_id, json.dumps(delivery), reply_id))

    def active(self):
        return self.db.execute("SELECT * FROM deliveries WHERE state!='done' ORDER BY rowid").fetchall()

    def transition(self, delivery_id: str, state: str, reply=None, error=None):
        with self.db:
            self.db.execute("UPDATE deliveries SET state=?,reply=coalesce(?,reply),error=coalesce(?,error) WHERE id=?", (state, reply, error, delivery_id))

    def complete_poll(self):
        if not self.active():
            with self.db:
                self.db.execute("DELETE FROM metadata WHERE key='poll_id'")

    def close(self):
        db = getattr(self, "db", None)
        if db is not None:
            db.close()
            self.db = None
        lock = getattr(self, "lock", None)
        if lock is not None:
            os.close(lock)
            self.lock = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class DurableRunner:
    def __init__(self, client: Client, journal: Journal, handler: Callable[[dict, str], str]):
        self.client, self.journal, self.handler = client, journal, handler

    def _handle(self, row):
        delivery_id, state = row["id"], row["state"]
        delivery = json.loads(row["payload"])
        if state == "pending":
            for attempt in range(3):
                self.journal.transition(delivery_id, "running")
                try:
                    reply = self.handler(delivery, delivery_id)
                    if not isinstance(reply, str) or not reply.strip():
                        raise ValueError("empty reply")
                except SafeToRetry:
                    # This exception is a promise by the Connector author, not a
                    # deduction from a timeout or transport failure.
                    self.journal.transition(delivery_id, "pending")
                    if attempt < 2:
                        continue
                    self.journal.transition(delivery_id, "failed", error="Upstream did not start; retry budget exhausted.")
                    state = "failed"
                except Exception:
                    self.journal.transition(delivery_id, "uncertain", error="Execution outcome is unknown; reconcile before retrying.")
                    state = "uncertain"
                else:
                    self.journal.transition(delivery_id, "prepared", reply=reply)
                    state = "prepared"
                break
        if state in ("prepared", "sent"):
            if state == "prepared":
                current = self.journal.db.execute("SELECT * FROM deliveries WHERE id=?", (delivery_id,)).fetchone()
                self.client.send(delivery["conversation"]["id"], current["reply"], current["reply_id"])
                self.journal.transition(delivery_id, "sent")
            self.client.ack(delivery_id, ok=True)
        elif state in ("uncertain", "failed"):
            current = self.journal.db.execute("SELECT error FROM deliveries WHERE id=?", (delivery_id,)).fetchone()
            self.client.ack(delivery_id, ok=False, uncertain=state == "uncertain", error=current[0])
        else:
            raise ProtocolError("invalid_journal_state")
        self.journal.transition(delivery_id, "done")

    def run_once(self, *, wait: int = 20) -> int:
        self.client.maintain()
        rows = self.journal.active()
        if not rows:
            self.journal.received(self.client.poll(self.journal.poll_id(), wait))
            rows = self.journal.active()
        for row in rows:
            # A batch can outlast the lease even when each handler is short.
            # Refresh between upstream actions, before entering the next one.
            self.client.maintain()
            self._handle(row)
        self.journal.complete_poll()
        return len(rows)
