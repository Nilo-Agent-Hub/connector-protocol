# SPDX-License-Identifier: MIT
import dataclasses
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import uuid
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from ncp import Bootstrap, Client, DurableRunner, Journal, ProtocolError, SafeToRetry, TransportError

MANIFEST = json.loads((Path(__file__).resolve().parents[1] / "examples" / "echo.manifest.json").read_text())


def bootstrap(directory, url="http://127.0.0.1:1"):
    return Bootstrap(url, "private-test-token", str(uuid.uuid4()), str(uuid.uuid4()), MANIFEST["id"], MANIFEST, Path(directory))


def delivery():
    return {"id": str(uuid.uuid4()), "conversation": {"id": str(uuid.uuid4())},
            "message": {"id": str(uuid.uuid4()), "text": "hello"}, "history": []}


class FakeClient:
    def __init__(self, item=None):
        self.item = item or delivery()
        self.polls, self.sends, self.acks = [], [], []
        self.messages = {}
        self.drop_send = False
        self.drop_ack = False
        self.drop_poll = False

    def maintain(self):
        pass

    def poll(self, poll_id, wait):
        self.polls.append(poll_id)
        if self.drop_poll:
            self.drop_poll = False
            raise TransportError()
        return [self.item]

    def send(self, conversation_id, text, key):
        self.sends.append(key)
        self.messages.setdefault(key, {"id": str(uuid.uuid4()), "text": text})
        if self.drop_send:
            self.drop_send = False
            raise TransportError()
        return self.messages[key]

    def ack(self, delivery_id, **body):
        self.acks.append((delivery_id, body))
        if self.drop_ack:
            self.drop_ack = False
            raise TransportError()


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.boot = bootstrap(self.temp.name)

    def test_lost_outbound_response_restarts_with_same_key_without_repeating_work(self):
        client = FakeClient()
        client.drop_send = True
        calls = []
        with Journal(self.boot) as journal:
            runner = DurableRunner(client, journal, lambda d, key: calls.append(key) or "reply")
            with self.assertRaises(TransportError):
                runner.run_once(wait=0)
        with Journal(self.boot) as journal:
            self.assertEqual(DurableRunner(client, journal, lambda *_: self.fail("upstream repeated")).run_once(wait=0), 1)
            self.assertFalse(journal.active())
        self.assertEqual(len(calls), 1)
        self.assertEqual(client.sends[0], client.sends[1])
        self.assertEqual(len(client.messages), 1)
        self.assertEqual(client.acks[0][1], {"ok": True})

    def test_lost_ack_response_does_not_repeat_send_or_upstream(self):
        client = FakeClient()
        client.drop_ack = True
        with Journal(self.boot) as journal:
            with self.assertRaises(TransportError):
                DurableRunner(client, journal, lambda *_: "reply").run_once(wait=0)
        with Journal(self.boot) as journal:
            DurableRunner(client, journal, lambda *_: self.fail("upstream repeated")).run_once(wait=0)
        self.assertEqual(len(client.sends), 1)
        self.assertEqual(len(client.acks), 2)
        self.assertEqual(client.acks[0], client.acks[1])

    def test_poll_id_is_persisted_before_transport_failure(self):
        client = FakeClient()
        client.drop_poll = True
        with Journal(self.boot) as journal:
            with self.assertRaises(TransportError):
                DurableRunner(client, journal, lambda *_: "reply").run_once(wait=0)
        with Journal(self.boot) as journal:
            DurableRunner(client, journal, lambda *_: "reply").run_once(wait=0)
        self.assertEqual(client.polls[0], client.polls[1])

    def test_duplicate_delivery_never_repeats_upstream(self):
        client = FakeClient()
        calls = []
        with Journal(self.boot) as journal:
            runner = DurableRunner(client, journal, lambda d, key: calls.append(key) or "reply")
            runner.run_once(wait=0)
            runner.run_once(wait=0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(client.sends), 1)

    def test_batch_refreshes_lease_between_upstream_actions(self):
        client = FakeClient()
        client.maintain = mock.Mock()
        with Journal(self.boot) as journal:
            journal.received([delivery(), delivery()])
            checks = []
            DurableRunner(client, journal, lambda *_: checks.append(client.maintain.call_count) or "reply").run_once(wait=0)
        self.assertEqual(checks, [2, 3])

    def test_crash_after_upstream_start_marks_uncertain_without_replay(self):
        class SimulatedPowerLoss(BaseException):
            pass

        def crash(*_):
            raise SimulatedPowerLoss()

        client = FakeClient()
        with Journal(self.boot) as journal:
            with self.assertRaises(SimulatedPowerLoss):
                DurableRunner(client, journal, crash).run_once(wait=0)
        with Journal(self.boot) as journal:
            DurableRunner(client, journal, lambda *_: self.fail("uncertain action replayed")).run_once(wait=0)
        self.assertFalse(client.sends)
        self.assertTrue(client.acks[0][1]["uncertain"])
        self.assertFalse(client.acks[0][1]["ok"])

    def test_transport_exception_from_upstream_is_uncertain_and_redacted(self):
        secret = "private-upstream-key"

        def upstream(*_):
            raise OSError(secret)

        client = FakeClient()
        with Journal(self.boot) as journal:
            DurableRunner(client, journal, upstream).run_once(wait=0)
        self.assertTrue(client.acks[0][1]["uncertain"])
        self.assertNotIn(secret, repr(client.acks))
        self.assertNotIn(secret.encode(), (Path(self.temp.name) / "journal.sqlite3").read_bytes())

    def test_only_proven_unstarted_work_is_retried(self):
        calls = []

        def upstream(_, key):
            calls.append(key)
            if len(calls) < 3:
                raise SafeToRetry()
            return "reply"

        client = FakeClient()
        with Journal(self.boot) as journal:
            DurableRunner(client, journal, upstream).run_once(wait=0)
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(set(calls)), 1)
        self.assertEqual(len(client.sends), 1)

    def test_state_is_private_exclusive_and_identity_bound(self):
        with Journal(self.boot):
            with self.assertRaisesRegex(ProtocolError, "state_in_use"):
                Journal(self.boot)
        with self.assertRaisesRegex(ProtocolError, "state_identity_mismatch"):
            Journal(dataclasses.replace(self.boot, agent_id=str(uuid.uuid4())))
        if os.name != "nt":
            self.assertEqual((Path(self.temp.name) / "journal.sqlite3").stat().st_mode & 0o777, 0o600)
        self.assertNotIn(self.boot.token.encode(), (Path(self.temp.name) / "journal.sqlite3").read_bytes())

    def test_symlink_journal_is_rejected(self):
        target = Path(self.temp.name) / "elsewhere"
        target.write_text("untouched")
        (Path(self.temp.name) / "journal.sqlite3").symlink_to(target)
        with self.assertRaisesRegex(ProtocolError, "unsafe_state_file"):
            Journal(self.boot)
        self.assertEqual(target.read_text(), "untouched")


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.requests = []
        self.messages = {}
        self.drop_send = True
        test = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                self.do_POST()

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or "null")
                test.requests.append((self.path, dict(self.headers), body))
                if self.path == "/api/connector/handshake":
                    response = {"protocol": {"major": 1, "minor": 0}, "agentId": test.boot.agent_id,
                                "instanceId": test.boot.instance_id}
                elif self.path.endswith("/messages"):
                    response = test.messages.setdefault(body["clientMessageId"], {"id": str(uuid.uuid4())})
                    if test.drop_send:
                        test.drop_send = False
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close()
                        return
                elif self.path.endswith("/redirect"):
                    self.send_response(307)
                    self.send_header("Location", test.boot.hub_url + "/must-not-follow")
                    self.end_headers()
                    return
                elif self.path.endswith("/denied"):
                    self.send_response(403)
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "connector_capability_denied", "message": test.boot.token}).encode())
                    return
                elif self.path.endswith("/malformed-error"):
                    self.send_response(403)
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": {"code": [test.boot.token]}}).encode())
                    return
                else:
                    response = {"deliveries": []}
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.cleanup_server)
        self.boot = bootstrap(self.temp.name, "http://127.0.0.1:" + str(self.server.server_port))
        self.client = Client(self.boot)

    def cleanup_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_send_retries_with_instance_header_and_same_id(self):
        self.client.handshake()
        key = str(uuid.uuid4())
        self.client.send(str(uuid.uuid4()), "reply", key)
        self.assertEqual(len(self.messages), 1)
        self.assertEqual(len(self.requests), 3)
        for _, headers, _ in self.requests:
            self.assertEqual(headers["Authorization"], "Bearer " + self.boot.token)
            self.assertEqual(headers["X-Nilo-Connector-Instance"], self.boot.instance_id)
        self.assertEqual(self.requests[1][2], self.requests[2][2])

    def test_redirect_is_not_followed(self):
        with self.assertRaises(ProtocolError):
            self.client.request("GET", "/api/connector/redirect")
        self.assertEqual(len(self.requests), 1)

    def test_capability_error_is_fatal_and_response_secret_not_exposed(self):
        with self.assertRaises(ProtocolError) as caught:
            self.client.request("POST", "/api/connector/denied", {})
        self.assertEqual(caught.exception.code, "connector_capability_denied")
        self.assertEqual(caught.exception.status, 403)
        self.assertNotIn(self.boot.token, str(caught.exception))
        self.assertEqual(len(self.requests), 1)

    def test_malformed_error_code_cannot_expose_response_body(self):
        with self.assertRaises(ProtocolError) as caught:
            self.client.request("POST", "/api/connector/malformed-error", {})
        self.assertEqual(caught.exception.code, "protocol_error")
        self.assertNotIn(self.boot.token, str(caught.exception))


