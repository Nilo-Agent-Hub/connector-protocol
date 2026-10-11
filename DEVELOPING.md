# Build a Connector without a vendor adapter

Use the public manifest, stdin bootstrap and HTTP protocol in this kit. Hub and
Link do not import your code or inspect its source. The echo example is a working
reference with no dependency on official Agent connectors.

## 1. Choose an identity and capabilities

Copy `examples/echo.manifest.json`, choose an ID in a namespace you control (for
example `com.example.my-agent`), and set your display name and release version.
Validate against `manifest.schema.json`. NCP 1.1 accepts protocol minor 0 or 1. Every manifest requires `channel.receive` and
`channel.send`; minor 1 extensions must be explicitly listed; add only optional capabilities that your implementation uses.
An ID alone does not prove ownership or publisher trust. Hub stores the exact
manifest approved by the owner; changing it requires a new approval.

Manifest SHA-256 used by Link is the digest of the exact file bytes. The Hub's
`connectorDigest` is a separate digest of the normalized protocol declaration;
the Hub approval page obtains it from Hub and returns it with the approval. Do
not interchange them or calculate the approval digest from manifest file bytes.

## 2. Implement a handler or client

A Python implementation can reuse `Bootstrap`, `Client`, `Journal` and
`DurableRunner` from `python/ncp.py`. Copy `examples/echo.py` and replace its
handler. The handler receives a delivery object and a stable delivery UUID.
If your upstream API supports idempotency keys, pass that UUID through.
Return a nonempty reply string. `SafeToRetry` is permitted only when you can prove
that the upstream action never started. A timeout is not such proof.

The synchronous runner is intended for short work (less than 60 seconds per
handler). It renews the lease between deliveries. Long generation or interactive
work needs a separate heartbeat loop, durable intermediate state and upstream
reconciliation; do not block the heartbeat for a long model call. The Hub's
current dispatched-delivery confirmation window is 300 seconds. Expiration
means the outcome may be unknown; it is not permission to execute again.

For another language, read one JSON line from stdin, immediately close or stop
reading it, and use its scoped token and instance UUID for Hub requests. Never
put the token in argv, URLs, exported environment variables, logs, traces or
error messages. Honor TLS verification and reject redirects. Remote Hubs require
HTTPS; plain HTTP is for loopback development only.

Link starts the executable without arguments in its private state directory,
then writes this bootstrap as one JSON line and closes stdin:

```json
{
  "protocol": "nilo-connector-bootstrap",
  "version": 1,
  "hubUrl": "https://hub.example",
  "token": "SCOPED_MESSAGE_TOKEN",
  "instanceId": "e8c2f1c8-ec62-4a88-9f39-2cff6e22b50f",
  "agentId": "8847a81c-661c-4813-aa13-a9086b896ae6",
  "connectorId": "org.example.nilo-echo",
  "manifest": {
    "schemaVersion": 1,
    "id": "org.example.nilo-echo",
    "name": "Independent Echo Connector",
    "version": "0.1.0",
    "protocol": {"major": 1, "minor": 1},
    "capabilities": ["channel.receive", "channel.send"]
  },
  "stateDir": "/absolute/private/instance/state"
}
```

Reject unknown bootstrap protocol/versions, an invalid Hub origin, mismatching
`connectorId`/manifest IDs or a non-absolute state directory. `instanceId` changes
on each process run; `agentId`, the approved manifest and `stateDir` remain bound
to the installed instance. The message token is always passed privately. A manifest with `runtime.manage` receives an independent management token in the bootstrap; never log or expose it to a message-only connector. Standard output/error
are discarded by Link and do not form a management protocol. Link controls
process lifetime separately; handle normal termination where possible, and
always recover safely after an abrupt stop.

The SDK journal stores delivery payloads and prepared replies in a private
SQLite file; it never stores the bearer token. Its directory must be owned by
the current user with mode `0700` on Unix. It is bound to the Hub URL, Agent ID
and Connector ID and locked against concurrent use. It intentionally retains
completed delivery IDs for deduplication. Production implementations should
provide storage limits and retention that preserve their promised replay window.

