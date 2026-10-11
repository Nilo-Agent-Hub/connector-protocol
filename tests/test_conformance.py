# SPDX-License-Identifier: MIT
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class ConformanceTests(unittest.TestCase):
    def test_headerless_handshake_and_complete_session_responses(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temporary:
            connector = Path(temporary) / "independent-connector"
            connector.write_text("#!" + sys.executable + "\n" + '''
import datetime
import json
import sys
import urllib.request
import uuid

boot = json.loads(sys.stdin.readline())
def request(method, path, body=None, fenced=True):
    headers = {"Authorization": "Bearer " + boot["token"], "Content-Type": "application/json"}
    if fenced:
        headers["X-Nilo-Connector-Instance"] = boot["instanceId"]
    req = urllib.request.Request(boot["hubUrl"] + path,
        data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
    with urllib.request.urlopen(req) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

def check_session(value):
    assert value["protocol"] == {"major": 1, "minor": 0}
    assert value["agentId"] == boot["agentId"]
    assert value["instanceId"] == boot["instanceId"]
    assert value["connector"] == boot["manifest"]
    assert value["heartbeatIntervalSeconds"] == 30
    expires = datetime.datetime.fromisoformat(value["leaseExpiresAt"].replace("Z", "+00:00"))
    remaining = (expires - datetime.datetime.now(datetime.timezone.utc)).total_seconds()
    assert 85 < remaining <= 90

check_session(request("POST", "/api/connector/handshake",
    {"connector": boot["manifest"], "instanceId": boot["instanceId"]}, fenced=False))
check_session(request("POST", "/api/connector/heartbeat", {}))
item = request("GET", "/api/connector/inbox?wait=0&pollId=" + str(uuid.uuid4()))["deliveries"][0]
request("POST", "/api/connector/conversations/" + item["conversation"]["id"] + "/messages",
    {"text": "Independent reply", "clientMessageId": str(uuid.uuid4())})
request("POST", "/api/connector/deliveries/" + item["id"] + "/ack", {"ok": True})
''')
            connector.chmod(0o755)
            result = subprocess.run([sys.executable, str(root / "conformance.py"),
                                     "--executable", str(connector),
                                     "--manifest", str(root / "examples" / "echo.manifest.json")],
                                    capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