class LeaseTests(unittest.TestCase):
    def setUp(self):
        self.boot = bootstrap("/unused-private-state")
        self.client = Client(self.boot, attempts=1)
        self.client.ready = True
        self.client.last_heartbeat = 0
        self.heartbeat_call = mock.call("POST", "/api/connector/heartbeat", {})
        self.handshake_call = mock.call("POST", "/api/connector/handshake", {
            "connector": self.boot.manifest, "instanceId": self.boot.instance_id})

    def test_minor_one_handshake_requires_the_declared_protocol(self):
        manifest = {**self.boot.manifest, "protocol": {"major": 1, "minor": 1}}
        client = Client(dataclasses.replace(self.boot, manifest=manifest), attempts=1)
        session = {"protocol": manifest["protocol"], "agentId": self.boot.agent_id,
                   "instanceId": self.boot.instance_id}
        client.request = mock.Mock(return_value=session)
        client.handshake()
        self.assertTrue(client.ready)
        for protocol in ({"major": 1, "minor": 0}, {"major": 2, "minor": 0}, {"major": 1, "minor": 2}):
            client.request.return_value = {**session, "protocol": protocol}
            with self.subTest(protocol=protocol), self.assertRaises(ProtocolError):
                client.handshake()

    def test_expired_current_instance_reclaims_same_lease_once(self):
        session = {"protocol": {"major": 1, "minor": 0}, "agentId": self.boot.agent_id,
                   "instanceId": self.boot.instance_id}
        self.client.request = mock.Mock(side_effect=[ProtocolError("connector_instance_invalid", 409), session])
        with mock.patch("ncp.time.monotonic", return_value=100):
            self.client.maintain()
            self.client.maintain()
        self.assertEqual(self.client.request.call_args_list, [self.heartbeat_call, self.handshake_call])
        self.assertEqual(self.client.last_heartbeat, 100)

    def test_retired_instance_fails_after_one_same_identity_handshake(self):
        self.client.request = mock.Mock(side_effect=[ProtocolError("connector_instance_invalid", 409),
                                                   ProtocolError("connector_instance_invalid", 409)])
        with mock.patch("ncp.time.monotonic", return_value=100), self.assertRaises(ProtocolError):
            self.client.maintain()
        self.assertEqual(self.client.request.call_args_list, [self.heartbeat_call, self.handshake_call])
        self.assertEqual(self.client.bootstrap.instance_id, self.boot.instance_id)

    def test_revoked_credential_is_not_rehandshaken(self):
        self.client.request = mock.Mock(side_effect=ProtocolError("unauthorized", 401))
        with mock.patch("ncp.time.monotonic", return_value=100), self.assertRaises(ProtocolError):
            self.client.maintain()
        self.assertEqual(self.client.request.call_args_list, [self.heartbeat_call])