Recovery behavior:

- A poll UUID is persisted before the request and reused after a lost response.
- A delivery is saved before calling the upstream Agent.
- A prepared reply and its message UUID are saved before sending. Lost responses
  repeat the same request with the same UUID.
- A lost ACK response repeats the ACK without redoing the upstream action.
- A crash while an action is running marks it uncertain and reports failure;
  it does not automatically replay an action that may already have happened.

These mechanisms do not guarantee exactly-once upstream execution. After an
ambiguous failure, reconcile with the upstream system or ask the user before
retrying. Deleting or replacing the journal loses its recovery guarantees.

## 3. Package and check

```sh
python3 conformance.py
python3 build_echo.py --output ./dist/echo-connector
python3 conformance.py --executable ./dist/echo-connector --manifest ./examples/echo.manifest.json
```

The default command tests SDK transport failures, duplicate input, lost reply and
ACK responses, restart uncertainty, private state and credential-safe errors.
The executable mode starts a temporary local fixture and checks stdin bootstrap,
handshake, instance headers, a text reply and ACK. It intentionally executes the
selected binary. Passing is evidence for those basic behaviors, not proof of all
security, recovery, streaming or production requirements. The fixture emits no
real credentials and does not use a real model or account.

`build_echo.py` produces a standard Python zipapp with the SDK and example inside.
It requires `python3` in Link's restricted system search path. Your own native
executable may bundle its language runtime instead. Link currently imports one
executable and a JSON manifest; it does not run installation scripts or resolve
package dependencies. Publish checksums through a channel your users trust.
A checksum calculated from an untrusted download does not authenticate it.

## 4. Import, pair and run with Link

Replace the uppercase values below with absolute paths and independently
verified digests. These commands require a Link release with NCP support.

```sh
nilo connector import --manifest /absolute/connector.manifest.json --executable /absolute/connector --manifest-sha256 MANIFEST_SHA256 --sha256 EXECUTABLE_SHA256 --trust-local-execution
nilo connector pair --connector com.example.my-agent --server https://hub.example --request
nilo connector install --connector com.example.my-agent --pairing-id LOCAL_PAIRING_UUID
nilo connector run --id LOCAL_PAIRING_UUID
```

Pairing shows a Hub approval page and a device verification code. In the Hub,
check the manifest, permissions and device code and approve. The command waits
for approval and stores the scoped device credential privately. The local ID is
printed during pairing. To continue an interrupted pairing:

```sh
nilo pair --resume LOCAL_PAIRING_UUID --json
```

Use `connector start` for a background process; use `connector status`,
`connector stop` and `connector remove` with `--id` to manage it. Stopping keeps
credentials and state so the same pairing can be restarted. Importing another
release under an existing package ID is not supported in this version. Package
IDs remain fixed after import; `connector remove` only removes the local instance
and its pairing, so it does not enable a same-ID package upgrade. Removing local files does
not revoke Hub credentials; revoke the Agent in Hub if access should end.

Link checks both file digests before execution, uses a private stdin bootstrap,
scrubs inherited credentials and suppresses child output. This is not an OS
sandbox: the binary still runs with the current user's filesystem and network
permissions. Import only code you are willing to trust locally. Publisher
signatures, automatic updates and platform sandbox policies are future work.

## Real Hub / Link integration for maintainers

The separate Hub tests run this public Python code in a subprocess against the
real HTTP router and an isolated PostgreSQL database. They exercise pairing,
manifest approval, handshake, message deduplication, tenant and Agent isolation,
revocation and stale-process fencing. To additionally test a separately built
Link binary, set `NCP_LINK_BINARY` to its absolute path. The optional test runs
import, pair, install, message/ACK, stop, restart and remove under a temporary
configuration directory. No production state or globally installed tool is used.

From the Hub repository, with isolated test database URLs already configured:

```sh
go test ./internal/httpapi -run 'TestNCP(Python|Link)' -count=1 -v
```

The exported kit itself needs neither those test databases nor Hub's private
implementation. It may be mirrored or released independently under `LICENSE`.
