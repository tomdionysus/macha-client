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
- [x] Introduce a client-owned `PlaybackIntent` snapshot containing all state
  required to recreate a generation on a different node.
- [x] Introduce a node-scoped generation reference containing node identity,
  API origin and node-local session ID. Session IDs alone are insufficient.
- [x] Add deterministic two-node fake APIs/players and failure injection for
  request creation, manifest load, segment/range load, source preparation and
  teardown.
- [x] Characterize position, pause, preference and queue behaviour while a
  replacement is in flight.

Exit criterion: tests can describe node A failing at every relevant boundary
without using global browser events or changing the route.

## Phase 1: endpoint registry and manual discovery

- [x] Replace the single stored server URL with a versioned set of seed/API
  endpoints while migrating existing installations losslessly.
- [x] Keep durable node identity separate from endpoint URL. Until the server
  advertises client API identities, retain endpoint-derived provisional IDs and
  reconcile them when a node reports a durable ID. Implemented:
  `EndpointRegistry` stores `nodeId?: string` separately from `baseUrl`, and
  `applyAdvertisement()` reconciles a server-advertised durable ID onto the
  existing endpoint-derived identity without collapsing distinct endpoints;
  covered by `EndpointRegistry.test.ts`. Dormant until the server actually
  advertises durable node IDs, but no client-side work remains.
- [x] Treat configured addresses as bootstrap API endpoints, not authoritative
  membership. A successful bootstrap response will eventually populate and
  refresh the client-reachable endpoint registry; never reinterpret the current
  cluster transport `host`/`port` fields as HTTP API origins.
- [x] Build an endpoint registry with last success/failure, cooldown and current
  suitability. Actively check every known API endpoint immediately and every
  ten seconds with bounded, non-overlapping cycles and per-endpoint timeouts;
  combine those results with evidence from real requests.
  - [ ] Correction, found 2026-09-04: "per-endpoint timeouts" is not actually
    true today. Neither `useEndpointHealthMonitor`'s probe fetch nor
    `ClusterEndpointRouter.route()`/`find()` bound how long a single attempt
    may take — every `AbortSignal` in the fetch layer is caller-supplied for
    unmount cancellation only, never a timeout. Caught live: a peer session
    reproducing an unrelated HLS bug observed a `route-attempt` to an
    already-known-good, previously sub-second endpoint take 19.7s on one
    attempt, stalling unrelated work that happened to need the same origin
    (plausibly Chrome's per-origin connection-pool limit queuing behind the
    slow request, though shared test-node contention from concurrent
    reproduction work on the same physical node is also plausible and not
    ruled out). Add a real bounded per-attempt timeout (AbortController) to
    every fetch in the cluster status/catalogue/routing layer, not just the
    health-check cycle, so one slow node can never block an unrelated
    request or hold a `route()`/`find()` call open indefinitely.
- [x] Prefer a healthy sticky endpoint for ordinary traffic, but race or advance
  to alternates after bounded failure. Avoid retry storms.
- [x] Make Web CORS and Samsung package origin policy explicit. The initial
  Samsung demonstration may include a build-time allow-list of test endpoints.
- [ ] Persist a limited set of endpoints the client has actually confirmed
  working (not just the one originally configured bootstrap URL) to
  localStorage, and seed `EndpointRegistry` from that set on boot. Added
  2026-09-04: today's fix (`discoverClusterEndpoints()`) keeps the registry's
  candidate pool in sync with live cluster membership, but only in memory —
  a page reload reseeds purely from `macha-bootstrap-endpoints-v1`'s original
  single URL. If the client has since had to fail over away from that node
  because it became unavailable, a reload with that same node still down has
  no way back in until it happens to recover. Keep the persisted set small
  and bounded (last-known-good, not unbounded discovery history) and treat it
  the same as `bootstrap`/`environment` source endpoints, not `discovered`,
  so it isn't silently dropped by `applyAdvertisement()`'s replace-on-refresh.

Exit criterion: the client boots and browses through either of two manually
configured current Macha API endpoints and automatically survives loss of the
active read endpoint.

## Phase 2: node-aware API routing

- [x] Route safe catalogue/status/artwork reads through the endpoint registry
  with bounded alternate retry and request coalescing.
