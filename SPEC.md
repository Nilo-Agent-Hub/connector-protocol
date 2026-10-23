# Nilo Connector Protocol 1.2 — hub-http-v1

This document describes the implemented NCP 1.2 profile with text channels and capability-gated extensions. An
independent executable can connect without importing Hub or Link internals or
being added to a vendor allowlist. The declaration, examples and Python reference
client in this directory are MIT licensed; implementations may remain proprietary.
Preparing this directory for publication does not publish the private Hub repository.

Hub authenticates and routes messages. Link can install and supervise a local
executable and give it one agent's credential. A connector translates this API
to its upstream agent. A channel is a stable Hub conversation ID. Native upstream
session IDs are opaque identities in the optional native/coding extensions;
vendor implementation details remain inside each Connector.

### Agent families and access channels

An Agent family (for example Codex) is presentation and legacy compatibility
metadata. Its Desktop application and CLI/app-server are separate access channels,
with separate Connector IDs, approved manifests, credentials, native session
sources and lifecycle. Sharing a vendor, model, host machine or transport library
does not authorize merging these identities or inferring one channel's abilities
from another. `Agent.kind` is not an access-channel identifier. In this document,
the wire term text "channel" specifically means a Hub conversation; an access
channel is identified by its Connector manifest ID.

New channels, including Desktop integrations, use `kind:"custom"` and an independent
manifest. An already approved identity cannot change its channel by changing the
native catalog provider or runtime report. Switching channels requires a separate
pairing. Clients must use the manifest grants and current runtime/native reports
for capability decisions, and display the Connector's name where channel choice
matters. Legacy clients may keep their historical family fields and aliases.

## Declaration and approval

The complete declaration is described by [manifest.schema.json](manifest.schema.json):

```json
{
  "schemaVersion": 1,
  "id": "org.example.echo",
  "name": "Example Echo",
  "version": "1.0.0",
  "protocol": {"major": 1, "minor": 1},
  "capabilities": ["channel.receive", "channel.send"]
}
```

IDs use at least three lowercase, dot-separated components with optional
internal hyphens. IDs are self-declared names, not proof of domain ownership or
publisher identity. Names have 1–80 Unicode code points, no control characters,
and no leading/trailing whitespace. Versions use three numeric components and
an optional prerelease suffix; build metadata is not accepted in this version.
Protocol major 1 and minor 0, 1 or 2 are accepted. Minor 1 enables the extension capabilities listed below. Minor 2 adds no
capabilities; it announces that the Connector may send the NCP 1.2 runtime capability declarations, so a 1.1 Hub rejects
the declaration at pairing instead of rejecting later runtime reports. Unknown declaration fields,
unknown capabilities, and duplicate capabilities are rejected.

Both `channel.receive` and `channel.send` are required. These optional permissions
are individually enforced by Hub:

| Capability | Additional access |
| --- | --- |
| `channel.stream` | Send streaming messages and replace their text |
| `conversation.create` | Create conversations for this agent |
| `profile.write` | Update this agent's display name and built-in avatar/emoji |

A declaration is an access request. The owner reviews the exact declaration
during pairing. Its ID, name, version, protocol and capability set are immutable
for that paired identity. A different version or permission set requires a new
pairing. Capability order has no meaning. Rotating/revoking the message token
does not remove the approved declaration or convert it to an unrestricted agent.

## Pairing

Pairing uses JSON requests with `Content-Type: application/json`. Credentials
must only cross HTTPS, except local loopback development. Never print tokens or
put them in URLs, command-line arguments, or package manifests.

1. Generate a random UUID `requestId` and a secret verifier: at least 32 random
   bytes encoded as unpadded base64url (43–128 characters). `challenge` is the
   lowercase hex SHA-256 of the verifier's **encoded string**.
2. `POST /api/pairing/request` with `requestId`, `challenge`, `kind:"custom"`,
   `deviceName`, and `connector` (the declaration). The response contains
   `sessionId`, `status`, `expiresAt`, and `pollIntervalSeconds` (3).
3. Open `/?pairing=1&pairingSession={sessionId}` in the owner's authenticated Hub browser. Show the
   local verification code described below. The owner checks the declaration
   and device and types the code. A request has no tenant until this approval.
4. Poll `POST /api/pairing/status` with
   `{sessionId,requestId,verifier}`. Exchange approved requests using
   `POST /api/pairing/exchange` with the same proof. Pending exchanges return 202.
   A successful exchange returns `status:"exchanged"`, `agent` including its
   `id`, `kind:"custom"` and `connector`, and
   `credentials:{messageToken:"…"}`. If the declaration includes `runtime.manage`, the owner must have maintenance permission and exchange returns an independent `managementToken`; it is delivered through the private Link bootstrap and sent as `X-Agent-Hub-Management-Token` on management calls. The message and management credentials are always checked independently.
5. Persist the credential privately, then `POST /api/pairing/ack` with the same
   proof. Exchange recovery is available until `recoveryExpiresAt`; ACK ends
   credential delivery recovery. Expired/cancelled sessions return 410.

