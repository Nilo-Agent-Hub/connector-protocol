# Nilo Connector Protocol developer kit

[Report a bug or propose work](https://github.com/Nilo-Agent-Hub/connector-protocol/issues/new/choose) · [Contribution workflow and checks](CONTRIBUTING.md)

An independently implementable channel protocol for connecting an Agent to Nilo
Hub. Connector IDs are namespaced strings: adding a third-party implementation
requires no Hub provider enum, official adapter, source upload, or private
repository access. Nilo Link imports and manages a local executable; Hub approves
its exact manifest and grants a scoped messaging identity.

This is the independent source repository for NCP. Hub and Link consume reviewed
snapshots under `third_party/connector-protocol`; their `SOURCE.json` records
the exact file hashes and CI verifies the generated SDK copies.

Everything in this repository is **MIT licensed**. Copy or distribute it as a standalone developer kit.
The protocol and SDK may be used in proprietary Connectors; distributing a copy
of the SDK requires retaining its MIT notice. A Connector's own source can remain
private. This does not grant rights to third-party software or APIs.

- [Wire specification](SPEC.md): requests, responses, capabilities, pairing, leases,
  delivery recovery and security boundaries.
- [Manifest schema](manifest.schema.json): the machine-readable declaration.
- [Developer guide](DEVELOPING.md): implementation and packaging walkthrough.
- [Python SDK](python/ncp.py): standard-library-only client and durable reference
  runner; [echo example](examples/echo.py) and [manifest](examples/echo.manifest.json).
  The bootstrap reader validates the independent management credential when
  `runtime.manage` is approved; the client supplies it to handshake and generic
  runtime, coding and native management routes, without exposing it in repr/logs.
- [Python native-session helper](python/ncp_session.py): the NCP 1.1/1.2 handshake,
  instance fencing, heartbeat and local multi-process lease used by official
  Python Connectors. It is stdlib-only and is copied into each distribution by
  the Link synchronization check; copies carry the source notice and must not
  be edited independently.
- [TypeScript session](typescript/session.mjs) and [wire contracts](typescript/contracts/protocol.ts):
  the same protocol session and public types used by the official Node.js Connectors.
- [Runtime selection helper](typescript/contracts/runtime-selection.ts) and
  Python `ncp.validate_runtime_selection`: validate
  and merges generic initial model, reasoning and setting selections. Optional
  `sessionSelection` support lets Hub freeze owner defaults into new conversations
  without vendor-specific creation fields. NCP 1.2 messaging Connectors may opt
  in with their ordinary channel/runtime grants and current NCP lease; see the
  wire specification for apply-once recovery and rollout requirements.
- [License](LICENSE).

From this directory, with Python 3.10 or newer:

```sh
python3 conformance.py
python3 build_echo.py --output ./dist/echo-connector
python3 conformance.py --executable ./dist/echo-connector --manifest ./examples/echo.manifest.json
```

No Python package installation, Go compilation, model account, Hub checkout or
GitHub authentication is needed for these commands. The echo package contains
only the SDK and example, and requires an installed `python3` at runtime. A
compiled Connector may instead ship as a single native executable.

The conformance command tests the reference SDK offline, or exercises an
executable against a temporary loopback Hub fixture. It is a developer check,
not a publisher signature, security audit or certification. The enclosing Hub
also includes a separate integration test against its real HTTP router and
PostgreSQL; that server test is not needed to use this exported kit.

The implemented version is NCP **1.2 / hub-http-v1**. NCP 1.2 adds optional runtime capability declarations (input limit, model scopes, native settings contract, command table) on top of 1.1. It provides text channel receive/send, explicit ACKs, durable message IDs, instance leases, optional streaming, conversation creation, profile editing, bounded metadata and attachments. Capability-gated extensions cover runtime management, coding sessions/actions/approvals, native session catalogs, local file transfer, media, questions and stickers. A manifest requesting unsupported capabilities is rejected. Official paths remain compatibility aliases while Hub authorization is capability based.

Link currently treats imported code as **trusted local execution**, with explicit
user approval and independently verified manifest/executable SHA-256 digests.
It does not provide an OS sandbox or publisher-signature trust registry. Protocol
compliance limits what Hub grants; it does not make an arbitrary executable safe
to run on the user's machine.