- [x] Preserve content-addressed artwork cache usefulness across endpoint changes.
- [x] Do not silently replay management, ingest or other mutating requests until
  the server provides an idempotency contract. Report their originating endpoint
  and failure accurately.
- [x] Replace the global “server unreachable means navigate to Settings” rule
  with cluster availability. A single endpoint failure is internal diagnostics;
  only exhaustion of all suitable endpoints is user-visible.
- [x] Record node selection, attempt order, cooldown and recovery timing in the
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

- [x] Treat HLS playlists and segments as node-local generations. Do not assume
  independently created sessions have interchangeable segment URLs or boundaries.
- [x] When failure evidence arrives while buffered media remains, continue the
  active player and prepare an alternate generation at the current client-owned
  logical position.
- [~] Decided against, 2026-09-04: a hidden/muted dual-decoder standby player was
  weighed against a latency-based pre-emptive authority swap (moving client API
  authority away from a consistently slow node before failure, rather than
  racing decoders after it). The swap was chosen — lower complexity, no double
  decode-resource cost on constrained platforms (Tizen/Android), and it prevents
  the slow-node case from ever reaching a failure-driven swap at all. See Phase 6
  latency-swap item below and `EndpointRegistry`'s `evaluateLatencySwap`. The
  single-player preflight-and-replace path below remains the failure-driven
  fallback for every platform.
- [x] Where dual decoding is unavailable, preflight the alternate manifest and
  first media data, retain the old frame/buffer as long as possible, then perform
  the smallest single-player source replacement supported by the platform.
- [x] Preserve subtitle selection and rebuild the node-local subtitle manifest
  with the replacement generation.
- [x] Never create a proactive standby during healthy playback. Permit one
  evidence-triggered alternate for 30 seconds, then close it if unused. Once a
  replacement is streaming, retain it and close the superseded session with
  exponentially backed-off best-effort attempts.
