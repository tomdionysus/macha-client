# Any-node client and seamless playback failover

Date: 2026-08-31

Status: active client-first plan. The initial demonstration must use the current
server API without server modifications. Later server work improves discovery,
authorization and continuity evidence; it must not move playback state out of
the client.

## Objective

The client must be able to communicate with and stream from any suitable Macha
node. If the active node becomes unhealthy or unreachable, playback should move
to another node without a visible error, position jump, unintended pause or
avoidable interruption.

Perfect continuity cannot be guaranteed after simultaneous failures, exhausted
replicas, incompatible output, loss of every reachable endpoint or insufficient
buffer. The system must nevertheless make a bounded best effort designed to
make ordinary single-node failure unnoticeable.

This is a direct application of **Thou Shalt Not Make The Viewer Wait**.

## Non-negotiable model

The client exclusively owns:

- the selected catalogue item and media representation;
- current position and play/pause intent;
- mode, quality, audio and subtitle preferences;
- playback queue, playlists, Continue Watching and navigation context; and
- failover policy and the current disposable node-local generation, plus at most
  one evidence-triggered replacement during a bounded 30-second recovery window.

The future cluster session contains only replicated ephemeral existence and,
when authorization is introduced, identity/permissions and expiry. It contains
no media, position, preferences, queue, playlist or playback owner.

There is no authoritative playback node, ownership transfer or fencing token.
Any node may accept the same cluster session and create a disposable local
playback generation. Temporary overlap between old and replacement generations
is legitimate and desirable during make-before-break handoff.

Node-local generations are cleaned up by client best-effort DELETE and server
idle expiry. Loss of the cluster session causes transparent session recreation;
it never causes loss of client playback state.

## Existing foundation

The current client already separates application-scoped playback intent from
replaceable source generations. It can request an initial transformed generation
at `seek_ms`, preserve preferences, keep a source active while another generation
is prepared and tear down obsolete sessions.

The current limitations are:

- one persisted server URL constructs every API and resolver;
- a network failure globally redirects the UI to Settings;
- sessions are identified only by a node-local session ID, without endpoint
  provenance;
- terminal player failure immediately becomes a visible failed runtime state;
- the Direct Play read-ahead worker knows one source URL; and
- the Samsung package permits one fixed API origin.

## Success levels

1. **Automatic recovery:** playback resumes on another node without user action.
2. **Presentation continuity:** no route change, terminal error screen, lost
   controls, preference loss, queue mutation or restart from the wrong position.
3. **Viewer-transparent handoff:** the old buffer/source remains useful until the
   alternate is ready, with no observable video freeze or audio gap under the
   tested single-node failure conditions.

Tests and UAT must report these levels separately. A functional resume must not
be described as seamless if it visibly stalls.

## Phase 0: characterize and expose the seams

- [x] Define typed failure classes: endpoint transport/unreachable, session
  missing/expired, retryable server admission, stream network, media decode and
  incompatible source. Decoder/content failures must not condemn a healthy node
  without evidence.
- [ ] Introduce a client-owned `PlaybackIntent` snapshot containing all state
  required to recreate a generation on a different node.
- [x] Introduce a node-scoped generation reference containing node identity,
  API origin and node-local session ID. Session IDs alone are insufficient.
- [ ] Add deterministic two-node fake APIs/players and failure injection for
  request creation, manifest load, segment/range load, source preparation and
  teardown.
- [ ] Characterize position, pause, preference and queue behaviour while a
  replacement is in flight.

Exit criterion: tests can describe node A failing at every relevant boundary
without using global browser events or changing the route.

## Phase 1: endpoint registry and manual discovery

- [ ] Replace the single stored server URL with a versioned set of seed/API
  endpoints while migrating existing installations losslessly.
- [ ] Keep durable node identity separate from endpoint URL. Until the server
  advertises client API identities, retain endpoint-derived provisional IDs and
  reconcile them when a node reports a durable ID.
- [ ] Treat configured addresses as bootstrap API endpoints, not authoritative
  membership. A successful bootstrap response will eventually populate and
  refresh the client-reachable endpoint registry; never reinterpret the current
  cluster transport `host`/`port` fields as HTTP API origins.
- [x] Build an endpoint registry with last success/failure, cooldown and current
  suitability. Actively check every known API endpoint immediately and every
  ten seconds with bounded, non-overlapping cycles and per-endpoint timeouts;
  combine those results with evidence from real requests.
- [ ] Prefer a healthy sticky endpoint for ordinary traffic, but race or advance
  to alternates after bounded failure. Avoid retry storms.
