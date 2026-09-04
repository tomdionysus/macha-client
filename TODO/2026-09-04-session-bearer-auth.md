# Standard session Bearer auth (server-side ask, drafted)

Date: 2026-09-04

Status: drafted, not yet sent. Elaborates two items already sent 2026-09-04 in
[the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md)'s
"Later server work" section: "a cluster-replicated ephemeral session-existence
record and capability... later carrying authentication/management
permissions", and "accept a client-generated idempotency/request key". This
document gives both a concrete shape and folds in one more open item
(`Macha-Viewer-Session`).

## Context: what's ad hoc today

- **Authorization**: a single, static, operator-configured Bearer token
  (`catalogue.api.token_file`) is sent on every request that needs elevated
  access. It's a shared secret, not a session — no expiry, no scope, no
  per-client identity.
- **Viewer/session correlation**: a client-generated `Macha-Viewer-Session`
  header is sent alongside playback-session creation to identify the calling
  session to the server.
- **Idempotency**: a client-generated `Idempotency-Key` header is sent on
  playback-session creation so a retried POST after an ambiguous response
  (timeout, dropped connection) doesn't create a duplicate lease.
- **"Is management available?" is a pure client-side guess.** Today
  `managementAvailable` in `useMachaServices` is `!demo && !apiOverride` — it
  has nothing to do with whether the server would actually authorize a
  management call. The client shows management UI and finds out server-side
  whether it's actually allowed only when a request fails. There is no real
  authorization boundary today, only a configured secret that either works or
  doesn't.

## The ask

Replace all of the above with one standard REST session resource and a bearer
flow:

- `POST /api/v1/sessions` — create a session. Returns a bearer token, its
  granted permission scope(s) (at minimum: viewer vs. management), and an
  expiry.
- `PUT`/`PATCH /api/v1/sessions/{id}` — refresh/extend a session before it
  expires, so a long browsing/playback session doesn't die mid-stream. The
  client will refresh proactively ahead of expiry, not reactively after a 401.
- `DELETE /api/v1/sessions/{id}` — end a session (logout / explicit revoke).
- `Authorization: Bearer <session-token>` on every subsequent request,
  replacing today's static configured token for ordinary API traffic.

This should become a **real authorization boundary**, not just a rename of the
current shared secret: a session's granted scope is enforced server-side on
every management/mutating call, regardless of what the client attempts. The
client should be able to read its own granted scope from the session response
and gate UI (e.g. hide management screens) from that authoritative answer,
rather than guessing.

**Fully replaces `Macha-Viewer-Session`.** Once the bearer token itself
identifies the session, a separate header carrying the same idea is redundant
and should be dropped entirely, not kept alongside.

**Idempotency moves to a URL query parameter, not a header.** e.g.
`POST /api/v1/playback/sessions?idempotency_key=<opaque>` and
`POST /api/v1/sessions?idempotency_key=<opaque>`. We'd rather not adopt the
IETF `Idempotency-Key` header draft's semantics (mandated response-replay/
caching behavior) when all we actually need is an opaque string the server
keys on for deduplication. A query parameter is plain, loggable, curl-able,
and — since these are both non-cacheable POSTs — carries no caching-hazard
downside from being in the URL. No client-side idempotency-key *generation*
logic changes; only where it's attached.

**Cluster-replicated, no authoritative session-owner node.** This must follow
the same principle already established for playback: any node must be able to
validate a session's bearer token without a round trip to one distinguished
node, or session validation becomes the single point of failure the any-node
failover work was built to avoid.

**Open question for you, not a client-side demand:** what authenticates the
initial `POST /api/v1/sessions` call itself? Our instinct is that today's
configured secret becomes a one-time bootstrap credential presented only in
that one call (never on ordinary per-request traffic afterward), but the
credential/pairing model is your call — flag back if you have a different
shape in mind (e.g. per-device pairing).

**Mixed-version tolerance.** Older nodes without session support need a
defined fallback — presumably: a node that doesn't advertise the session
capability keeps accepting the current static-token-per-request path, same
tolerance philosophy used elsewhere in this cluster work.

## What this explicitly does not touch

Signed artwork/stream capability URLs (shipped 2026-09-04, see
`COMPLETED.md`) are unrelated and unaffected. Those exist because a plain
`<img>`/media element load can't carry an `Authorization` header at all —
different problem, different mechanism. This ask is only about JS-orchestrated
`fetch()` calls.

## Summary of removals once this lands

- `Macha-Viewer-Session` header — removed, replaced by the bearer token's own
  identity.
- Static per-request `Authorization: Bearer <configured-token>` on ordinary
  traffic — removed, replaced by the session bearer token. (Whether the
  static secret survives as a one-time bootstrap credential is the server
  team's call, per above.)
- `Idempotency-Key` header — removed, replaced by an `idempotency_key` query
  parameter on the same endpoints.
- Client-side `managementAvailable` heuristic — removed, replaced by reading
  the actual granted scope from the session response.
