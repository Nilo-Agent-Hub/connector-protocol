"""Native channels share the public session protocol without weakening fencing."""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ncp_session import GatewayError, INSTANCE_HEADER, Session, SyncGateway
import ncp_session

MANIFEST = {"schemaVersion": 1, "id": "io.example.test", "name": "Test", "version": "1.0.0",
            "protocol": {"major": 1, "minor": 1}, "capabilities": ["channel.receive", "channel.send"]}


def receipt(body):
    return {"connector": body["connector"], "instanceId": body["instanceId"],
            "protocol": {"major": 1, "minor": 1}, "heartbeatIntervalSeconds": 30}


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def acquire(self):
        session = Session.acquire("https://hub.example", "secret-test", MANIFEST, state_dir=self.directory.name)
        self.addCleanup(session.release)
        return session

    def test_shared_clients_use_one_handshake_and_instance(self):
        first, second = self.acquire(), self.acquire()
        calls = []
        def request(method, path, body, headers):
            calls.append((path, headers))
            return receipt(body)
        self.assertIs(first, second)
        first.ensure(request)
        second.ensure(request)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1][INSTANCE_HEADER], first.instance_id)

    def test_server_rejection_does_not_rotate_instance_or_fallback(self):
        session = self.acquire()
        original = session.instance_id
        calls = []
        def rejected(method, path, body, headers):
            calls.append(path)
            raise GatewayError(403, "connector_approval_mismatch")
        for _ in range(2):
            with self.assertRaises(GatewayError):
                session.ensure(rejected)
        self.assertEqual(session.instance_id, original)
        self.assertEqual(calls, ["/api/connector/handshake"] * 2)

    def test_malformed_handshake_cannot_establish_a_session(self):
        session = self.acquire()
        with self.assertRaises(GatewayError):
            session.ensure(lambda *args: {"protocolVersion": 1})
        self.assertFalse(session.established)

    @unittest.skipIf(os.name == "nt", "Unix filesystem permissions")
    def test_nonprivate_directory_and_symlink_lock_are_rejected(self):
        os.chmod(self.directory.name, 0o755)
        with self.assertRaises(ValueError):
            Session.acquire("https://hub.example", "other", MANIFEST, state_dir=self.directory.name)
        os.chmod(self.directory.name, 0o700)

    @unittest.skipIf(os.name == "nt", "Unix flock coordination")
    def test_separate_process_joins_only_a_live_leader(self):
        leader = self.acquire()
        source = str(Path(__file__).resolve().parents[1])
        program = """
import json, sys
sys.path.insert(0, sys.argv[1])
from ncp_session import Session
s = Session.acquire('https://hub.example', 'secret-test', json.loads(sys.argv[3]), state_dir=sys.argv[2])
print(json.dumps({'leader': s.leader, 'instance': s.instance_id, 'headers': s.headers()}))
s.release()
"""
        result = subprocess.run([sys.executable, "-c", program, source, self.directory.name, json.dumps(MANIFEST)],
                                capture_output=True, text=True, check=True)
        peer = json.loads(result.stdout)
        self.assertFalse(peer["leader"])
        self.assertEqual(peer["instance"], leader.instance_id)
        self.assertEqual(peer["headers"][INSTANCE_HEADER], leader.instance_id)
        descriptor = next(Path(self.directory.name).glob("*.json")).read_text()
        self.assertNotIn("secret-test", descriptor)

    @unittest.skipIf(os.name == "nt", "Unix flock coordination")
    def test_joiner_rejects_a_restarted_leader_without_changing_generation(self):
        leader = Session.acquire("https://hub.example", "secret-test", MANIFEST, state_dir=self.directory.name)
        source = str(Path(__file__).resolve().parents[1])
        program = """
import json, sys
sys.path.insert(0, sys.argv[1])
from ncp_session import Session, GatewayError
s = Session.acquire('https://hub.example', 'secret-test', json.loads(sys.argv[3]), state_dir=sys.argv[2])
print(s.instance_id, flush=True)
sys.stdin.readline()
try:
    s.headers()
    print('BAD: accepted replaced owner', flush=True)
except GatewayError as e:
    print(e.code, flush=True)
s.release()
"""
        peer = subprocess.Popen([sys.executable, "-c", program, source, self.directory.name, json.dumps(MANIFEST)],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual(peer.stdout.readline().strip(), leader.instance_id)
            leader.release()
            replacement = self.acquire()
            self.assertNotEqual(replacement.instance_id, leader.instance_id)
            peer.stdin.write("continue\n")
            peer.stdin.flush()
            self.assertEqual(peer.stdout.readline().strip(), "connector_session_superseded")
            self.assertEqual(peer.wait(timeout=5), 0)
        finally:
            if peer.poll() is None:
                peer.kill()
            peer.communicate()


@unittest.skipIf(os.name == "nt", "Exercises Windows adapter via an AF_UNIX backend")
class WindowsBrokerContractTests(unittest.TestCase):
    def test_authenticated_pipe_join_and_owner_stop_use_same_fencing_contract(self):
        from multiprocessing.connection import Client, Listener
        from multiprocessing import AuthenticationError
        with tempfile.TemporaryDirectory() as directory:
            address = str(Path(directory) / "peer.sock")
            platform = SimpleNamespace(name="nt", getpid=lambda: 1001)
            with patch.object(ncp_session, "os", platform), \
                    patch.object(ncp_session, "_PipeListener", side_effect=lambda addr, **kw: Listener(address, family="AF_UNIX", **kw)), \
                    patch.object(ncp_session, "_PipeClient", side_effect=lambda addr, **kw: Client(address, family="AF_UNIX", **kw)):
                leader = Session.acquire("https://hub.example", "private-secret", MANIFEST, state_dir=directory)
                platform.getpid = lambda: 1002
                peer = Session.acquire("https://hub.example", "private-secret", MANIFEST, state_dir=directory)
                try:
                    self.assertFalse(peer.leader)
                    self.assertEqual(peer.headers()[INSTANCE_HEADER], leader.instance_id)
                    # Knowing the public named-pipe address is not authentication.
                    with self.assertRaises(AuthenticationError):
                        Client(address, family="AF_UNIX", authkey=leader._pipe_address.encode())
                    self.assertEqual(peer.headers()[INSTANCE_HEADER], leader.instance_id)
                    leader.release()
                    with self.assertRaises(GatewayError):
                        peer.headers()
                finally:
                    peer.release()
                    if not leader.closed:
                        leader.release()


class AsyncSessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_parallel_coroutines_cannot_start_parallel_handshakes(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Session.acquire("https://hub.example", "test", MANIFEST, state_dir=directory)
            self.addCleanup(session.release)
            calls = []
            async def request(method, path, body, headers):
                calls.append(path)
                await asyncio.sleep(0.025)
                return receipt(body)
            result = await asyncio.gather(*(session.ensure_async(request) for _ in range(8)))
            self.assertEqual(calls, ["/api/connector/handshake"])
            self.assertTrue(all(item[INSTANCE_HEADER] == session.instance_id for item in result))

    async def test_expired_async_lease_reuses_uuid_and_retired_instance_stays_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Session.acquire("https://hub.example", "test", MANIFEST, state_dir=directory)
            self.addCleanup(session.release)
            clock = SimpleNamespace(now=1.0, deadline=0.0, retired=False)
            calls = []
            async def request(method, path, body, headers):
                calls.append((path, headers[INSTANCE_HEADER]))
                await asyncio.sleep(0)
                if path.endswith("heartbeat") and (clock.now >= clock.deadline or clock.retired):
                    raise GatewayError(409, "connector_instance_invalid")
                if path.endswith("handshake"):
                    if clock.retired:
                        raise GatewayError(409, "connector_instance_invalid")
                    clock.deadline = clock.now + 90
                    return receipt(body)
                return {}
            with patch.object(ncp_session, "time", SimpleNamespace(monotonic=lambda: clock.now)):
                await session.ensure_async(request)
                identity = session.instance_id
                clock.now += 91  # Resume after suspension beyond the server's lease.
                self.assertEqual((await session.ensure_async(request))[INSTANCE_HEADER], identity)
                self.assertEqual([path for path, _ in calls], ["/api/connector/handshake", "/api/connector/heartbeat", "/api/connector/handshake"])
                clock.now += 91
                clock.retired = True
                with self.assertRaises(GatewayError):
                    await session.ensure_async(request)
                self.assertFalse(session.established)
                self.assertEqual(session.instance_id, identity)
                self.assertTrue(all(instance == identity for _, instance in calls))

    async def test_async_other_conflicts_do_not_trigger_rehandshake(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Session.acquire("https://hub.example", "test", MANIFEST, state_dir=directory)
            self.addCleanup(session.release)
            async def accepted(method, path, body, headers):
                return receipt(body)
            await session.ensure_async(accepted)
            session.next_heartbeat = 0
            calls = []
            async def rejected(method, path, body, headers):
                calls.append(path)
                raise GatewayError(409, "connector_instance_busy")
            with self.assertRaises(GatewayError):
                await session.ensure_async(rejected)
            self.assertEqual(calls, ["/api/connector/heartbeat"])


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.calls, self.rejected = [], False
        self.now, self.deadline, self.retired, self.offline = 1.0, 0.0, False, False
        self.heartbeat_error = None
        test = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                self.do_POST()
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
                test.calls.append((self.path, dict(self.headers), body))
                status = 404 if test.rejected and self.path.endswith("handshake") else 200
                result = receipt(body) if self.path.endswith("handshake") and status == 200 else {}
                if self.path.endswith("handshake") and status == 200:
                    if test.retired:
                        status, result = 409, {"error": {"code": "connector_instance_invalid"}}
                    else:
                        test.deadline = test.now + 90
                elif self.path.endswith("heartbeat"):
                    if test.offline:
                        status, result = 503, {"error": {"code": "unavailable"}}
                    elif test.heartbeat_error or test.retired or test.now >= test.deadline:
                        status, result = 409, {"error": {"code": test.heartbeat_error or "connector_instance_invalid"}}
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.gateway = SyncGateway(f"http://127.0.0.1:{server.server_port}", "test-token", manifest=MANIFEST,
                                   state_dir=self.directory.name)
        self.addCleanup(self.gateway.close)

    def test_handshake_and_every_request_are_fenced(self):
        self.gateway.call("GET", "/api/connector/profile")
        self.gateway.session.next_heartbeat = 0
        self.gateway.call("POST", "/api/connector/messages/example", {"text": "hello"})
        self.assertEqual([path for path, _, _ in self.calls], ["/api/connector/handshake", "/api/connector/profile",
                                                               "/api/connector/heartbeat", "/api/connector/messages/example"])
        for _, headers, _ in self.calls:
            self.assertEqual({key.lower(): value for key, value in headers.items()}[INSTANCE_HEADER.lower()], self.gateway.instance_id)
            self.assertNotIn("x-agent-hub-management-token", {key.lower() for key in headers})

    def test_management_secret_is_scoped_and_retired_header_is_stripped(self):
        self.gateway.headers["X-Agent-Hub-Management-Token"] = "management-only"
        self.gateway.headers["X-Agent-Inbox-Management-Token"] = "retired-secret"
        self.gateway.call("GET", "/api/connector/profile")
        for path, headers, _ in self.calls:
            values = {key.lower(): value for key, value in headers.items()}
            self.assertNotIn("x-agent-inbox-management-token", values)
            if path.endswith("/handshake"):
                self.assertEqual(values.get("x-agent-hub-management-token"), "management-only")
            else:
                self.assertNotIn("x-agent-hub-management-token", values)

    def test_missing_protocol_endpoint_never_calls_business_route(self):
        self.rejected = True
        with self.assertRaises(GatewayError):
            self.gateway.call("GET", "/api/connector/profile")
        self.assertEqual([path for path, _, _ in self.calls], ["/api/connector/handshake"])

    def test_owner_routes_are_not_connector_routes(self):
        with self.assertRaises(ValueError):
            self.gateway.call("GET", "/api/agents")
        self.assertEqual(self.calls, [])

    def test_network_outage_past_lease_recovers_with_same_uuid_before_one_business_send(self):
        with patch.object(ncp_session, "time", SimpleNamespace(monotonic=lambda: self.now)):
            self.gateway.call("GET", "/api/connector/profile")
            identity = self.gateway.instance_id
            self.now += 91
            self.offline = True
            with self.assertRaises(GatewayError):
                self.gateway.call("POST", "/api/connector/messages/example", {"text": "once"})
            self.offline = False
            self.gateway.call("POST", "/api/connector/messages/example", {"text": "once"})
            self.assertEqual([path for path, _, _ in self.calls], ["/api/connector/handshake", "/api/connector/profile",
                             "/api/connector/heartbeat", "/api/connector/heartbeat", "/api/connector/handshake",
                             "/api/connector/messages/example"])
            handshakes = [body for path, _, body in self.calls if path.endswith("handshake")]
            self.assertEqual([body["instanceId"] for body in handshakes], [identity, identity])

    def test_replaced_or_disconnected_instance_cannot_resume_or_send(self):
        with patch.object(ncp_session, "time", SimpleNamespace(monotonic=lambda: self.now)):
            self.gateway.call("GET", "/api/connector/profile")
            identity = self.gateway.instance_id
            self.now += 91
            self.retired = True
            for _ in range(2):
                with self.assertRaises(GatewayError):
                    self.gateway.call("POST", "/api/connector/messages/example", {"text": "never"})
            self.assertEqual([path for path, _, _ in self.calls], ["/api/connector/handshake", "/api/connector/profile",
                             "/api/connector/heartbeat", "/api/connector/handshake", "/api/connector/handshake"])
            self.assertEqual(self.gateway.instance_id, identity)
            self.assertFalse(self.gateway.session.established)

    def test_unrelated_heartbeat_conflict_is_not_a_recovery_signal(self):
        self.gateway.call("GET", "/api/connector/profile")
        self.gateway.session.next_heartbeat = 0
        self.heartbeat_error = "connector_instance_busy"
        with self.assertRaises(GatewayError):
            self.gateway.call("GET", "/api/connector/profile")
        self.assertEqual([path for path, _, _ in self.calls], ["/api/connector/handshake", "/api/connector/profile", "/api/connector/heartbeat"])


if __name__ == "__main__":
    unittest.main()