- [ ] Make Web CORS and Samsung package origin policy explicit. The initial
  Samsung demonstration may include a build-time allow-list of test endpoints.

Exit criterion: the client boots and browses through either of two manually
configured current Macha API endpoints and automatically survives loss of the
active read endpoint.

## Phase 2: node-aware API routing

- [x] Route safe catalogue/status/artwork reads through the endpoint registry
  with bounded alternate retry and request coalescing.
- [ ] Preserve content-addressed artwork cache usefulness across endpoint changes.
- [ ] Do not silently replay management, ingest or other mutating requests until
  the server provides an idempotency contract. Report their originating endpoint
  and failure accurately.
- [ ] Replace the global “server unreachable means navigate to Settings” rule
  with cluster availability. A single endpoint failure is internal diagnostics;
  only exhaustion of all suitable endpoints is user-visible.
- [ ] Record node selection, attempt order, cooldown and recovery timing in the
  bounded diagnostics buffer without exposing credentials.

Exit criterion: normal client communication has no distinguished permanent
server endpoint, while unsafe mutations retain explicit failure semantics.

## Phase 3: disposable generation recreation

- [x] Consume `GET /api/v1/catalogue/media/{media_id}/profile` while presenting
  playback details or constructing playback capabilities/options. Cache profiles
  only by immutable `macha:` media ID; never probe media client-side or key
  profile data by mutable path. Treat `202 profile_pending` and
  `404 profile_not_available` as temporary, never cache the negative, and
  begin ordinary playback-session negotiation independently and immediately.
  Optional profile publication must never become a viewer-path admission
  dependency: session creation proceeds through normal media-engine planning and
  must not return `425 profile_pending`; `202 profile_pending` belongs to the
  optional profile GET. As mixed-version protection only, a node
  that violates that contract is bypassed in favour of another suitable endpoint
  with the same logical idempotency key; the client never polls profile state in
  the viewer path.
- [x] Normalize catalogue and session media facts into one local technical
  profile. Use an early immutable profile to construct and wire the reusable
  media element and begin the cached platform-capability probe before Play;
  complete the same preparation from every authoritative session response so
  missing or pending catalogue profiles retain identical correctness.
- [x] Make detail profile consumers cancellable while allowing two abandoned
  immutable-profile requests to finish as a bounded corpus-building tail. Abort
  the oldest overflow request, retain successful immutable results in cache, and
  never record deliberate cancellation as endpoint failure.
- [ ] Once the minimum supported node capability guarantees immutable media
  profiles, rationalise the compatibility path: remove redundant fallback-derived
  option logic and temporary-negative handling that no longer serves mixed-version
  clusters, while preserving immutable-ID cache semantics.
- [x] Make the playback resolver node-aware. Every resolve/update/stop must route
  to the node that owns that disposable generation.
- [x] Show the active node and stream/API endpoint in the in-player status near
  codec/source details. Use generation provenance, keep credentials/query secrets
  out of display and diagnostics, and update it when failover changes generation.
- [x] On node or stream failure, snapshot the latest client-observed position and
  complete preferences, choose a different node, and POST a new current-API
  session with the same item/media intent and `seek_ms`.
- [x] Preserve play/pause and any seek/option changes made during recovery; newer
  client intent supersedes the recovery request exactly as it does during an
  ordinary source-generation change.
- [x] Keep obsolete DELETE best-effort. An unreachable old node must never block
  replacement preparation.
- [x] Enter visible terminal failure only after the bounded candidate/deadline
  policy is exhausted or the error is proven content/decoder incompatibility on
  every suitable source.

Exit criterion: injected loss of node A automatically recreates playback on node
B at the correct logical position, with no route/UI failure or state loss.

## Phase 4: Direct Play continuity

- [x] Extend the Direct Play service worker source registration from one URL to
  an ordered set of equivalent node-local Direct Play URLs.
- [x] Establish equivalence before byte splicing. Require the same immutable
  media identity and compatible size/range/content metadata; do not splice
  mutable `path:` sources merely because their names match.
- [x] On retryable range failure, continue the exact requested byte range from an
  alternate source without changing `video.src`. Preserve partial-response and
  cancellation semantics and keep speculative read-ahead subordinate to viewer
  demand.
- [x] Keep healthy Direct Play at exactly one session. A failed speculative
  TCP/range read opens a 30-second recovery window and only then prepares one
  byte-compatible alternate while cached/buffered playback continues. Close the
  alternate if the primary recovers; permanently promote it if it is needed.
