# SPDX-License-Identifier: MIT
"""Subprocess bridge for isolated Hub integration; all credentials enter stdin."""
import dataclasses
import io
import json
from pathlib import Path
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from ncp import Bootstrap, Client, DurableRunner, Journal, ProtocolError


def denied(operation, status):
    try:
        operation()
    except ProtocolError as error:
        assert error.status == status, error
        return error.code
    raise AssertionError("operation unexpectedly allowed")


def main():
    config = json.loads(sys.stdin.readline())
    bootstrap = Bootstrap.read(io.StringIO(json.dumps(config["bootstrap"])))
    client = Client(bootstrap, attempts=1)
    if config.get("scenario") == "revoked":
        denied(client.handshake, 401)
        print("revocation passed")
        return
    client.handshake()
    client.heartbeat()
    poll_id = str(uuid.uuid4())
    deliveries = client.poll(poll_id, wait=0)
    assert len(deliveries) == 1, f"expected one delivery, received {len(deliveries)}"
    assert client.poll(poll_id, wait=0)[0]["id"] == deliveries[0]["id"]
    calls = []
    with Journal(bootstrap) as journal:
        journal.received(deliveries)
        runner = DurableRunner(client, journal, lambda item, key: calls.append(key) or "Echo: " + item["message"]["text"])
        assert runner.run_once(wait=0) == 1
        row = journal.db.execute("SELECT reply,reply_id FROM deliveries").fetchone()
        first = client.send(config["conversationId"], row["reply"], row["reply_id"])
        second = client.send(config["conversationId"], row["reply"], row["reply_id"])
        assert first["id"] == second["id"]
        assert len(calls) == 1
    assert denied(lambda: client.request("POST", "/api/connector/conversations", {
        "title": "not permitted", "clientConversationId": str(uuid.uuid4())}), 403) == "connector_capability_denied"
    for foreign in config["foreignConversationIds"]:
        denied(lambda: client.send(foreign, "must not cross boundary", str(uuid.uuid4())), 409)
    client.disconnect()
    replacement = Client(dataclasses.replace(bootstrap, instance_id=str(uuid.uuid4())), attempts=1)
    replacement.handshake()
    denied(client.heartbeat, 409)
    denied(client.handshake, 409)
    with Journal(replacement.bootstrap) as journal:
        assert DurableRunner(replacement, journal, lambda *_: (_ for _ in ()).throw(AssertionError("replayed"))).run_once(wait=0) == 0
    assert not replacement.poll(poll_id, wait=0)
    replacement.disconnect()
    print("SDK HTTP, duplicate delivery/outbound, restart, tenant isolation, capability and stale process checks passed")


if __name__ == "__main__":
    main()