To derive the local verification code, SHA-256 hash the UTF-8 string
`nilo-pairing-verify:` followed by the lowercase hex challenge. Map each of the
first six bytes modulo 32 into `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, then display
three characters, a hyphen, and three characters. The server never exposes this
code through the owner lookup API.

Owner-created pairing is also supported: the owner creates a session using
`POST /api/pairing/sessions` with `{}` and gives the device its eight-character
code. The device uses `POST /api/pairing/claim` with the declaration fields above
and `code`. Explicit browser approval still follows, but a typed verification
code is only required for device-initiated sessions.

The authenticated owner GETs `/api/pairing/sessions/{sessionId}` to display the
immutable `connector` and obtain its opaque `connectorDigest`. Approval POSTs
`requestId`, `verificationCode` (device initiation) and the returned
`connectorDigest` to `/api/pairing/sessions/{sessionId}/approve`. Clients should
round-trip the digest rather than reimplement its canonicalization. Old clients
that omit it cannot silently approve an NCP identity.

## Handshake and lease

All connector calls carry `Authorization: Bearer <messageToken>`. First send:

```http
POST /api/connector/handshake
Content-Type: application/json

{"connector":{...approved declaration...},"instanceId":"<fresh UUID>"}
```

The 200 response contains `protocol`, `agentId`, the approved `connector`,
`instanceId`, `leaseExpiresAt` (RFC 3339), and `heartbeatIntervalSeconds` (30).
Use a canonical lowercase UUID, nonzero, newly generated for each process run.
Handshake requires no instance header; other connector calls require exactly
one `X-Nilo-Connector-Instance` header containing that UUID.

The lease lasts 90 seconds. `POST /api/connector/heartbeat` with `{}` renews it
and returns the same session shape. Heartbeat work must continue during upstream
execution. `POST /api/connector/disconnect` with `{}` returns 204 and permanently
retires that instance ID. A stopped process cannot revive its disconnected ID.

Retrying a handshake for the current instance renews the lease, including after
expiry if another instance has not taken over. A different instance gets 409
while the current lease is live; after expiry it may acquire a lease. Once
replaced, an old instance cannot handshake again even after the successor stops.
Token rotation/revocation invalidates the current lease and retires its ID.

Every tenant write checks the lease and current credential inside the same
transaction that serializes with takeover/revocation. A delayed request from a
retired process cannot mutate data after a successor acquires the lease. This
fences Hub requests; it cannot cancel an upstream tool call already in progress.
The connector must reconcile any uncertain upstream outcome itself.

## Text channels

Requests use JSON. Unknown request fields and all unlisted connector routes are
denied for an NCP identity, unless its corresponding capability is approved. Provider-specific compatibility paths are aliases to capability-gated coding/runtime routes; attachment, native session, file, media, question, sticker and process metadata access require their explicit NCP 1.1 capabilities. Omitting the instance
header never grants the legacy profile. Response objects may contain additional
Hub display metadata; implementations should ignore unknown response fields.

| Request | Body / parameters | Result |
| --- | --- | --- |
| `GET /api/connector/profile` | No body | Current agent profile |
| `GET /api/connector/inbox` | `wait=0..20`, `pollId=<durable UUID>` | 200 `{deliveries:[…],protocolVersion:1,agent:{id:…},maintenance:false}` |
| `POST /api/connector/deliveries/{id}/ack` | `{ok:boolean,error?:string,uncertain?:boolean}` | 204 |
| `POST /api/connector/conversations/{id}/messages` | `{text:string,clientMessageId:string,streaming?:boolean}` | 201 message |
| `PATCH /api/connector/messages/{id}` | `{text:string,streaming?:boolean}`; requires `channel.stream` | 200 message |
| `POST /api/connector/conversations` | `{title:string,clientConversationId?:string}`; requires `conversation.create` | 201 conversation |
| `PATCH /api/connector/profile` | `{name?:string,avatarEmoji?:string,avatarPreset?:string}`; requires `profile.write` | 200 profile |

Each delivery contains `id`, `conversation` (including its stable `id`),
`message` (including `id`, `text`, `role`, `seq`) and up to 40 prior delivered
chat messages in `history`, oldest first. A poll returns at most ten deliveries.
The connector may only ACK its own agent's deliveries and send/patch messages
in conversations belonging to that same agent. Tenant IDs are never supplied
by the connector. PostgreSQL tenant isolation applies to all data access.

Text must be nonblank. Streaming starts with a nonblank POST and `streaming:true`.
The base text profile supplies the **entire current text** on PATCH; finish with
`{text:"complete reply",streaming:false}`. NCP 1.1 additionally accepts `delta`.
`process`, `kind` and `runtimeActivity` require `channel.metadata`;
`final` and unlisted implementation fields are not accepted.
Send stream patches serially: this full-text profile has no revision precondition
or out-of-order merge guarantee. Replaying an old patch after a newer patch can
overwrite the newer text. A non-streaming connector cannot use PATCH.

The owner creates a conversation from the connected agent in Hub, or a connector
with `conversation.create` creates one. Persist and reuse `clientConversationId`
to recover a lost creation response; the same key returns the same conversation.
Attachment IDs require `channel.attachments`; local file transfer requires `files.read`/`files.write`; native session catalog and coding/runtime operations require `native.sessions`/`coding.*`/`runtime.manage`; media, questions and stickers require their named capabilities.

Handshake must happen before the owner sends input. Hub's existing presence
window is 35 seconds; heartbeat/poll traffic keeps it current. Text submitted
while the agent is offline is stored as failed and requires an owner retry
after reconnection. It is not silently queued for a future connector process.

## NCP 1.1 extensions

Each extension requires its immutable manifest capability. The management-related
rows additionally require `runtime.manage` and the independent
`X-Agent-Hub-Management-Token`. A message token never grants management access.
Management access includes explicitly configured model connection credentials:
request this capability only if the Connector needs to configure its runtime.

| Capability | Routes / additional fields |
| --- | --- |
| `channel.attachments` | `POST /api/attachments`, `GET /api/attachments/{id}/content`; message `attachmentIds` |
| `channel.metadata` | message `kind`, `label`, `process`, `runtimeActivity`, `proactive`; the corresponding PATCH metadata |
| `runtime.manage` | `GET /api/connector/runtime/inbox`, `POST /api/connector/runtime/report`, `POST /api/connector/runtime/requests/{id}/result`, `GET /api/connector/runtime/connections`, `POST /api/connector/runtime/connections/ack` |
| `coding.sessions` | `POST /api/connector/coding/connect`, `POST /api/connector/coding/session`, `POST /api/connector/coding/queue/claim`, coding side-conversation poll/result; inbox `runtimeInstanceId` or `codingInstanceId`; delivery ACK `requeue`; conversation creation `projectId` |
| `coding.actions` | `GET /api/connector/coding/inbox`, `POST /api/connector/coding/actions/{id}/result` |
| `coding.approvals` | `POST /api/connector/coding/approvals`, `POST /api/connector/coding/approvals/{id}/resolve` |
| `native.sessions` | `POST /api/connector/native/catalog`, `POST /api/connector/native/created`, `GET /api/connector/native/bindings`, `POST /api/connector/native/bindings/{id}/ingest`, `POST /api/connector/native/bindings/{id}/state` |
| `files.write` | `POST /api/connector/conversations/{id}/files` registers a local file belonging to an Agent conversation |
| `files.read` | file-transfer poll/content/error and file-reference result routes under `/api/connector/`; owner file policy and per-request transfer ownership still apply |
| `media.generate` | image-generation and speech-generation capability/job/result routes under `/api/connector/` |
| `questions` | conversation question create/list and `/api/connector/questions/{id}/resolve` |
| `stickers` | sticker list/register and message `stickerId` / `stickerImage` |

The public TypeScript `contracts/` directory contains the exact request/response
structures for these extensions; it has no Hub implementation dependency. The
Hub rejects unknown request fields, invalid native IDs, foreign conversation
references and mismatched delivery/action/binding ownership.

A Connector approved for both `conversation.create` and `coding.sessions` may
include `projectId` when creating a conversation. Hub validates that the project
is currently registered and available to this authenticated Agent, applies the
owner's runtime-management and maintenance constraints, and binds the new
conversation to that project. A foreign or unavailable project is rejected;
reusing `clientConversationId` with a different project is a conflict. Connectors
without `coding.sessions` must omit `projectId`.

Coding connect registers `{instanceId,version,account,projects}`. This native
runtime **epoch** is independent of the NCP process lease UUID. Every subsequent
native/coding call proves that current epoch; a replacement native epoch retires
prior sessions, approvals and pending actions. The outer NCP lease header is
required throughout and checked again inside the database transaction.

Native catalog `provider` is an implementation-defined identifier matching
`^[a-z0-9][a-z0-9._-]{0,127}$`, not a vendor enumeration. Catalog identities are
scoped by authenticated tenant + Agent + sourceKey + sessionRef. A registered
source/session identity cannot silently change its provider. Importing existing
history requires an owner-created binding. Creation confirmation additionally
requires the conversation's first delivered input and matching registered project;
an arbitrary session reference cannot import unrelated history.

Runtime reports use `runtimeInstanceId` for the native epoch. Required report
fields remain `conversationId`, `runtimeVersion`, `capabilities`, `model`,
`lastUsedModel`, `models`, `busy`, `usage`, `skills`, `mcp`, and `files`.
`capabilities.createSession` controls creation of unbound Hub conversations;
`steerInput` controls adding input to a running turn. `sideConversation` may be
`ephemeral` or `inline`. These reports describe supported behavior; they cannot
expand the manifest's approved access.

#### Runtime capability declarations (NCP 1.2)

A runtime describes behavior the Hub and its clients must not infer from an
adapter kind. All fields are optional members of `capabilities`:

| Field | Shape | Meaning |
|---|---|---|
| `maxInputLength` | integer 1–1000000 | Largest user input text the runtime accepts, in UTF-16 code units. Clients size the composer from it. |
| `modelScopes` | unique subset of `draft`, `conversation`, `defaults` | Where an owner may choose a model. `conversation`: `switch-model` with a `conversationId`. `defaults`: future conversations (a `switch-model` without `conversationId`, or Hub-stored selection defaults). `draft`: a new topic's initial selection. The Hub refuses `switch-model` outside the declared scopes. |
| `nativeSettings` | `codex` or `claude` | The native settings contract the runtime speaks (native editors, native update and confirmation rules). Absent means generic `settings` only. |
| `commands` | at most 64 `{command,description,usage?,newTopic?}` | Text commands the runtime understands. `command` matches `^/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` and is unique case-insensitively; `description` and `usage` have 1–200 code points. Input whose first word is a `newTopic:true` command, optionally followed by `@name`, opens a new Hub topic instead of being delivered to the current one. |
| `boundSessionSettings` | boolean | Settings remain editable for a conversation bound to an imported native session. |
| `nextTurnSettings` | up to 64 unique setting keys | Explicit opt-in to saving these fields for the next turn, including while running or waiting. Requires the gateway opt-in below. |
| `liveTurnSettings` | up to 64 unique setting keys | Gateway-negotiated subset of `nextTurnSettings` that also applies to subsequent operations in an active turn; see below. |
| `nextTurnModel` | boolean | Explicit opt-in to saving a conversation's model and optional reasoning effort for the next turn, including while running or waiting. `true` requires `switchModel:true` and the separate gateway opt-in below. |

Connectors must declare protocol minor 2 before reporting these fields. A
Connector whose manifest declares minor 2 is the sole authority for them: an
absent field means the runtime does not support it (no `modelScopes` means no
model choice, no `nativeSettings` means generic settings only). The Hub serves
the effective capabilities on runtime views as `capabilities` (and merged into
`report.capabilities`): a reported value always wins, and only for Connectors
that predate NCP 1.2 may the Hub supply unreported fields from its own fallback
profile. `codexDefaults` on a runtime view is a
read-only projection of `selectionDefaults`; the Hub stores one copy.

#### Native file-change activity detail

A gateway may opt in with `nativeFileChanges:true` in the existing coding-connect
response. After negotiation, `runtimeActivity.detail` may contain
`{type:"edit",changes:[{path,kind,diff,previousPath?,truncated?}],truncated?}`.
Each `kind` is `add`, `delete`, or `update`; a move uses `update` and
`previousPath`. There are at most 64 entries and at most 128 KiB aggregate UTF-8
`diff` bytes. Paths are nonempty display strings of at most 4096 UTF-8 bytes,
without control characters. They may be absolute native display paths; they are
never authority or arguments for a filesystem read. `truncated:true` marks
omitted entries or bytes. Implementations may apply smaller transport bounds.

This payload is public native tool output. It uses `channel.metadata`, the
existing activity identity, process binding and process-detail retention. It is
not a remote `files.read` operation and does not assert that a Git repository
exists. Do not invoke Git or read files to reconstruct a missing native event.
An edit's native lifecycle remains authoritative: `completed` means the native
operation completed, `failed` remains failed, a refusal/cancellation is stopped,
and unknown status must not be inferred as success. Preserve one native item
identity across updates and do not duplicate it using turn-wide diff summaries.

Before negotiation or with older peers, omit `detail` while retaining the
existing activity summary. Re-negotiate on reconnect. Changes to detail must
participate in durable message revision, retry and PATCH handling, including
updates with unchanged summary text. An activity detail is historical output;
it must never be presented as the current contents of the workspace.

#### Read-only repository changes

A Connector may report optional `capabilities.reviewChanges:true` to offer a
change list and individual diffs for a bound conversation. Omitted or false means
unsupported. This is an additive NCP 1.1 runtime extension, not a new manifest
permission: it requires both approved `runtime.manage` and `files.read`, the
independent management credential, and the owner's existing file-read policy.
The capability and a returned snapshot never authorize access by themselves.

On delivery to the Connector, the server includes a top-level `filePolicy` with
`enabled`, `directories`, `groups` and `maxBytes`, using the existing file-policy
contract. This field is server-owned and cannot be supplied in an owner request
or its payload. The Connector must apply it together with its local restrictions
and must reject review when the policy is missing or disabled. The server binds
the policy to the admitted request and rechecks it when delivering requests,
accepting results and returning saved results. A changed policy invalidates old
review data; clients must request a fresh list. Permission revocation also applies
to already-completed results. Review results use the existing bounded runtime
result retention rather than creating a permanent copy of repository content.
For repository review, the `text` group includes explicitly allowed source-code
extensions and build files such as `Dockerfile` and `Makefile`. This does not
expand ordinary attachment-preview formats. Implementations must agree on their
review allowlist and keep directory, byte-size and sensitive-file restrictions;
an unfamiliar extension must not become readable merely because Git tracks it.

The owner submits the existing runtime request envelope with a non-null
`conversationId`. The baseline payloads are:

```json
{"conversationId":"8847a81c-661c-4813-aa13-a9086b896ae6","kind":"list-changes","payload":{}}
{"conversationId":"8847a81c-661c-4813-aa13-a9086b896ae6","kind":"read-diff","payload":{"snapshotId":"opaque-snapshot","fileId":"opaque-entry"}}
```

Review is scoped to the repository resolved from that conversation's actual
working directory and current runtime epoch. An instance default or a path from
the caller cannot substitute for that directory. Existing project boundaries,
allowed roots, denied paths and sensitive-file restrictions apply to the list
and every content read, including content read from Git objects. Listing must
omit metadata that the file policy does not allow to be disclosed. Review must
not stage, discard, commit, edit, or otherwise change repository state. Git
external diff helpers and text converters must not execute as part of review.
Symlink targets and submodule working trees must not be followed for content.

An independent negotiated `reviewUncommitted:true` coding-connect response
allows supporting Connectors to report `capabilities.reviewUncommitted:true`
only together with `reviewChanges:true`. Clients may then send
`list-changes` with `payload:{"compare":"uncommitted"}`. The resulting snapshot
uses `area:"working-tree"`, with one entry per current path, and compares HEAD
to the current working tree including untracked files. Staged and unstaged
changes must not appear as separate entries, and edits which cancel out against
HEAD must not appear as a net modification. An unborn repository uses an empty
baseline. The selected comparison is bound to the snapshot and later diff
reads. An omitted `compare` preserves the existing staged/unstaged/untracked
semantics; do not relabel the legacy result as a combined comparison. Unsupported
Connectors must reject the explicit comparison rather than silently substituting.

A successful `list-changes` returns `result.changes`:

```json
{
  "changes": {
    "snapshotId": "opaque-snapshot",
    "observedAt": "2026-01-01T12:00:00Z",
    "branch": "main",
    "entries": [
      {"id":"opaque-entry","path":"src/example.ts","area":"unstaged","status":"modified","additions":2,"deletions":1}
    ],
    "truncated": false
  }
}
```

`observedAt` is RFC 3339. `branch` is a branch name or null when unavailable.
There are at most 500 entries; `truncated:true` means eligible entries were
omitted by that limit. Each entry has a unique `id` within the snapshot, a
repository-relative `path`, optional `previousPath` for a rename, `area`
(`staged`, `unstaged`, `untracked`, or negotiated `working-tree`), and `status` (`added`, `modified`, `deleted`,
`renamed`, `conflicted`, `typechanged`). Optional `additions` and `deletions` are
non-negative integers or null; omitted or null counts mean unknown, not zero.
The same path may have separate staged and unstaged entries with different IDs.

Paths are nonempty, at most 4096 UTF-8 bytes, and never absolute or allowed to
escape the authorized repository. A path is display metadata, not a request
argument. Snapshot and entry IDs are nonempty opaque strings of at most 128
UTF-8 bytes; clients must not construct or interpret them as filesystem paths.
The Connector resolves them to the original repository, entry and area. Their
scope includes the authenticated Agent, conversation and runtime epoch; IDs from
another scope must not be accepted.

A successful `read-diff` returns `result.diff`:

```json
{
  "diff": {
    "snapshotId": "opaque-snapshot",
    "fileId": "opaque-entry",
    "path": "src/example.ts",
    "kind": "text",
    "patch": "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new\n",
    "truncated": false
  }
}
```

`snapshotId`, `fileId`, `path` and optional `previousPath` must agree with the
requested snapshot entry. `kind` is `text`, `binary`, `symlink`, `submodule`,
`restricted`, `too_large`, or `conflicted`. `patch` is a UTF-8 unified diff of at
most 256 KiB for `text`; for every other kind it is the empty string. A bounded
partial text patch must set `truncated:true`. Implementations may instead return
`too_large` with an empty patch and `truncated:true`. A `restricted` result must
not expose protected content. Clients must render non-text kinds explicitly and
must not display an empty patch as evidence of no changes.

Staged diffs compare HEAD with the index, unstaged diffs compare the index with
the working tree, and untracked diffs compare an empty file with the working
tree. An unborn repository can use an empty HEAD baseline. Conflict entries are
reported explicitly instead of presenting one side as an ordinary text change.
Before and after a list or diff read, the Connector must verify the relevant
repository state, file identity, conversation scope and current authorization.
If those observations change during reading, or the snapshot has expired or no
longer describes the requested entry, fail with `changes_changed` and discard
the content. A client obtains a new list before retrying; it must never silently
show a newly read diff under an older snapshot. Result admission also checks
that the runtime epoch is still current, just as for other result-only reads.

Defined failures include `changes_changed` (refresh the list), `not_repository`
(the conversation's directory is not in a repository),
`repository_root_required` (the directory belongs to a repository but is not its
root and the Connector does not support scoped subdirectory review), `git_unavailable`
(Git cannot be used), `review_unavailable` (the scoped review cannot be provided),
and existing `unsupported` or authorization errors. Error messages must not
contain protected paths, file contents, credentials, or raw subprocess output.

Earlier Hubs may reject unknown report fields and request kinds. Upgrade Hub
before a Connector advertises `reviewChanges` or clients send these requests.
An implementation targeting an older Hub must omit the capability; clients hide
review when it is absent and handle `unsupported` without trying a file-access
bypass. Older clients can ignore the optional capability and result fields.
The TypeScript contracts retain the general runtime envelope and provide
`RuntimeListChangesRequest` and `RuntimeReadDiffRequest` for strict construction;
receivers must still validate these requirements at the wire boundary.

Generic settings reports have this shape:

```json
{"settings":{"values":{"mode":"safe"},"allowed":{"mode":["safe","fast"]},"source":"runtime"}}
```

Setting keys match `^[A-Za-z][A-Za-z0-9_.-]{0,63}$`, with at most 64 keys.
Values are JSON null, booleans, finite numbers, or strings up to 1024 bytes.
Each `allowed` list has 1–64 scalar choices. `source` is `runtime` or `defaults`;
with the next-turn extension it may also be `configuration` for durably saved
conversation settings, which are not claims about an active turn.
The owner submits a normal runtime request with `kind:"update-settings"` and
`payload:{settings:{mode:"fast"}}`. Hub admits only choices in the reported
`allowed` sets, and successful completion must report `source:"runtime"` and
the requested actual values, or a durable `configuration` receipt under the
next-turn extension below. Arbitrary opaque configuration cannot pass through.

#### Initial selection and future conversation defaults

A Connector with approved `coding.sessions` and `runtime.manage` may report
`capabilities.sessionSelection:true` in its instance report. NCP 1.2 messaging
Connectors with `channel.receive` and `runtime.manage` may also opt into this
contract without requesting coding capabilities. This promises to consume
`conversation.runtimeSelection` before the first native input of a new session:

```json
{"runtimeSelection":{"model":{"model":"example-model","provider":"local"},"effort":"high","settings":{"mode":"safe"}}}
```

All three selection fields are optional. `model` contains both a model and a
provider string (1–256 UTF-8 bytes each), matching the reported `models` entry;
`switchModel` must be true. `effort` requires `model`, `reasoning:true`, and a
choice in that model's `reasoningEfforts`. Nonempty `settings` requires
`updateSettings:true` and the same key, scalar and `allowed` restrictions as
generic settings above. JSON null in a setting is an explicit allowed value,
never a deletion marker. Unknown fields are rejected. The public
`typescript/contracts/runtime-selection.ts` and Python
`ncp.validate_runtime_selection(selection, report)` helpers validate these rules.
These helpers do not apply selections or manage durable state. In NCP 1.2, Hub
also requires `modelScopes` to include `draft` for an explicit initial model or
`defaults` for a saved/inherited model default. Pure settings selections do not
require a model scope. These write scopes do not hide reported model facts.

A non-coding NCP 1.2 Connector uses its current handshake `instanceId` as
`report.runtimeInstanceId`; no coding registration is needed or permitted
without its grant. Hub binds the report and ordinary runtime action results to
that same current, unexpired NCP lease. A report from a retired instance cannot
authorize creation, update defaults, or confirm a model change. Model selection
also requires an instance report observed within the current presence window.
Coding Connectors retain their separately registered native epoch and NCP 1.1
Connectors retain the existing coding-only initial-selection contract.

The owner API `GET /api/agents/{id}/runtime/selection-defaults` returns
`{selection:RuntimeSelection|null,revision:number}`. `PUT` accepts
`{selection:RuntimeSelection|null,expectedRevision:number}`; both require
configure permission. A changed value increments the revision. A stale revision
conflicts, except resubmitting the already-stored value succeeds without another
increment, so a lost response can be reconciled safely. Reading and clearing
Hub-owned defaults remain available after a Connector goes offline or loses its
capabilities. Saving non-null defaults requires a current, online instance report
and supported choices; maintenance blocks the write. Other sessions may be busy.

Owner conversation creation may include `runtimeSelection` and requires
configure permission when doing so. A user with chat permission may inherit
previously approved defaults. Hub merges defaults and the explicit selection in
the creation transaction: explicit model/effort override defaults, settings merge
by key, and changing model or provider drops inherited effort unless overridden.
The merged snapshot is persisted and included in ordinary and queued deliveries.
Retrying the same creation key returns that snapshot even if defaults or runtime
capabilities subsequently change; changing the explicit selection is a conflict.
Saved defaults that have become unsupported block new creation until corrected
or cleared; Hub must not silently discard them. Branded initial-selection fields
cannot be combined with `runtimeSelection`; explicit legacy requests continue
through their compatibility path.

These defaults affect future conversations only. They do not change native
global defaults or existing sessions. Unselected fields use the Connector's
native defaults. Before starting upstream work, the Connector must validate the
frozen selection against its current choices and reject unavailable values,
without silently substituting another model or setting. It applies the snapshot
once when creating a session; later deliveries and resumptions preserve that
session's current settings. Current observed values still come from runtime
reports. The report capability is optional and does not add a manifest grant.

For a messaging runtime, the Connector must serialize selection application and
first-input dispatch for each conversation. It durably records the frozen
snapshot (or a canonical digest), validates the current catalog, and persists
the requested native session settings before dispatching any input. A successful
command response alone is insufficient if the host cannot confirm durable actual
values. Record an applied state only after that confirmation. Record consumption
with the durable input-dispatch transition before entering upstream work.

Redelivery of the same snapshot resumes that state machine; a different snapshot
for the same conversation is a conflict. Once consumed, the snapshot must never
reset later owner changes or resumed-session settings. An older session without
an application record must not be treated as a new session merely because this
Connector version has just started. After a crash during application, reconcile
the persisted native settings without dispatching input; if the outcome cannot
be established, fail closed and retain an uncertain outcome. Never retry an
unknown native action, substitute a default model, or start a new model turn to
resolve that uncertainty. Existing delivery ACK/error/uncertain semantics still
apply and do not imply exactly-once upstream execution.

Deployment order matters: earlier Hubs reject unknown runtime report fields.
Upgrade Hub and apply its selection-storage migration before deploying a
Connector that advertises `sessionSelection`; omitting the flag preserves the
older protocol behavior. A messaging implementation must wait for a Hub that
supports the NCP 1.2 lease-based selection path before opting in. This is an
additive use of existing fields; an older Hub may reject it and must not be
worked around by requesting unrelated coding grants.

`runtimeUpdate` is the provider-independent runtime update report. All fields are
required: `supported` (boolean), `reason` (null or `disabled`,
`unsupported-platform`, `unavailable`), `status` (`idle`, `updating`, `restarting`,
`verifying`, `succeeded`, `unchanged`, `failed`, `uncertain`), `operationId`
(null or UUID), `fromVersion` / `toVersion` (null or semantic versions),
`error` (null or bounded string), and `updatedAt` (RFC 3339). Owner request
`kind:"update-runtime"` requires maintenance permission. Admission requires an
idle runtime, no live sessions/actions and explicit update support. Success is
accepted only with a matching operation ID, actual running version and consistent
from/to versions. An uncertain update must be inspected; it is not automatically
replayed. This updates the upstream runtime, not the pinned Connector package.

Unclaimed runtime updates expire after one minute; claimed updates have a
15-minute deadline and become `uncertain` on timeout. An uncertain update blocks
new input, session creation, side conversations and configuration writes until
inspection reports the same operation ID with verified success/unchanged version
evidence, or an explicit failed outcome with an error. An idle report or a result
for another operation cannot clear that block. Inspection and result reporting
remain available; the original uncertain request is retained and never replayed.
Update completion may use a new registered native `runtimeInstanceId` after
restart. Ordinary configuration results must match the original current epoch.
Result-only file/skill reads need no extra report, but still require that epoch
to remain current. Retired epoch reports cannot indicate current online status.

The owner runtime view exposes optional `runtimeUpdateRequest` with the latest
durable `id`, `clientRequestId`, `status` and `error`. Clients recover a lost
submission response only by matching `clientRequestId`, never from presence or
a version change alone. The optional view-level `maintenance` boolean includes
instance-wide maintenance and unresolved updates, including in conversation
views whose last report still says idle. Old clients may ignore these additional
response fields; Hub enforces the same restrictions transactionally.

Successful model switches must report the selected model and provider, plus the
requested reasoning effort when supplied, for every NCP implementation. A
generic report does not need branded settings fields. Configuration writes
require explicit `busy:false`; an unknown execution state is not idle.

Coding routes live only under `/api/connector/coding/*`; there is no
`/api/connector/codex/*` alias. Generic coding wire names carry no vendor
prefix: messages use `approvalId`, conversations use `codingActivity`, and
reports use `runtimeInstanceId`. Codex's own native contract (`codexSettings`,
`codexDefaults`, `codex`, `codexUpdate`, `update-codex`) and legacy signed
Connector update operations use the same capability boundary once an identity
handshakes.

An existing legacy credential can make a one-way NCP handshake binding. It may
only narrow its existing profile; requesting `runtime.manage` also proves the
pre-existing independent management token. This path never mints management
credentials or removes an existing manifest. Once bound, omitting the NCP header
cannot restore legacy access. Newly paired Connectors always require explicit
manifest approval, including its opaque digest.

## Delivery recovery and idempotency

Persist `pollId` **before** polling, and keep it until the entire batch is durably
settled. Reusing it replays still-dispatched, unacknowledged deliveries from that
batch. Acknowledged deliveries are excluded. New keys only claim pending work;
they do not automatically recover a batch associated with a lost poll ID.

Hub expires pending or dispatched NCP deliveries after 300 seconds, measured
from dispatch when dispatched, otherwise from creation. Heartbeats do not extend
this delivery deadline. For long work, persist upstream acceptance and ACK
promptly, then send results asynchronously. The bundled synchronous runner is a
short-work reference, not a general long-running job executor.

Persist each delivery ID, upstream execution state and outbound reply key before
performing effects. ACK `ok:true` means the connector accepted responsibility for
the input; it need not imply the complete agent turn has finished. ACK
`ok:false` records failure, with `error` suitable for the owner. Use
`uncertain:true` with `ok:false` and a clear error when execution may have begun.
For text channels the visible projection is a failed delivery with its error;
there is no separate durable upstream reconciliation API in this profile.
Repeated ACKs of the same terminal outcome succeed; contradictory terminal
outcomes fail. An expired/otherwise settled delivery may return 409.

Replies require a stable `clientMessageId` scoped to conversation and role.
Repeating a send with the same key and text returns the existing message;
changing text under an existing key returns 409 (use PATCH for streaming).
A response includes the stable server message `id`. Persist prepared reply
content and its key before sending so a lost response is safely retried.

Hub delivery identity plus local journaling can prevent duplicate reply creation
and avoid blindly repeating uncertain work. This is **not** an exactly-once
guarantee for upstream execution: a process may crash between an external side
effect and its local durable record. Retrying upstream execution requires an
upstream idempotency key, durable receipt, or explicit reconciliation. A timeout
alone never proves that execution did not start.

## Errors and compatibility

Errors have `{error:"machine_readable_code",message:"display text"}`. Treat `error` as machine-readable and the
message as display text; do not log credential-bearing request bodies.

| Status / code | Meaning |
| --- | --- |
| 400 `connector_manifest_invalid` | Unsupported/invalid handshake declaration |
| 400 `connector_extension_unsupported` | Unsupported body field or inbox parameter |
| 401 `session_expired` / `unauthorized` | Token missing, invalid, disabled or revoked |
| 403 `connector_approval_mismatch` | Handshake differs from the owner-approved declaration |
| 403 `connector_capability_denied` | Route or capability was not approved |
| 409 `connector_instance_busy` | Another instance has a live lease |
| 409 `connector_instance_invalid` | Missing, expired, disconnected or retired instance |
| 409 `message_create_failed` / `conflict` | Ownership, idempotency or delivery state conflict |

An operation racing lease expiry may also fail through its existing endpoint's
401/409/500 error path; it does not acquire permission to bypass fencing. Stop
using retired credentials/instances; do not retry them indefinitely. Retry
transport failures using the same durable operation identifiers. A new
capability or minor version needs explicit Hub support before it can be paired.

Existing official connectors keep their existing compatibility profiles and
credentials. NCP capabilities are separate from vendor/AgentKind enums: new
implementations use `kind:"custom"` plus their namespaced declaration. NCP 1.1 advertises rich capability extensions without provider enums. `runtime.manage` is an independently gated management grant; the Hub never treats a message token as a management token.

## Security boundary

Hub capabilities limit what the credential can do on Hub. They do not sandbox
the executable on the user's computer. Independently implemented closed-source
connectors, including those using private upstream interfaces, are permitted by
this protocol but do not gain official trust through conformance.

Link package import requires a pinned executable digest and explicit trust.
Verify the digest through an independent publisher channel before approval.
This initial distribution mechanism is not a public key signature registry,
publisher vetting service, or OS sandbox. A trusted executable runs with the
local user's permissions and can access that user's local data. Use separate
OS accounts/containers if stronger execution isolation is required.

The NCP credential grants access to all text channels belonging to its paired
agent. Keep it in private local storage and pass it through Link's stdin
bootstrap, not environment inheritance or argv. Keep local state private, bind
it to Hub origin plus agent and connector identity, and use an exclusive journal
lock. Revoking the agent's message token stops future Hub access but cannot erase
data an executable already read or stop an already-submitted upstream operation.

#### Next-turn settings extension

This optional extension retains NCP 1.2 manifests and request shapes. A gateway
opts in with `nextTurnSettings:true` in its `POST /connector/coding/connect`
response. A Connector must omit `capabilities.nextTurnSettings` and the new
`configuration` source in `settings` and `codex` until this opt-in is received
on the current connection. Existing native Claude configuration reports retain
their original source semantics.
Older gateways therefore continue to receive their original reports. An absent
or empty capability never permits busy writes; the gateway must not synthesize
it from an Agent kind.

`nextTurnSettings` uses the setting-key grammar above. A nonempty patch can be
saved while running/waiting only when `updateSettings:true` and every patch key
is declared, allowed, and authorized. Unknown execution state, maintenance and
stale instances still block writes. This is not permission to change models or
other management operations.

Success means durable storage before acknowledgement. `settings.values` (and a
native settings projection) reports the saved selection with source
`configuration`; `environment` continues to describe actual execution. A later
successful patch replaces the saved keys. Before starting the next turn, the
Connector applies the saved selection; on failure it must not execute input
under the previous permissions. Unless the live-turn extension below is
negotiated for a field, a running turn and steered input are unaffected. Outstanding approvals and executing tools
always retain their original authorization. Saved configuration must
survive reconnects and restarts; no automatic approval is implied. Clients may
use the simple notice “Applies next turn”.

#### Next-turn model extension

This independent optional extension retains NCP 1.2 manifests and the existing
`switch-model` request (`choiceId`, optional `effort`, and `conversationId`). A
gateway opts in with `nextTurnModel:true` in its coding-connect response
(`/api/connector/coding/connect` for NCP Connectors). A Connector must omit
`capabilities.nextTurnModel` until this opt-in is received on the current
connection. Reconnects negotiate it again. `nextTurnSettings` alone never grants
permission to defer a model change, and the gateway must not synthesize
`nextTurnModel` from an Agent kind. No protocol version or manifest schema
change is needed: older peers keep their existing reports and busy rejection.

`nextTurnModel:true` is valid only with `switchModel:true`. The existing model
scope, ownership, available-choice and reasoning-effort checks still apply.
After negotiation, a conversation's `switch-model` request may save its next
turn selection while the conversation is running or waiting for input or an
approval. Missing or false capability preserves the existing idle-only rule;
unknown execution state, maintenance and stale instances still block writes.
This capability does not grant new instance-default scopes, permit immediate
runtime mutation during a turn, or authorize other management operations.

Success means the Connector durably saved the model and resolved reasoning
effort before acknowledgement. Omitted `effort` follows the runtime's existing
validated model-switch default rules; it must not carry an unsupported effort
from the previous model. Reports expose the saved model in `model` with
`source:"configuration"` and its saved effort in `reasoning.effort` (or `null`
when the selected model has no effort). `lastUsedModel` continues to describe
actual execution; saving a choice must not claim it has already been used.
Clients can show the saved choice with the notice “Applies next turn”.

Requests are serialized with turn admission. The last successfully committed
selection wins, survives reconnection and restart, and is applied before the
next turn starts. A failed save leaves the previous durable selection intact.
If applying the saved selection fails, the Connector must not execute the next
input using a stale model or effort. A running turn, steered input, outstanding
question or approval, and an already executing tool retain their current
selection. Saving does not answer a question, approve an action or resume work.
This contract describes persistence and application ordering; protocol fixture
validation alone does not establish a runtime's implementation of those rules.

#### Live-turn settings extension

A gateway opts in with `liveTurnSettings:true` in its coding-connect response.
The Connector must omit `capabilities.liveTurnSettings` and retain next-turn
semantics until this opt-in is received on the current connection. The capability
requires `updateSettings:true` and every declared key must also be declared in
`nextTurnSettings`. Clients must use the declaration, never infer support from
an Agent kind, version string, or an unrelated permission setting.

The existing authorized update-settings patch both durably saves future-turn
selection and updates the declared fields for subsequent operations in the active
turn. Undeclared fields in a mixed patch retain next-turn semantics. Success
requires native confirmation of live publication, or confirmation that the target
turn is no longer available, plus durable storage. A live update does not rewrite
already captured steps, outstanding approvals, child sessions, or executing tools.
It never authorizes automatically accepting a pending request. Runtimes may reject
unsupported changes; clients must not interpret an updated thread setting as a
confirmed active-turn setting.

`settings.values` continues to describe the saved selection. `environment`
continues to describe confirmed execution facts; fields whose live outcome is
unknown must not retain a misleading last-known value. A confirmed live override
is scoped to the exact native turn and must not leak into a later turn or survive
a lost native process as a fact. Unknown writes must not be automatically replayed
or acknowledged as success. Reconnection negotiates support again. A target that
finishes during the operation uses the saved selection on its next turn.

## Brand migration (2026-10-15)

The product name is **Nilo Agent Hub**; code identifiers use `agent-hub`,
`agent_hub` and `AgentHub`. New clients send `X-Agent-Hub-Management-Token`.
During rollout Hub also accepts the retired `X-Agent-Inbox-Management-Token`
header, but rejects conflicting or duplicate credentials. Upgrade Hub before
Connectors. SDK transports must strip both spellings from message-only calls.

New message metadata uses `agent_hub_kind` and `agent_hub_label`; readers retain
`agent_inbox_kind` and `agent_inbox_label` as fallbacks for stored messages.
The signed v1 Connector release repository and signature domain remain immutable
compatibility identities. They are not names for new products or packages.
