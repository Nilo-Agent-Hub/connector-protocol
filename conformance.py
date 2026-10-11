#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Check the reference SDK or a local Connector's basic NCP wire lifecycle.

This command executes --executable with current-user permissions. It is not a
sandbox, publisher certification or an arbitrary-code safety check.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import uuid


def executable_check(executable: Path, manifest: dict, timeout: float) -> bool:
    token, agent_id, instance_id = "fixture-" + uuid.uuid4().hex, str(uuid.uuid4()), str(uuid.uuid4())
    conversation_id, delivery_id = str(uuid.uuid4()), str(uuid.uuid4())
    delivery = {"id": delivery_id, "conversation": {"id": conversation_id},
                "message": {"id": str(uuid.uuid4()), "role": "user", "text": "NCP conformance probe"}, "history": []}
    acknowledged = threading.Event()
    messages, problems = {}, []
    handshaken = False

    def session_response():
        expires = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=90)
        return {"protocol": {"major": 1, "minor": 0}, "agentId": agent_id, "instanceId": instance_id,
                "connector": manifest, "heartbeatIntervalSeconds": 30,
                "leaseExpiresAt": expires.isoformat().replace("+00:00", "Z")}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            self.handle_api()

        def do_POST(self):
            self.handle_api()

        def handle_api(self):
            nonlocal handshaken
            try:
                assert self.headers.get("Authorization") == "Bearer " + token, "missing scoped credential"
                length = int(self.headers.get("Content-Length", "0"))
                assert 0 <= length <= 131072, "oversized body"
                body = json.loads(self.rfile.read(length) or "{}")
                path = urlsplit(self.path).path
                result = {}
                status = 200
                if self.command == "POST" and path == "/api/connector/handshake":
                    assert body == {"connector": manifest, "instanceId": instance_id}, "handshake declaration mismatch"
                    handshaken = True
                    result = session_response()
                else:
                    assert handshaken, "request before handshake"
                    assert self.headers.get("X-Nilo-Connector-Instance") == instance_id, "missing instance fence"
                    if self.command == "GET" and path == "/api/connector/inbox":
                        result = {"deliveries": [] if acknowledged.is_set() else [delivery]}
                        if acknowledged.is_set():
                            time.sleep(0.05)
                    elif self.command == "POST" and path == "/api/connector/conversations/" + conversation_id + "/messages":
                        key = str(uuid.UUID(body["clientMessageId"]))
                        assert isinstance(body.get("text"), str) and body["text"].strip(), "missing text reply"
                        assert set(body) <= {"text", "clientMessageId", "streaming"}, "unsupported message extension"
                        previous = messages.get(key)
                        assert previous is None or previous["text"] == body["text"], "idempotency key changed content"
                        result = messages.setdefault(key, {"id": str(uuid.uuid4()), "text": body["text"]})
                        status = 201
                    elif self.command == "POST" and path == "/api/connector/deliveries/" + delivery_id + "/ack":
                        assert body.get("ok") is True, "probe was not acknowledged successfully"
                        assert len(messages) == 1, "expected one reply before ACK"
                        status = 204
                        acknowledged.set()
                    elif self.command == "POST" and path == "/api/connector/heartbeat":
                        result = session_response()
                    elif self.command == "POST" and path == "/api/connector/disconnect":
                        status = 204
                    else:
                        raise AssertionError("unsupported request")
            except (AssertionError, KeyError, ValueError, TypeError) as error:
                problems.append(type(error).__name__)
                status, result = 400, {"error": "validation_error"}
            try:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                if status != 204:
                    self.wfile.write(json.dumps(result).encode())
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        with tempfile.TemporaryDirectory(prefix="ncp-conformance-") as temporary:
            os.chmod(temporary, 0o700)
            bootstrap = {"protocol": "nilo-connector-bootstrap", "version": 1,
                         "hubUrl": "http://127.0.0.1:" + str(server.server_port), "token": token,
                         "instanceId": instance_id, "agentId": agent_id, "connectorId": manifest["id"],
                         "manifest": manifest, "stateDir": temporary}
            with tempfile.TemporaryFile() as output:
                process = subprocess.Popen([str(executable)], cwd=temporary, stdin=subprocess.PIPE, stdout=output, stderr=output,
                                           env={"PATH": os.environ.get("PATH", ""), "HOME": temporary, "TMPDIR": temporary})
                try:
                    process.stdin.write((json.dumps(bootstrap) + "\n").encode())
                    process.stdin.close()
                    deadline = time.monotonic() + timeout
                    while time.monotonic() < deadline and process.poll() is None and not acknowledged.wait(0.05):
                        pass
                finally:
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()
                output.seek(0)
                if token.encode() in output.read():
                    problems.append("credential_in_output")
    finally:
        server.shutdown()
        server.server_close()
        worker.join()
    if problems or not acknowledged.is_set():
        print("FAIL: executable did not complete a valid handshake, delivery, reply and ACK, or exposed the fixture credential.", file=sys.stderr)
        return False
    print("PASS: executable handshake, scoped HTTP requests, one reply and ACK; fixture credential absent from output.")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", type=Path, help="run this trusted local executable against a temporary Hub fixture")
    parser.add_argument("--manifest", type=Path, help="the executable's public manifest")
    parser.add_argument("--timeout", type=float, default=10, help="maximum seconds for the executable to answer the probe")
    args = parser.parse_args()
    if (args.executable is None) != (args.manifest is None):
        parser.error("--executable and --manifest must be supplied together")
    if not 1 <= args.timeout <= 120:
        parser.error("--timeout must be between 1 and 120 seconds")
    if args.executable is None:
        suite = unittest.defaultTestLoader.discover(str(Path(__file__).resolve().parent / "tests"), pattern="test_*.py")
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    try:
        manifest = json.loads(args.manifest.read_text())
        return 0 if executable_check(args.executable.resolve(strict=True), manifest, args.timeout) else 1
    except (OSError, ValueError, KeyError, TypeError):
        print("FAIL: could not load manifest or execute Connector.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