- [x] Add service-worker regressions for failure before headers, after partial
  bytes, overlapping ranges, stale generations, cancellation and alternate
  exhaustion.

Exit criterion: during a controlled node-A outage, the media element continues
the same Direct Play resource through node B without a source replacement,
position discontinuity or viewer-visible stall.

## Phase 5: transformed/HLS make-before-break

- [ ] Treat HLS playlists and segments as node-local generations. Do not assume
  independently created sessions have interchangeable segment URLs or boundaries.
- [x] When failure evidence arrives while buffered media remains, continue the
  active player and prepare an alternate generation at the current client-owned
  logical position.
- [ ] On platforms with sufficient decoder resources, load the alternate into a
  hidden/muted standby player, wait for decoded/buffered readiness, align its
  logical timeline, then switch presentation/audio atomically and dispose the old
  player generation.
- [x] Where dual decoding is unavailable, preflight the alternate manifest and
  first media data, retain the old frame/buffer as long as possible, then perform
  the smallest single-player source replacement supported by the platform.
- [x] Preserve subtitle selection and rebuild the node-local subtitle manifest
  with the replacement generation.
- [x] Never create a proactive standby during healthy playback. Permit one
  evidence-triggered alternate for 30 seconds, then close it if unused. Once a
  replacement is streaming, retain it and close the superseded session with
  exponentially backed-off best-effort attempts.

Exit criterion: controlled loss of node A during HLS playback switches to node B
without visible failure UI or state loss. UAT records any freeze/audio gap and
may claim viewer-transparent handoff only when none is observable/measurable
under the defined test.

## Phase 6: current-server demonstration and UAT

- [ ] Record rolling API latency independently from reachability. Consider
  pre-emptively moving client API authority when another healthy node remains
  materially faster across a bounded sample window. Define hysteresis,
  cool-down and minimum improvement thresholds before implementing this so
  authority cannot flap between nodes.

Use two current Macha nodes supplied explicitly to the client. No server changes
are permitted for this gate.

- [ ] Verify both nodes independently expose the same catalogue item/media
  identity and can create the requested Direct and transformed sessions.
- [ ] Exercise failure during session POST, Direct range transfer, HLS manifest,
  HLS segment transfer, pause, seek and option change.
- [ ] Test connection refusal, process termination and loss of route to one node;
  do not rely only on synthetic HTTP errors.
- [ ] Prove the client never navigates away, loses its queue/preferences, creates
  an unbounded retry/session loop or waits for old-node cleanup.
- [ ] Measure failure detection, alternate selection, source readiness, handoff,
  position error, frozen-video duration, audio-gap duration and remaining buffer.
- [ ] Preserve a dated UAT record and classify Direct and HLS outcomes against the
  three success levels above.

## Later server work

The client-first demonstration deliberately uses manual endpoints and unrelated
node-local session IDs. Later server support should add:

- [ ] Client-reachable API endpoint advertisement per durable node identity,
  including multiple LAN/WAN/address-family candidates, provenance, expiry and
  compatibility metadata.
- [ ] A cluster-replicated ephemeral session-existence record and capability
  accepted by any node, later carrying authentication/management permissions and
  expiry—but no playback state or owner.
- [ ] Transparent recreation of an expired/missing cluster session so cluster
  session loss cannot interrupt playback recovery.
- [ ] Make playback-session creation retry-safe across an ambiguous response.
  Accept a client-generated idempotency/request key and allow the client to
  recover the committed result after connection loss, without creating duplicate
  leases or introducing a playback-session owner. Live UAT demonstrated a POST
  whose caller timed out before receiving the subsequently committed lease.
- [ ] Cluster-consistent authentication, CORS/TLS and revocation behaviour for
  every advertised client endpoint.
- [ ] Explicit immutable representation/continuity evidence where current media
  identity, size/range and HLS timeline metadata are insufficient to prove a safe
  handoff.

These additions replace manual discovery and strengthen validation. They do not
change the client-owned playback-intent or disposable-generation design.

## Completion gate

This plan is complete only when:

- the client can browse and play through any suitable discovered node;
- a single endpoint or node failure remains internal while alternatives exist;
- Direct Play failover is byte-safe and viewer-transparent in the defined UAT;
- transformed playback performs the strongest platform-supported
  make-before-break handoff and reports its measured continuity honestly;
- queues, playlists, position and preferences remain exclusively client-side;
- the future cluster session remains ownerless and playback-state-free; and
- all retries, alternates, sessions, buffers and recovery deadlines are bounded,
  event-driven and covered by deterministic failure tests.