class BootstrapTests(unittest.TestCase):
    def test_private_stdin_round_trip_and_credential_repr(self):
        value = {"protocol": "nilo-connector-bootstrap", "version": 1,
                 "hubUrl": "https://hub.example", "token": "secret-value",
                 "instanceId": str(uuid.uuid4()), "agentId": str(uuid.uuid4()),
                 "connectorId": MANIFEST["id"], "manifest": MANIFEST, "stateDir": "/private/state"}
        boot = Bootstrap.read(io.StringIO(json.dumps(value) + "\n"))
        self.assertEqual(boot.token, value["token"])
        self.assertNotIn(value["token"], repr(boot))
        for url in ("http://hub.example", "https://user:secret@hub.example", "https://hub.example/?token=secret"):
            with self.subTest(url=url), self.assertRaises(ProtocolError):
                Bootstrap.read(io.StringIO(json.dumps(dict(value, hubUrl=url))))

    def test_zipapp_runs_without_repo_dependencies(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temporary:
            executable = Path(temporary) / "echo-connector"
            subprocess.run([sys.executable, str(root / "build_echo.py"), "--output", str(executable)], check=True)
            with zipfile.ZipFile(executable) as package:
                self.assertEqual(package.read("LICENSE"), (root / "LICENSE").read_bytes())
            result = subprocess.run([sys.executable, str(executable)], input="{\"token\":\"never-log-me\"}\n", text=True,
                                    capture_output=True, cwd=temporary, env={"PATH": os.environ.get("PATH", "")})
            self.assertEqual(result.returncode, 1)
            self.assertIn("invalid_bootstrap", result.stderr)
            self.assertNotIn("never-log-me", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