- [x] Found and fixed 2026-09-05, reported by a peer session reproducing real A/V
  desync/choppiness on restart against a live Pi node: `degrade()`'s
  evidence-triggered `prepareAlternate()` does not know a seek-driven
  generation replacement is already in flight, and can create a second,
  fully redundant server session for the same user action. Sequence: a
  large seek (e.g. "restart from beginning" on a transcode far into the
  file) is legitimately outside local coverage, so `drainMutations()` PATCHes
  the existing session (`resolver.update()`) — server logs confirm this
  makes the server `stop_pipeline()` the old generation. If the client's
  hls.js instance is still mid-fetch against that old generation at the
  moment the server tears it down, the resulting stream error reaches
  `degrade()`, whose guard checks `alternatePreparations`/`alternateSessions`
  but never `this.activeMutation` — so it treats this as fresh, independent
  failure evidence and calls `prepareAlternate()`, creating a *second*,
  completely separate session via a fresh POST that knows nothing about the
  PATCH already handling the same seek. Confirmed via real server logs: two
  independent transcode pipelines, five seconds apart, both requesting
  position 0, briefly running concurrently on one node — real CPU
  contention and a plausible source of the reported A/V sync jump (each
  fresh pipeline restarts audio/video PTS from zero independently). Fix:
  `degrade()` must not treat an error as fresh evidence while
  `this.activeMutation?.reason === 'seek'` (or more generally, while a
  mutation is already resolving a generation replacement) is in flight for
  the same session. Fixed: `degrade()` now returns early on exactly that
  condition. Deliberately not applied to `fail()`'s reactive failover path —
  that guard is asymmetric, since suppressing it during an in-flight seek
  would silently swallow a genuinely unrelated fatal error with neither
  recovery nor failure UI, which is worse than the bug being fixed. Left as
  a separate, not-yet-designed follow-up if it turns out to matter in
  practice. Regression covered by `PlaybackCoordinator.test.ts` ("does not
  treat a stream error during an in-flight seek-driven generation
  replacement as fresh degradation evidence").

  **Follow-up designed and fixed 2026-09-06.** `fail()` now defers instead
  of ignoring: when a fatal error arrives while `this.activeMutation?.reason
  === 'seek'` is in flight, it captures the currently-playing session and
  waits for that mutation to settle (a new `settled` promise on
  `activeMutation`, resolved in `drainMutations()`'s existing `finally`)
  before acting. Once settled, it compares `sourceIdentity()` of the
  captured session against the current one: if the seek replaced the
  source, the error was about a generation already gone and is dropped as
  stale (same reasoning as `degrade()`); otherwise it's handled exactly as
  if the guard were never there (`recoverFromSourceFailure()` or
  `failTerminal()`, via the extracted `failNow()`). Regression covered by
  `PlaybackCoordinator.test.ts` ("does not act on a stream error during an
  in-flight seek-driven generation replacement until the seek settles, then
  drops it as stale once the seek replaces the source" and "still surfaces
  a fatal error that arrives during an in-flight seek once the seek settles
  without replacing the source"), both confirmed to fail against the
  pre-fix unguarded `fail()`. Full suite green, `tsc --noEmit` clean.

Exit criterion: controlled loss of node A during HLS playback switches to node B
without visible failure UI or state loss. UAT records any freeze/audio gap and
may claim viewer-transparent handoff only when none is observable/measurable
under the defined test.

## Phase 6: current-server demonstration and UAT

- [x] Treat every node-local server `5xx`, including media-open `500`, as a
  retryable endpoint result for safe reads and idempotent playback admission.
  Exhaust the remaining known nodes with one stable request body and
  idempotency key; unsafe mutations remain single-attempt.
- [ ] Server/data availability: during the 2026-09-01 node-50 shutdown UAT,
  node 51 received the alternate session POST but returned `open media:
  Input/output error` because the requested extent was unavailable. Ensure at
  least one surviving node can read every extent required for advertised media,
  or session failover cannot produce an alternate stream regardless of client
  routing. Sent to the macha server session on 2026-09-04 alongside the "Later
  server work" requirements below; awaiting a response.

- [x] Record rolling API latency independently from reachability. Consider
  pre-emptively moving client API authority when another healthy node remains
  materially faster across a bounded sample window. Define hysteresis,
  cool-down and minimum improvement thresholds before implementing this so
  authority cannot flap between nodes.

Use two current Macha nodes supplied explicitly to the client. No server changes
are permitted for this gate.

- [x] Verify both nodes independently expose the same catalogue item/media
  identity and can create the requested Direct and transformed sessions.
- [~] Exercise failure during session POST, Direct range transfer, HLS manifest,
  HLS segment transfer, pause, seek and option change. Direct range transfer done
  (see below); the rest are blocked behind fixing the gap the first run found.
- [x] Test connection refusal, process termination and loss of route to one node;
  do not rely only on synthetic HTTP errors.
- [ ] Prove the client never navigates away, loses its queue/preferences, creates
  an unbounded retry/session loop or waits for old-node cleanup.
- [x] Measure failure detection, alternate selection, source readiness, handoff,
  position error, frozen-video duration, audio-gap duration and remaining buffer.
- [x] Preserve a dated UAT record and classify Direct and HLS outcomes against the
  three success levels above.

### UAT run 2026-09-04 (Direct Play, real two-node failure)

Real cluster: three live Macha nodes across two failure domains
(`10.44.1.50`/`10.44.1.51` = "test-lab", `10.34.1.50` = "spain", `replicas: 2`
placement diverse-by-domain). Test title picked for confirmed cross-node
readability (*Contact*, already in Continue Watching with prior playback
history). `10.44.1.50` was the node actively serving a live Direct Play
session; `macha.service` was stopped via `systemctl` on that host mid-playback
(a real process kill, not a synthetic HTTP error), then restarted ~9 minutes
later to close out the run.

**Detection: pass.** `source-degraded` fired within ~1s of the process
actually stopping (kill completed 21:00:29 wall-clock; client log shows
`source-degraded` / `alternate-preparation-start` at 21:00:29).

**Buffer resilience: pass, and better than expected.** The read-ahead cache
(~94 MB resident at time of kill) sustained ~149s of glitch-free playback with
zero visible impact — no stall, no frozen frame, no audio gap — purely from
already-fetched data, confirmed via live screenshots showing continuous scene
progression.

**Failover: fail — this is the real gap.** Once the buffer drained, the client
never contacted an alternate node. Every network request across the entire
outage — the health probe, and every `__macha_direct_cache__` range-proxy
retry — targeted only the dead `10.44.1.50`. Zero requests were made to
`10.44.1.51` or `10.34.1.50`, both confirmed live and cluster-members for the
whole outage (Status page: 3/3 online throughout). Playback hard-fails with
"No untried Macha playback endpoint remains" — misleading, since no other
endpoint was ever tried. This does not reach even the first success level
(automatic recovery).

**No self-recovery after the source returns.** With `10.44.1.50` back online
and healthy, the player stayed on the failure screen indefinitely — it does
not appear to re-probe on its own. A manual play/retry from the user did
recover cleanly and resumed at the correct position, so the failure is not
destructive to the session/queue, just passive.

**Not yet exercised:** HLS failure, and failure specifically during session
POST / manifest transfer / pause / seek / option-change (Direct range-transfer
failure is the only boundary exercised this run) — deferred until the
no-failover gap above has a fix to test against, since Direct Play itself
doesn't survive the basic case yet.

**Conclusion (superseded below):** the any-node design (make-before-break
handoff, `EndpointRegistry`, disposable generations) is not actually reachable
from an active Direct Play session today — whatever endpoint pool the
playback coordinator consults on source failure does not draw from the same
live cluster membership the Status page uses. This is the next thing to fix
before re-running the rest of the Phase 6 UAT.

### Fix and re-verification (2026-09-04, same day)

Four compounding gaps, found and fixed by repeatedly live-killing real nodes
mid-playback against the same three-node cluster and reacting to what
actually broke, not by inspection alone:

1. **`EndpointRegistry` never learned cluster membership.** It was seeded
   once from the single manually-configured bootstrap URL and never updated.
   Fixed client-side: `discoverClusterEndpoints()` (`useEndpointHealthMonitor.ts`)
   folds live `/api/v1/status` node membership into the registry every health
   cycle. This alone was not enough — `nodes[].host`/`port` is each node's
   internal RPC bind address, not its HTTP API address (confirmed live:
   `10.44.1.51:7437` vs `:7438` are different services on the same node), and
   guessing at the right port (from the RPC port, or by reusing another
   node's known-good port) was explicitly rejected as exactly the kind of
   inference that breaks the first time a real deployment differs. Server-side
   fix requested the same day and shipped as v0.23.7: optional advertised
   API host/port per node (defaulting to the bound address, for NAT), exposed
   as `api_host`/`api_port` on every entry in `nodes[]`. The client only ever
   trusts those explicit fields, never `host`/`port`.
2. **No mechanism existed for the transport layer to fail over without a full
   reload.** `Player.addDirectSourceAlternative()` — built and unit-tested,
   letting the read-ahead Service Worker retry a *different* node's URL under
   the same cache key, invisibly to the `<video>` element — existed but was
   never called anywhere. Wired into `PlaybackCoordinator.prepareAlternate()`:
   once a byte-identical Direct Play alternate is ready, its source is
   registered as a same-key fallback and the coordinator's own session
   bookkeeping is promoted immediately (`promoteSilentDirectAlternate`),
   without ever touching the player. A second, distinct field
   (`activeDirectPlaySource`) tracks what is genuinely loaded in the video
   element, separately from which session is current for lifecycle purposes,
   because the two diverge the instant a silent promotion happens and any
   later fallback registration must still address the source the worker
   actually configured a key for.
3. **The early-warning signal only covered half the failure paths.** The
   Service Worker's `source-degraded` notification fired only from a failed
   *speculative prefetch*, never from a failed *demand* fetch — so a session
   with little or no read-ahead buffer (e.g. just after a seek) got zero
   warning before a demand failure poisoned the video's stream directly
   (`PIPELINE_ERROR_READ`), with no time for any alternate to be registered.
   Fixed in `macha-direct-play-sw.js`: every demand-path exhaustion now
   reports source degradation exactly as a prefetch-path exhaustion already
   did. Confirmed live: a kill executed at the instant of a fresh seek (zero
   buffer) now recovers with no stall at all — the earlier warning gives the
   coordinator time to register the fallback while the browser's own pending
   request is still in its normal retry window, not yet fatal.
4. **A silently-abandoned endpoint was invisible to endpoint health
   tracking.** Silent promotion (fix 2) never told `EndpointRegistry` the old
   endpoint had failed — only the pre-existing reactive `failover()` path did
   that. Consequence, caught by deliberately killing a *second*, different
   node right after the first silent recovery: a later, unrelated reactive
   failure re-picked the already-dead first node as an apparently-untried,
   apparently-healthy candidate, cascading through both dead nodes before
   correctly landing on the one remaining live one. Fixed with a single rule
   applied consistently rather than two independent copies: `recordEndpointFailure()`
   on `PlaybackResolver` is now the one place "this endpoint just failed" is
   recorded, called explicitly by the coordinator for a silent promotion, and
   called internally by `ClusterPlaybackResolver.failover()` for a reactive
   one (replacing its own hand-inlined version of the same two lines).

Re-verified live after each fix, and again after the final unification, with
real `systemctl stop`/`start` against `10.44.1.50`/`10.44.1.51`/`10.34.1.50`:
single-node kill recovers with zero measured stall (250ms-resolution polling
across the full outage window, confirmed independently by the user watching
the screen); a second, different node killed immediately afterward correctly
fails over to the one remaining live node rather than retrying either dead
one. Full unit suite (379 tests) green throughout, including new coverage:
`useEndpointHealthMonitor.test.ts` (membership discovery, and refusing to
guess a port for a node without `api_host`/`api_port`), the Service Worker
harness (demand-path failures now reported), and `PlaybackCoordinator.test.ts`
(silent promotion, chained silent promotions addressing the correct source,
and the `recordEndpointFailure` call).

**New, separate finding — not yet fixed:** the *reactive* (full reload)
recovery path, as opposed to the silent one above, can itself fail instantly
when reactivating Direct Play at a non-zero position: `NotSupportedError`
within ~11ms of dispatch, zero bytes ever requested. Verified with direct
`curl` range requests against the exact node and exact byte offset in
question (start, the failure position, and near end-of-file) that the
underlying data is valid and fully readable — this is not a corrupt replica.
Leading hypothesis (unconfirmed): an MP4/MKV container cannot begin decode
from an arbitrary byte offset without a keyframe-aligned, container-aware
start, and the hard-reactivation path may be attempting exactly that. Distinct
from everything above — the silent path never hits this, since it never
seeks or reloads — but blocks the remaining Phase 6 UAT boundaries (pause,
seek, option-change, and any scenario forcing a genuine reactivation) until
understood. Worth its own investigation before resuming that UAT.

## Later server work

Status: sent to the macha server session ("Macha Server Work") on 2026-09-04 as
the six numbered requirements below, plus the node-51 data-availability gap
from Phase 6. Awaiting a server-side response; not yet landed. The
session-existence/capability and idempotency-key bullets below are now given a
concrete shape in
[the session Bearer auth draft](2026-09-04-session-bearer-auth.md); resolve
there, not here, once that lands.

The client-first demonstration deliberately uses manual endpoints and unrelated
node-local session IDs. Later server support should add:

- [ ] Client-reachable API endpoint advertisement per durable node identity,
  including multiple LAN/WAN/address-family candidates, provenance, expiry and
  compatibility metadata.
  - Minimal first step requested 2026-09-04, in direct response to the UAT
    failure above: add an optional per-node advertised API host/port config
    (NAT/port-forwarding), defaulting to the bound API host/port when unset,
    and expose it as `api_host`/`api_port` on every entry in `/api/v1/status`'s
    `nodes[]` (not just self — `connectivity.advertised` already covers
    self-only external connectivity and is a different concept). Confirmed
    live that a node's existing `host`/`port` in `nodes[]` is its internal RPC
    bind address, not its API port (`10.44.1.51:7437` vs `:7438` observed on
    the same node) — the client must not guess this from RPC port or from
    another node's known-good port; only an explicit advertised value is
    trustworthy. Client already has `ClusterNodeStatus.api_host`/`api_port`
    (optional, for mixed-version clusters) and `discoverClusterEndpoints()`
    wired to consume them the moment a server build reports them.
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
