# Completed and tested

Last updated: 2026-09-06

This is the completed-work ledger for the current session. An item belongs here
only after implementation and its stated verification are complete. Detailed
design notes and exact test results remain in the linked records.

## Anonymous session survives a reload: validate-then-mint, not mint-every-time

Following directly from the deep-link 401 fix below: every reload re-minted a
brand new anonymous session from scratch, a real server round trip creating a
new session record, even though the *previous* token was usually still
perfectly valid. That's a viewer-visible delay on every single reload for no
reason — a direct violation of Law 2, "Thou Shalt Not Make The Viewer Wait"
(`docs/principles-and-laws.md`). It also widened the exact race the deep-link
fix closes: the longer `sessionReady` takes to become true, the bigger the
window for something to fire an authenticated request too early.

- [x] `SessionManager` now persists `{token, expiresAtMs}` to `sessionStorage`
  (tab-scoped, gone with the tab — matching an anonymous session's own
  lifetime) on every successful mint, and `start()` tries a cached,
  unexpired token first via a new cheap validity check
  (`SessionAuth.validateAnonymousSessionAnyNode`, reusing the same
  lightweight `GET /api/v1/catalogue/status` the health monitor already
  probes) before ever minting fresh. A live server check — not just trusting
  the locally-recorded expiry — both proves the token still authenticates
  and doubles as an endpoint-reachability check, and correctly handles
  reconfiguring to a different server (the old token 401s against the new
  one, falling through to a fresh mint) with no extra bookkeeping needed.
  A rejection or an unreachable-during-validation failure both fall through
  to a normal fresh mint, which will hit the same nodes and fail the same
  way if the cluster is genuinely unreachable.
- [x] **Found and fixed a second, related bug while verifying this live**:
  `SessionManager.fetch()` reactively re-minted on *any* 401, including one
  from a request that fired before any token existed yet (nothing to
  reject). Depending on timing, a slow such request's 401 could arrive
  *after* a fast, successful cache validation had already adopted a good
  session — silently clobbering it with a wasteful fresh mint. Fixed by
  capturing whether a token existed *before* issuing the request and only
  reacting to 401 when it did; a tokenless 401 is never evidence the current
  session is bad, since there wasn't one to reject.
- [x] **Found and fixed a third bug this exposed**: `App.tsx`'s
  Manage-unmatched-count effect fired `manageApi.unmatched()` unconditionally
  on mount, before `sessionReady`, and its dependency array never included
  `sessionReady` — so an early 401 there would leave the badge silently and
  permanently stuck at 0, never actually retrying once the session became
  ready. Gated it on `sessionReady` and added it to the deps.
- [x] Added `src/api/SessionManager.test.ts` coverage: adopts a validated
  cached session without minting, mints and re-caches when validation
  rejects it, skips validation entirely for an already-expired cached entry,
  and — the regression for the second bug — does not re-mint when a slow
  request's tokenless 401 resolves after a token was already adopted.
  Confirmed that last one fails against the prior code (temporarily
  disabled the `hadToken` guard, reran, restored it) and passes with the fix.
- [x] Live-verified against the real cluster: the same cached token survived
  three consecutive hard reloads unchanged (no re-mint), and the original
  deep-link-into-`/play/:itemId` scenario still resumed playback cleanly
  with the cache-validation path active underneath.
- [x] Passed 416/416 tests and TypeScript typechecking.

## Deep-linked `/play/:itemId` reload could 401 before the session mint completed

Investigating the "readyState 0 forever" Direct Play P0 (see `ACTIVE.md`) live
via browser automation surfaced a real, unrelated bug: a hard reload (or any
fresh navigation) straight into `/play/:itemId` occasionally failed instantly
with "Macha playback request failed: a valid session bearer token is
required" — reproduced live and confirmed with a real user report of the same
failure mid-session.

Root cause: `App.tsx` blocks every other route behind a `!sessionReady`
Loading screen (added in the session/auth migration) specifically so no
route fires an authenticated request before the first session mint
completes. But `usePlaybackController`'s route-reconstruction effect — the
one that reconstructs an active player from `location.pathname` alone,
needed for exactly this kind of deep link — runs unconditionally as part of
that hook, which is called *before* `App.tsx`'s early return. It had no way
to see `sessionReady` at all, so it could fire `api.details()`/`runtime.play()`
immediately with no token yet minted, on the very first render.

- [x] Added an optional `sessionReady` option to `usePlaybackController`
  (default `true`, so existing callers/tests are unaffected) and gated the
  reconstruction effect on it, re-running once it flips true — this can never
  re-gate or interrupt something already playing, since the same effect
  already bails out immediately whenever `activePlayback` exists.
  `App.tsx` now passes its own `sessionReady` (from `useSession`) straight
  through — that value already folds in the `!connectionRequired` case.
- [x] Added a regression in `usePlaybackController.test.tsx` proving
  reconstruction is deferred while `sessionReady` is false and fires once it
  becomes true; confirmed it fails against the prior code (temporarily
  disabled the guard, reran, restored it) and passes with the fix.
- [x] Live-verified against the real cluster: a hard reload directly into
  `/play/tmdb:movie:8374` — the exact failing scenario — now resumes
  playback cleanly instead of 401ing.
- [x] Passed 411/411 tests and TypeScript typechecking.

## Platform UI traits, and no mini player on Samsung/Android

Codex's earlier "single core, multiple platform" work left `Platform` with
only playback-technical fields; every UI-behavior decision (D-pad nav,
hash routing, TV back handling, player control scheme) was re-derived ad
hoc from `platform.name`/`import.meta.env.MODE` at each call site, in three
different, inconsistent groupings. Fixed as a prerequisite before touching
any of that behavior:

- [x] `src/platform/platformTraits.ts` — five named traits
  (`usesDpadNavigation`, `usesHashRouting`, `receivesBackKeyEvents`,
  `usesRemoteMediaControls`, `hasPointerControls`), each documented with
  *why* it exists and which platforms currently share it (named after the
  decision, not collapsed just because two platforms agree on it today).
  Migrated every scattered check to read from it — `main.tsx` (router
  choice), `useTvNavigation.ts` (deleted the now-redundant private
  `tvMode()`), `DetailScreen.tsx`, `useMediaRouteBack.ts`, `App.tsx`'s
  `samsungBack`, and `PlayerScreen.tsx` (`samsungControls`/`webControls`,
  plus two in-file duplicates of the same `platform.name === 'web'` check
  found while in there). Left alone deliberately: `bootSplash.ts`,
  `state/client.ts`, the platform badge label, `main.tsx`'s
  diagnostics-config/fatal-handler block (infra/cosmetic, not
  UI-interaction behavior), and `detectPlatform()` itself (the canonical
  place `MODE` decides platform identity, not a scattered check to fix).
  Pure consolidation — every trait's value is identical to what it replaced.

The mini player bar doesn't work on a real TV remote (no pointer to reach a
small persistent control) — removed on Samsung and Android specifically:

- [x] `PlayerScreen.tsx`: the remote-back and Android-dev-keyboard-Escape
  paths now call `onStop()` (full close) instead of `onMinimize()`; the
  visible minimize/back button in the full chrome no longer renders outside
  `webControls`. Extracted the decision into a tested pure function,
  `playerBackAction(webControls)`, matching this file's existing
  `playerBufferedTimelineEnabled`-style testability pattern.
- [x] Android's hardware back button is intercepted **natively** before any
  JS runs (`platforms/android`'s `MainActivity.onBackPressed()` calls
  `WebView.goBack()` directly) — confirmed by reading the Java source, not
  assumed. A pure web-side fix would have been silently unreachable on a
  real device. Added a JS↔native hook: `MainActivity` now asks
  `window.__machaHandleBack()` first (via `evaluateJavascript`) and only
  falls back to `WebView.goBack()`/`finish()` if it's absent or returns
  false; `PlayerScreen.tsx` registers that hook to call `onStop()` while the
  full player is showing. Not device-tested — no Android hardware/emulator
  available here; the Java change is small and mechanically matches the
  existing `onBackPressed` shape, but treat it as unverified until run on a
  real device or emulator.
- [x] **Live-verified on Samsung** (`vite --mode samsung`, demo content):
  minimize button confirmed absent from the DOM; dispatching the Samsung
  remote "Return" key (`keyCode 10009`) from the full player now closes
  playback and returns to the previous screen, with no mini bar appearing.
- [x] Added `src/screens/PlayerScreen.test.ts` coverage for
  `playerBackAction`.

**The live Samsung check caught a second real, pre-existing bug**: closing
from the full player (not the mini bar) silently restarted the same title
from position 0 instead of closing. Root cause: `stop()`/`handleEnded()`
navigate away from `/play/:id` and asynchronously clear the runtime's active
request; if the runtime's phase reaches `idle` (request cleared) on a render
where the router hasn't yet committed the navigate-away, the
reconstruct-from-route effect sees "on the player route, no active
playback" — indistinguishable from a reload deep-linked into the player —
and restarts it. This existed before this session's changes (the explicit
close button also hits it) but was rarely exercised, since minimize (the
overwhelmingly common path) never clears the request and so never races.
Making back/close the normal path on TV made it fire on nearly every exit.

- [x] Fixed with a `suppressReconstructRef` in `usePlaybackController.ts`,
  set when `stop()`/`handleEnded()` navigate away from an active player
  route, cleared only once the route has actually left `/play/:id` —
  proving the intentional stop this was guarding actually completed, not
  just that some render happened to run.
- [x] Added `src/app/usePlaybackController.stopRace.test.tsx`: mocks
  `react-router-dom`'s `useNavigate`/`useLocation` to decouple "navigate()
  was called" from "the route changed" (a real `MemoryRouter` flushes both
  together in a synchronous test, hiding the exact race). Confirmed this
  test fails against the pre-fix code (reverted it and re-ran to check)
  before confirming it passes against the fix.
- [x] Passed 409/409 tests and TypeScript typechecking.

## Session/auth REST contract migration: a proper SessionManager, two real bugs caught live

The server session implemented a new anonymous-session auth subsystem
(`POST /api/v1/session` mint, `Authorization: Bearer` required on every other
route) in parallel with this client-side work. This landed in three passes,
each catching something the previous one missed.

**Pass 1 — the contract itself.** Every API client (`Macha*Api`/`Cluster*Api`,
plus the playback resolver) authenticates through an injected auth
dependency instead of a manually-entered token. Removed the legacy
`Macha-Viewer-Session` header and the whole `viewer_session_id`/
`PlaybackAdmissionContext` concept outright (this app only ever runs one
`PlaybackRuntime` per tab, so per-viewer multiplexing had nothing to
distinguish) and the `Idempotency-Key` header (now
`POST /api/v1/playback/sessions?idempotency_key=<...>`).

**Pass 2 — a live joint test against the server session's real instance
caught a real bug no unit test had**: within seconds, the client fired
thousands of `POST /api/v1/session` calls in a tight loop (all landing as
201s — the server was never at fault). Root cause: `setTimeout`'s delay is a
32-bit signed int (~24.8-day max); scheduling the proactive pre-expiry
refresh for the full remaining duration of this contract's ~30-day session
TTL silently overflowed to ~0ms, so the client re-minted immediately after
every "successful" mint, forever. Fixed by chunking the wait into re-checks
no longer than 24h, recomputing the real remaining time on each recheck.

**Pass 3 — booting a fresh client against the real cluster surfaced two more
real problems**, prompting a full architectural redo of the first pass
rather than another patch:
- Several requests fire at cold boot (concurrent catalogue loads, the
  health-monitor's own probe) before the session mint — itself an async
  network round trip — has completed. Those 401s reached the user as a raw,
  permanently-stuck error banner ("a valid session bearer token is
  required"): nothing re-triggered the failed screen once the token
  actually arrived.
- The auth/401 plumbing itself had spread across a dozen files: a
  `BearerTokenSource` union type threaded through every client's
  constructor, a `reportUnauthorized()` 401-check line copy-pasted into six
  leaf API classes plus the health monitor, and a global
  `window` `CustomEvent` used purely to get a 401 signal back to the one
  hook that could act on it.

Rebuilt as a proper `SessionManager` (`src/api/SessionManager.ts`): one
class owns minting, proactive refresh, and — because every API client now
authenticates by calling `sessionManager.fetch(url, init)` instead of
building its own headers — 401 detection and reactive re-mint too, all
internally, with no event bus needed. `sessionManager` is a genuine
app-lifetime singleton; `src/app/useSession.ts` is a thin React interface
onto it (configures it for current connection settings, subscribes to its
`ready` state) rather than a hook that owns or constructs a session, so
every API client and the health monitor share the exact same live instance.
`fixedBearerToken(token)` is the second, much simpler implementation of the
same `AuthenticatedFetch` interface — the Settings screen's manual override
and every test double, both by construction incapable of drifting from
what production code actually depends on.

App-level: added a `sessionReady` gate (`src/App.tsx`) that blocks the real
route tree and the health monitor's polling/discovery — not just the
manual-token-vs-auto-mint distinction — until the first mint attempt
settles, success or failure; a failure hands off to the existing
cluster-unreachable gate instead of hanging. Never gates mid-playback.

- [x] `src/api/SessionManager.ts` + `src/api/SessionManager.test.ts` (11
  tests, incl. the setTimeout-overflow regression, now against the class
  directly).
- [x] `src/app/useSession.ts` + `src/app/useSession.test.ts` (5 tests).
- [x] Every leaf/cluster API class, `useEndpointHealthMonitor.ts`,
  `useMachaServices.ts` migrated from `bearerToken?: BearerTokenSource` to
  `auth: AuthenticatedFetch`; deleted `SessionTokenStore.ts`,
  `useSessionAuth.ts`, `SESSION_UNAUTHORIZED_EVENT`/`reportUnauthorized()`.
- [x] Live-verified against the real cluster (`10.44.1.50`, plus whatever it
  advertises via cluster discovery): a single clean mint at boot, the
  stuck-error banner is gone, health-monitor polling of every known node —
  including newly-discovered ones — never fires unauthenticated.
- [x] Passed 406/406 tests and TypeScript typechecking.

**Known residual gap, accepted rather than chased further**: the peer's dev
instance had streaming/FFmpeg disabled, so the idempotency query parameter on
an actual `POST /api/v1/playback/sessions` call, and a real token
expiry/re-mint cycle (the TTL is ~30 days — impractical to wait out), were
each verified only by unit test with a mocked clock/fetch, not against a live
server. Both are low-risk and will be exercised incidentally the next time a
real playback UAT runs (tracked separately in `ACTIVE.md`).

## Poster artwork cache-smashing

Signed capability artwork URLs (`/api/v1/catalogue/artwork/<id>?exp=...&sig=...`)
are re-signed by the server on every catalogue re-fetch, even when the
underlying image hasn't changed and the previous signature hasn't actually
expired. Handing each fresh signature straight to `<img src>` makes every
re-fetch a brand-new browser HTTP-cache key, so revisiting a screen (e.g.
Home) re-downloaded and re-decoded every poster already on screen — the
server's `Cache-Control` never got a chance to do anything, since the cache
key itself was what churned.

- [x] `LazyArtwork`'s `CapabilityArtwork` (`src/components/LazyArtwork.tsx`)
  now maps artwork `id` -> the last URL that actually loaded successfully
  (module-level, survives a full unmount/remount from screen navigation). A
  same-id re-fetch with a merely-reissued signature is ignored in favor of
  the already-cached URL; a real failure (the cached copy genuinely expired
  or evaporated) still falls through to the fresh URL the caller just gave.
- [x] Added 4 tests: ignoring a re-signed URL for an already-loaded id,
  surviving a full remount, falling back to a fresh URL after a real
  failure, and a never-before-seen id loading from its own URL untouched by
  another id's cache entry.
- [x] Passed the existing `LazyArtwork.test.tsx` suite unchanged — none of
  those tests fire a real `onLoad`, so the new cache never activates for
  them, confirming no behavior change for anything already covered.

## Artwork capability URLs: client cutover, and a real bug caught in UAT

The server session landed signed artwork capability URLs (`url` field on every
artwork object in `/items`, `/items/{id}`, `/search`) and reported it back.
Implemented the client side of
[the original ask](2026-09-04-artwork-capability-urls.md):

- [x] Added `url?: string` to `ArtworkRef` (`types.ts`) and wire-type
  `CatalogueArtwork` (`api/CatalogueApi.ts`); threaded through
  `MachaMediaApi.mapArtwork`.
- [x] `LazyArtwork` now dispatches to a plain, hook-free `<img src loading>`
  when `artwork.url` is present. Deliberately kept the existing Blob-fetch/
  viewport-observer/decode-retry path (`useViewportArtworkUrl`,
  `artworkViewport.ts`, `MachaMediaApi`'s cache/dedup) as a fallback for
  artwork without a `url`, rather than deleting it as the original ask
  envisioned: this client's whole architecture assumes a mixed-version
  cluster, the server session's own build was "uncommitted, Tom pushes
  manually" at time of writing, and the fallback costs nothing (a single
  `artwork?.url` branch) versus real interop risk. Applied the same
  short-circuit to `useArtworkUrl` (hero/backdrop images) and
  `MetadataEditorScreen`'s `ArtworkPreview`.
- [x] Added tests: `mapArtwork` threading, `LazyArtwork` (4 cases: capability
  URL, eager capability URL, legacy fallback, no-artwork placeholder),
  `useArtworkUrl` (3 cases).

**UAT caught a real bug the tests above did not**: the user opened the app in
a real browser and reported artwork requests failing against
`localhost:5173` (the Vite dev server), not the actual Macha node. Root
cause: the server's signed `url` is a bare relative path
(`/api/v1/catalogue/artwork/<id>?exp=...&sig=...`), meaningful only relative
to whichever node issued it. Handing that straight to `<img src>` lets the
*browser* resolve it — against the current page's origin, never the API
node's — whereas the existing Blob-fetch fallback path was unaffected
because it resolves the node explicitly in JS
(`ClusterCatalogueApi`/`MachaCatalogueApi`), which is also why Continue
Watching kept working while other newly-converted surfaces didn't: it's the
exact same code, so once this client build reaches artwork with a `url`
field anywhere, it will hit this everywhere the fast path is taken, not just
in one screen.

- [x] Fixed at the correct layer, mirroring how `MachaPlaybackResolver`
  already absolutizes stream/subtitle URLs: `MachaCatalogueApi` (the
  single-node wire client) now resolves every artwork `url` against its own
  `baseUrl` in `list`/`get`/`search`/`update`/`putArtwork`, before the item
  ever reaches `ClusterCatalogueApi` or `MachaMediaApi`. Because
  `ClusterCatalogueApi` already constructs one `MachaCatalogueApi` per
  endpoint, this automatically resolves against whichever node actually
  served that specific response — no extra endpoint-provenance plumbing
  needed above this layer.
- [x] Added a regression that fails node A and lets node B serve the item,
  proving the artwork URL resolves against node B specifically (not node A,
  not left relative) — confirmed it fails against the prior code and passes
  with the fix. Passed 369/369 tests and TypeScript typechecking.
- [x] Re-verified live in the browser (2026-09-04) against the real connected
  cluster node `10.44.1.200:7438`: reloaded Home, Movies and TV Shows on the
  running dev server (`localhost:5173`), confirmed network requests for
  artwork resolve against the node's own origin (signed `exp`/`sig` query
  params intact) rather than `localhost:5173`, all posters decoded
  (`naturalWidth`/`naturalHeight` populated) and rendered, and no console
  errors — the fix holds cluster-wide, not just in Continue Watching.

## Artwork capability URLs: server ask sent

- [x] Sent [the drafted ask](2026-09-04-artwork-capability-urls.md) to the
  macha server session ("Macha Server Work"): embed short-lived signed artwork
  URLs in catalogue responses, matching the existing stream/subtitle
  capability-URL pattern, cacheable and backward compatible, so the client can
  drop its hand-rolled artwork cache/dedup/retry machinery in favour of a plain
  `<img loading="lazy">`. Awaiting a server-side response before any client
  work on this can start.

## Any-node failover plan: latency-based pre-emptive authority swap

- [x] Implemented the Phase 6 item in
  [the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md):
  "Record rolling API latency independently from reachability... define
  hysteresis, cool-down and minimum improvement thresholds before
  implementing this so authority cannot flap." Chose this over the plan's
  other remaining non-blocked option (a dual-decoder hidden-standby HLS
  player) after discussing tradeoffs: the TV platforms this plan targets
  typically have exactly one hardware decoder session, so a second concurrent
  `hls.js` pipeline risks silently degrading or failing outright, and the
  realistic audience for "safe to double-decode" is desktop Web, where the
  existing single-player fallback swap already avoids visible failure UI or
  state loss.
- [x] `EndpointRegistry` now tracks a bounded 5-sample rolling latency average
  per endpoint (`recordLatency`/`latencyMs`), fed from the existing 10-second
  health-probe cycle's own round-trip time — never from real request timing,
  so ordinary traffic variance can't influence routing. `evaluateLatencySwap`
  only moves `preferredId` when the fastest ready (non-cooling) alternate
  beats the current preferred endpoint by both an absolute floor (200ms) and
  a relative floor (40%) for three consecutive probe cycles running, and then
  will not swap again for 60 seconds — hysteresis, minimum improvement and
  cooldown, respectively, all named in the plan.
- [x] Found and fixed a bug in my own first implementation before it shipped:
  the swap cooldown compared against a `lastLatencySwapAt` initialized to
  `0`, which could false-block the very first swap whenever `now` was small
  (true in every test using the file's existing small-integer clock
  convention, and not something to rely on `Date.now()` epoch size to avoid
  in production either). Fixed with an explicit "never swapped yet" sentinel.
- [x] Added 18 `EndpointRegistry` tests (hysteresis, both improvement floors,
  streak-reset on a changing fastest candidate, cooldown-in-cooldown
  interaction, rolling-window bounds) and 2 `useEndpointHealthMonitor` tests
  proving the probe cycle records latency only for genuinely successful
  responses and logs a reported swap. Passed 358/358 tests (one unrelated,
  pre-existing wall-clock-timing test in `directPlayReadAhead.test.ts` flakes
  under full-suite parallel load but passes in isolation and on repeat runs)
  and TypeScript typechecking.

## Any-node failover plan: server asks sent

- [x] Sent the plan's "Later server work" requirements plus the Phase 6
  node-51 data-availability gap to the macha server session ("Macha Server
  Work"): durable node identity/endpoint advertisement, a cluster-replicated
  ephemeral session-existence record with transparent recreation, retry-safe
  playback-session creation across an ambiguous response (a real UAT timeout
  case), cluster-consistent auth/CORS/TLS per advertised endpoint, explicit
  immutable continuity evidence for Direct Play splicing, and the node-51
  `open media: Input/output error` extent-availability gap from the
  2026-09-01 UAT. Awaiting a server-side response before any of this can land;
  client-side work continues independently in the meantime.

## Any-node failover plan: HLS generations already fully node-local

- [x] Verified the Phase 5 item "Treat HLS playlists and segments as
  node-local generations. Do not assume independently created sessions have
  interchangeable segment URLs or boundaries" in
  [the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md)
  against actual source and checked it off with no code change. `WebPlatform.attachHls`
  destroys the prior `hls.js` instance and creates a fresh one per
  `sourceGeneration`, gates every hls.js event on that generation matching the
  current one, and always `loadSource()`s the new generation's own node-local
  manifest URL. `preflightWebHlsSource` fetches an alternate's manifest/media
  URLs independently via plain `fetch`, never touching the active `hls.js`
  instance. Nothing in the client ever mixes or reuses a segment/manifest URL
  across sessions.

## Any-node failover plan: client-owned PlaybackIntent survives node failover

- [x] Closed the remaining Phase 0 item in
  [the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md):
  "Introduce a client-owned PlaybackIntent snapshot containing all state
  required to recreate a generation on a different node." `PlaybackCoordinator`
  already tracked position (`snapshot.intent`) and pending representation
  changes (`snapshot.pendingPreferences`) internally, so no new public type was
  needed — but `prepareAlternate` and `recoverFromSourceFailure` each
  reconstructed failover preferences straight from the last *server-confirmed*
  session, one of them via a duplicated seven-field inline object literal.
- [x] Found and fixed a real gap this exposed: a representation change
  (mode/quality/audio/subtitle) already requested by the viewer but not yet
  confirmed by the failing node was silently dropped on failover — recovery
  recreated the generation with the stale server-echoed preferences instead.
- [x] Added `PlaybackCoordinator.currentPreferences()`, the one place that
  folds `pendingPreferences` over the last confirmed session, and pointed both
  `prepareAlternate` and `recoverFromSourceFailure` at it, removing the
  duplicate literal.
- [x] Added a regression that stalls a representation-change PATCH to the
  failing node and proves the not-yet-confirmed preference still reaches the
  replacement node; confirmed it fails against the prior code and passes with
  the fix. Passed 348/348 tests and TypeScript typechecking. No existing test
  was changed, only extended.

## Any-node failover plan: deterministic two-node fake APIs/players

- [x] Closed the last open Phase 0 item in
  [the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md):
  "Add deterministic two-node fake APIs/players and failure injection for
  request creation, manifest load, segment/range load, source preparation and
  teardown." Per-layer coverage already existed but was scattered and ad hoc
  (each test file hand-rolling its own `fetch` mock chain and wire-session
  builder); nothing exercised the real production stack end to end.
- [x] Added two shared, reusable test fixtures: `src/test/fakePlayer.ts` (a
  `Player` test double implementing every optional hook) and
  `src/test/fakeCluster.ts` (a multi-node fake Macha playback HTTP API wired
  to the real `EndpointRegistry`/`ClusterPlaybackResolver` behind a stubbed
  `fetch`, with a per-node FIFO queue for scripting session/error/network-
  failure/hang responses).
- [x] Added `src/playback/ClusterNodeFailover.test.ts`, the first test to
  drive the real `PlaybackCoordinator` + real `ClusterPlaybackResolver` +
  real `EndpointRegistry` together against two independently scripted fake
  nodes: request-creation failure recovery, live-stream failover with real
  DELETE teardown of the failed lease, and HLS standby preparation/promotion
  without a redundant second admission — proving the pieces actually wire
  together, not just each layer in isolation. Segment/range-load failover for
  Direct Play already had equally deterministic two-node coverage in
  `tests/directPlayReadAheadServiceWorker.test.ts`, untouched here.
- [x] Passed 347/347 tests and TypeScript typechecking. No existing test was
  modified.

## Any-node failover plan: reconciled against actual implementation

The [any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md)
had fallen behind the code — a lot of Phase 0-2 work was actually done during
the "codex-refactor" work but never checked off. Verified each unchecked
Phase 0-2 item against current source and tests and checked off the ones
genuinely satisfied:

- [x] Phase 0: "Characterize position, pause, preference and queue behaviour
  while a replacement is in flight" — `PlaybackCoordinator.test.ts`'s
  "transport invariants" describe block (e.g. "accepts play/pause intent
  immediately while server generation work is in flight", "keeps the old
  source running while a backwards HLS generation is prepared").
- [x] Phase 1: "Replace the single stored server URL with a versioned set of
  seed/API endpoints, migrating losslessly" — `src/state/client.ts`'s
  `StoredBootstrapEndpoints{version:1,urls[]}` with lossless migration from
  both the legacy single-URL key and an interim multi-endpoint key; tested in
  `client.test.ts`.
- [x] Phase 1: "Treat configured addresses as bootstrap API endpoints, not
  authoritative membership" — `normalizeConnectionEndpoints` rejects
  blank/same-origin entries; CORS is server-enforced per `docs/server-api.md`.
- [x] Phase 1: "Prefer a healthy sticky endpoint... avoid retry storms" —
  `EndpointRegistry.candidates()`'s sticky-preferred ordering plus the
  `FAILURE_COOLDOWN_MS` ladder (already reviewed/fixed this session via
  `recordProbeFailure`).
- [x] Phase 1: "Make Web CORS and Samsung package origin policy explicit" —
  `vite.config.ts`'s Samsung `config.xml` access-origin declaration; CORS
  itself documented as server-enforced.
- [x] Phase 2: "Do not silently replay mutating requests" — `ClusterEndpointRouter.mutation()`
  tries exactly one endpoint, never retries; tested in `ClusterCatalogueApi.test.ts`
  ("does not replay a mutation whose outcome is uncertain").
- [x] Phase 2: "Replace the global unreachable-means-Settings rule with cluster
  availability" — `reportClusterUnreachable()`/`reportClusterReachable()` are
  cluster-wide, driven by `useEndpointHealthMonitor`'s all-endpoint reachable
  count, not any single request; `shouldEnterConnectionGate` gates on that
  flag alone.

- [x] Phase 2: "Record node selection, attempt order, cooldown and recovery
  timing in the bounded diagnostics buffer without exposing credentials" —
  this was the one genuinely missing, unblocked item the reconciliation
  found: the whole cluster routing layer logged nothing at all, unlike
  playback. Added `createClientLogger('cluster.routing')` to
  `ClusterEndpointRouter`'s `route()`/`find()`/`mutation()` (attempt with
  order, success, per-endpoint failure with retryability, and exhaustion) and
  `createClientLogger('cluster.health')`'s `probe-cycle` summary to
  `probeKnownEndpoints`. Only endpoint ids/base URLs are logged, no
  credentials. Added regressions asserting the exact event sequence for a
  failover-then-succeed request and the reachable/known probe summary.

Left unchecked and confirmed correctly still open: durable node identity
reconciliation from server advertisement (blocked — nothing server-side to
advertise yet), the PlaybackIntent/preferences-snapshot consolidation (needs a
closer look at whether `PlaybackCoordinator` already retains preferences
internally before sizing the work), and the compatibility-path rationalization
(explicitly conditional on a cluster-wide capability guarantee the client
can't unilaterally declare).

## Native lazy-loaded artwork, without a hand-rolled scheduler

- [x] Replaced hand-rolled scroll/resize/rAF viewport-proximity polling
  (`src/hooks/artworkViewport.ts`) with the browser's native
  IntersectionObserver. The previous approach could permanently miss a card
  revealed by any layout change other than a real scroll/resize event (a row
  loading/collapsing above it, for example), leaving it stuck on the
  placeholder indefinitely.
- [x] Removed the custom four-slot `ArtworkRequestScheduler` concurrency
  limiter entirely (superseding the "shared four-transfer scheduler" bullet
  under "Self-healing clustered artwork loading" below). It duplicated the
  browser's own per-origin/HTTP-2 connection management, and its single
  shared mutable `active` counter was the most plausible source of a silent,
  cumulative "some posters just never load" report that persisted after the
  IntersectionObserver fix alone didn't fully resolve it.
- [x] Kept the artwork Blob cache and in-flight request dedup map in
  `MachaMediaApi` — both simple, per-key, stateless-across-requests, and not
  implicated.
- [x] Documented the deeper structural fix and drafted a server-side ask
  ([TODO/2026-09-04-artwork-capability-urls.md](2026-09-04-artwork-capability-urls.md))
  to let artwork ride short-lived signed URLs the way playback stream/subtitle
  URLs already do, which would let the client drop this machinery almost
  entirely in favour of a plain `<img loading="lazy">`.
- [x] Added IntersectionObserver-fake-backed regressions (`artworkViewport.test.ts`)
  proving one-shot fire-on-intersect, cleanup-before-intersect, and the
  no-IntersectionObserver (older Samsung Tizen) fallback. Passed 342/342
  tests and TypeScript typechecking. No TV deployment was attempted.
- [!] **Open caveat, not yet resolved**: `CHANGELOG.md`'s 0.7.4 entry records
  that this project already used IntersectionObserver once and *deliberately
  removed it* ("remove... reversible IntersectionObserver state") in favour
  of the scroll/resize approach just replaced here. No reason survives in git
  history (that era's commits are squashed rollups with empty bodies). Best
  guess is Samsung Tizen 3 lacked IntersectionObserver and the old
  implementation had no fallback for that — today's does
  (`typeof IntersectionObserver === 'undefined'` → eager-load) — but this is
  unverified. **Before shipping to the Samsung build specifically**, confirm
  on-device that the fallback path actually engages rather than throwing, and
  reconsider if the real historical reason turns out to be something else.

## Playback/cluster correctness fixes from a "grad-level howler" review

- [x] `EndpointRegistry`: added `recordProbeFailure()` so a background health
  probe updates cooldown/health without ever clearing the endpoint currently
  preferred by real traffic — previously a single transient probe blip on the
  authoritative node could quietly and permanently surrender its authority,
  a plausible cause of intermittent "media doesn't start."
- [x] `WebHlsPolicy`/`WebPlatform`: removed hls.js's own `startPosition` seek,
  leaving the app-level initial-seek listener (which correctly maps through
  `mediaTimeline.toMediaTime`) as the sole owner of the resume seek —
  eliminating a double-seek race on every resumed/Continue-Watching playback
  that was a likely source of reported player jitter.
- [x] `usePlaybackController`: added a one-shot ref guard so the
  route-reconstruction effect can't re-issue `runtime.play()` for a
  navigation that `startPlayback`/`selectQueueIndex` already started in the
  same gesture, removing a real (if timing-dependent) risk of a duplicate
  server session negotiation.
- [x] `ClusterCatalogueApi.readArtwork` now routes through
  `ClusterEndpointRouter.find()` (extended with an `advisory` option to
  preserve "artwork success doesn't steal authority") instead of hand-rolling
  its own candidate loop — closing a facade gap where the same authority bug
  above could independently recur for artwork.
- [x] Added targeted regressions for the probe-failure/authority fix and
  verified the `usePlaybackController` fix by confirming its test fails
  without the guard and passes with it. Passed 332/332 tests (at the time)
  and TypeScript typechecking.

## Hook/effect test coverage, using the platform's own testing idiom

- [x] Added `@testing-library/react` + `jsdom` (matching this project's own
  `node >=20` floor, not the newer default), scoped to files that opt in via
  the per-file `// @vitest-environment jsdom` pragma so the rest of the suite
  stays on the fast dependency-light `node` environment.
- [x] Converted `AsyncIconButton`, `MediaPageTitle` and `StatusHeader`'s tests
  from hand-rolled `renderToStaticMarkup` + HTML-string matching to real
  `render`/`screen` queries.
- [x] Added real hook/effect coverage that didn't exist before: exported and
  tested `attachSpatialTvNavigation` (previously unreachable outside a
  Samsung/Android build mode, so completely untested — now covers
  focus-on-attach, geometry-based directional movement, Enter-to-activate,
  Back routing and cleanup), `usePollingTask`'s actual `useEffect` wiring
  (recreation on dependency change, cleanup on unmount, `enabled: false`),
  and a `usePlaybackController` regression test for the duplicate-`play()`
  race above.
- [x] Passed 344/344 tests and TypeScript typechecking at the time.

- [x] Restricted application-wide cluster-unreachable transitions to the
  dedicated all-endpoint health sweep; foreground API exhaustion remains local
  to the operation that observed it.
- [x] Deferred the Connection recovery gate while a persistent player owns
  playing or paused media, preventing route replacement from unmounting the
  player and releasing its source/cache.
- [x] Added a reachable transition so deferred recovery is discarded when any
  real request proves that the cluster returned before playback ends.
- [x] Added regressions for foreground-outage isolation and active-playback gate
  deferral; passed 330/330 tests, TypeScript typechecking and the local Web
  production build. No TV deployment was attempted.

## Pause-preserving playback acquisition

- [x] Made Pause freeze presentation without stopping managed HLS acquisition;
  hls.js continues filling to its existing bounded buffer ceiling.
- [x] Preserved in-flight Direct Play read-ahead ranges across Pause and allowed
  the worker to continue contiguous speculative reads to its bounded cache
  frontier.
- [x] Kept Stop, source replacement, seeking, genuine failure and higher-priority
  viewer demand as distinct operations that may still terminate or pre-empt
  speculative work.
- [x] Added a worker regression proving an active range survives Pause, further
  ranges are fetched while paused, and the result is served from memory.
- [x] Passed 328/328 tests, TypeScript typechecking and the local Web production
  build. No TV deployment was attempted.

## Cancellation isolation for endpoint health

- [x] Removed the health monitor's three-second abort and stopped attaching its
  lifecycle signal to `/api/v1/catalogue/status` HTTP requests.
- [x] Made an obsolete health monitor ignore its eventual result without
  cancelling the request or publishing false endpoint evidence.
- [x] Made connection-setup checks use a bounded local wait without aborting
  their status requests or describing a merely pending response as an outage.
- [x] Classified `AbortError` as local caller intent rather than a retryable
  endpoint failure, preventing cancellation from demoting authority, trying
  unrelated nodes, or opening the global connection gate.
- [x] Changed playback-admission deadlines to abandon only the local wait while
  leaving the underlying POST independent and observed.
- [x] Added cancellation-isolation and non-cancelling health/admission/setup
  regressions; passed 327/327 tests and TypeScript typechecking. No TV
  deployment was attempted.

## Logical-viewer playback admission

- [x] Made the application-scoped persistent `PlaybackRuntime` own one opaque
  logical-viewer identity and passed it through initial playback, retries,
  representation recovery, standby preparation and node failover.
- [x] Added `Macha-Viewer-Session` to every playback-session POST while keeping
  session PATCH/DELETE addressed by the admitted session ID.
- [x] Preserved operation-scoped idempotency: each distinct admission gets a
  new `Idempotency-Key`, and all endpoint retries of that admission retain the
  same key and body.
- [x] Added regressions for the wire header, runtime identity persistence,
  standby/failover propagation, retry-key reuse and distinct-operation keys.
- [x] Passed 324/324 tests, TypeScript typechecking, and local Web, Samsung and
  Android Web production builds. No TV deployment was attempted.

## Self-healing clustered artwork loading

- [x] Replaced unbounded browser-owned poster fan-out with a shared
  four-transfer scheduler; foreground detail/player artwork passes queued grid
  work and duplicate demand coalesces by immutable artwork ID. **Superseded
  2026-09-04**: the scheduler itself was removed (see "Native lazy-loaded
  artwork, without a hand-rolled scheduler" above) as a likely source of a
  silent request-starvation bug; duplicate-demand coalescing is retained via
  `MachaMediaApi`'s in-flight request map.
- [x] Added an eight-second artwork-only node deadline that remains locally
  effective on legacy fetch implementations, plus alternate-node lookup for
  node-local `404` and retryable failures.
- [x] Kept artwork placement separate from API authority: a healthy local miss
  does not condemn or displace the current node, while an actual timeout remains
  endpoint-health evidence.
- [x] Removed permanent blank states after exhausted network or decode retries.
  Failed mounted cards cool down for one minute and re-arm through the
  near-viewport gate, with explicit bounded diagnostics and no UI error spray.
- [x] Passed 322/322 tests, TypeScript typechecking, and local Web, Samsung and
  Android Web production builds. No TV deployment was attempted.

## Debounced uncached seeking and seek-bar focus

- [x] Kept cached seeks immediate while delaying only generation-requiring
  seeks until 300 ms after the last slider or repeated skip transition.
- [x] Coalesced rapid movement into the final position and cancelled an unsent
  generation request when the user returned to locally cached coverage.
- [x] Cancelled an obsolete in-flight seek as soon as newer viewer input arrives,
  then applied the moving debounce to the replacement request. Cancellation is
  locally non-blocking even on legacy TV fetch implementations that ignore the
  signal, and stale cancellation errors never reach the viewer.
- [x] Propagated cancellation through the cluster and HTTP playback layers
  without marking the session node unhealthy or logging an intentional abort
  as a failed API request.
- [x] Corrected TV range ownership: Left/Right adjust playback position, while
  Up/Down re-enter spatial focus navigation instead of changing the range.
- [x] Added timing, request-count, cache-cancellation and range-direction
  regressions; passed 317/317 tests, TypeScript typechecking and a local Web
  production build. No TV deployment was attempted.

## Reliable in-playback representation switching

- [x] Removed the exact-position activation condition that repeatedly
  renegotiated Auto/Direct/Remux/Transcode generations whenever healthy
  playback advanced during the server request.
- [x] Catch up inside the returned transformed generation using its local
  offset, while retaining a new server generation only for a genuine move
  behind its available start.
- [x] Exposed pending playback preferences through coordinator state so mode,
  quality, audio and subtitle pills respond immediately and reconcile to the
  accepted server session or revert after failure.
- [x] Added a regression proving a mode switch with three seconds of concurrent
  playback makes one server request and activates at the correct local offset.
- [x] Passed 311/311 tests, TypeScript typechecking and local Web, Samsung and
  Android builds. No TV deployment was attempted.

## Premature media-element completion recovery

- [x] Distinguished a truncated source-generation `ended` event from genuine
  item completion using the authoritative session duration.
- [x] Kept the player open and routed a premature end through normal
  alternate-node stream recovery from the last observed position.
- [x] Added regressions for mid-item truncation and genuine completion within
  the five-second duration tolerance.

## Fixed Samsung client redeployment

- [x] Passed all 314 client tests and TypeScript typechecking, then produced a
  fresh legacy Chromium 47-compatible signed Samsung widget.
- [x] Installed `macha00001.Macha` on the Samsung TV at
  `10.44.1.183:26101` and received successful platform install and launch
  confirmation. Interactive catalogue, navigation and playback UAT remains
  active.

## Deployable Android TV package

- [x] Replaced the Android design-only packaging stub with a buildable Android
  TV application that hosts the shared client in a full-screen WebView.
- [x] Added Android-mode hash routing, TV D-pad navigation, WebView media
  capability reporting, LAN HTTP access, TV launcher metadata and the known
  four-node bootstrap set without introducing module lazy loading.
- [x] Produced the debug-signed `Macha-Android-TV-0.8.1-debug.apk`, verified its
  package/launcher manifest and packaged JS/CSS assets, and recorded SHA-256
  `03a3dcb7a38309751a1fdd46efbf2871d01483e7f2fc7f56d044fe4bc2087ff9`.
- [x] Passed 314/314 tests, TypeScript typechecking, the Android Web build,
  Android resource/Java compilation and APK assembly.
- [x] Connected to the ES-1 Android TV at `10.34.1.115`, installed the package,
  and diagnosed its first on-device launch failure as a vendor-specific absent
  decor view during early immersive-mode setup.
- [x] Deferred immersive setup until after content attachment, rebuilt and
  reinstalled the package, then verified process `media.macha.client` remained
  alive and `MainActivity` was the visible, resumed fullscreen activity.

## Asynchronous node identity reset acceptance

- [x] Accepted both queued `202 Accepted` and legacy `200 OK` node identity
  reset responses without treating `metadata_persisted: false` as failure.
- [x] Removed the accepted retired node ID from operational status immediately,
  retained that filter across the one prompt reconciliation refresh, and did
  not add reset-specific polling.
- [x] Kept identity authoritative: a replacement node with a different ID but
  the same host remains visible.
- [x] Added retired direct-node status support and queued/pending audit details.
- [x] Passed 313/313 tests, TypeScript typechecking, modern Web and
  Samsung/Tizen production builds, and `git diff --check`.

## Explicit API endpoints and unified navigation surfaces

- [x] Removed the obsolete same-origin API concept from connection input,
  persistence migration, bootstrap construction and discovered advertisements.
  Blank lines and `/` can no longer make the health monitor probe the Web/Vite
  origin.
- [x] Removed stale Vite-proxy guidance and documented direct CORS API access.
- [x] Made the main and secondary navigation containers consume the exact same
  background/transparency and blur tokens, including the legacy Samsung CSS
  transformation.
- [x] Passed 309/309 tests, TypeScript typechecking, modern Web and
  Samsung/Tizen production builds, and `git diff --check`.

## Legacy Samsung cancellation compatibility

- [x] Added an eager `AbortController`/`AbortSignal` compatibility layer for
  Chromium 47 before React mounts, without replacing native implementations.
- [x] Preserved the cancellation mechanics used by async page loading, endpoint
  probing, artwork, playback and request cleanup: abort state/reason, listeners,
  one-shot listeners, removal and `throwIfAborted`.
- [x] Passed 306/306 tests, TypeScript typechecking, modern Web and
  Samsung/Tizen production builds, and `git diff --check`.
- [x] Kept the corrected build local as requested; deployment and on-device UAT
  remain explicitly active work.

## TV D-pad navigation rollback

- [x] Removed the row/group focus algorithm, route focus-memory layer and their
  dedicated implementation after on-device UAT found navigation materially
  worse than the prior behaviour.
- [x] Restored the earlier geometry-based spatial scoring and DOM-order
  fallback for both Samsung and Android while retaining native editor/caret and
  playback-range key ownership.
- [x] Passed 308/308 remaining tests and TypeScript typechecking, then built,
  installed and launched the rollback on Samsung `10.44.1.183` and ES-1 Android
  TV `10.34.1.115`.
- [x] Confirmed the ES-1 Macha process remained alive and `MainActivity` was the
  visible, resumed fullscreen activity after replacement.

## Catalogue refresh and Samsung transport controls

- [x] Added the shared fixed-size refresh control to every server-backed media
  catalogue page, including search and nested details. Refresh retains route
  context and the last usable data, with failures reported inline.
- [x] Registered Samsung transport keys and mapped Play, Pause, Play/Pause,
  Previous, Next and Stop across modern key names and legacy Tizen key codes.
- [x] Re-enabled the focusable Samsung playback slider. Repeated D-pad
  Left/Right presses preview bounded ten-second steps, key release commits the
  seek, and Back cancels an uncommitted adjustment before leaving the player.
- [x] Passed 297/297 tests, TypeScript typechecking, modern Web and
  Samsung/Tizen production builds, and `git diff --check`.

## Behaviour-preserving refactor and artwork reliability

- [x] Corrected the pre-existing management API URL expectation failure and
  consolidated shared HTTP request mechanics without changing domain errors.
- [x] Decomposed application orchestration, playback presentation, persistence,
  polling, diagnostics, HLS policy, subtitle selection and styles into focused
  units while preserving current behaviour.
- [x] Added characterization and regression coverage around high-risk route,
  queue, runtime, polling, HLS, subtitle and artwork mechanics.
- [x] Retained one eagerly loaded application bundle with no `React.lazy`,
  dynamic module imports, route splitting or deferred feature chunks.
- [x] Consolidated and preloaded the canonical logo while retaining viewport
  lazy loading for ordinary catalogue artwork.
- [x] Hardened intermittent poster loading with longer bounded transient
  retries, invalid-response rejection, cache eviction and bounded browser
  decode recovery.
- [x] Passed 189/189 tests, TypeScript typechecking, modern and Samsung/Tizen
  production builds, and `git diff --check`.

Evidence: [refactor and artwork reliability record](2026-08-31-refactor-and-artwork-reliability.md)

## Profile-informed local playback preparation

- [x] Unified immutable catalogue profiles and session-derived source facts as
  one normalized client-side technical profile.
- [x] Made detail-page profile arrival preconstruct and wire the application-
  scoped media element and start the shared platform-capability probe.
- [x] Cached platform capability detection across playback generations and made
  every successful session response complete the same local preparation path.
- [x] Preserved immediate session negotiation when profile data is pending,
  missing or still in flight; source-specific work still waits only for the
  authoritative negotiated URL.
- [x] Added subscriber-aware profile cancellation with a two-request abandoned
  corpus-building tail; overflow aborts oldest-first without poisoning endpoint
  health, while successful tail results still populate the immutable cache.
- [x] Passed 278/278 tests, TypeScript typechecking, modern Web and Samsung/Tizen
  production builds, and `git diff --check`.

## Manage selection, dialogs and filesystem navigation

- [x] Made Unmatched refresh bypass browser caches and expose its active state.
- [x] Added compact unmatched rows with independent review state, multi-select
  checkboxes, bulk retry and confirmed bulk deletion with partial-failure
  reporting.
- [x] Kept unmatched metadata left-aligned at responsive widths, added full-list
  select-all and bounded 20-item paging.
- [x] Added a reusable fixed-size asynchronous icon button; refresh controls now
  disable and replace their icon with a spinner for the full request lifetime.
- [x] Replaced every browser confirmation dialog with a reusable, focus-managed
  application modal, including the Status identity-association reset.
- [x] Moved folder creation into a modal and enabled confirmed file or folder
  deletion through the existing MachaDFS path API.
- [x] Added linked path breadcrumbs and icon controls for up, refresh and open.
- [x] Tightened the main and secondary navigation stack without changing their
  shared visual treatment.
- [x] Passed 283/283 tests, TypeScript typechecking, modern Web and Samsung/Tizen
  production builds, and `git diff --check`.

## Application-level connection gate

- [x] Centered asynchronous icon contents reliably in both modern and legacy
  Samsung layouts.
- [x] Classified all-node transport exhaustion separately from reachable-node
  API/HTTP errors and reduced its UI copy to one concise message per outage.
- [x] Routed transport exhaustion to `/manage/settings/connection` and stopped
  mounting ordinary API-consuming screens while the gate is active, without
  unmounting an existing player.
- [x] Added locked first-run Welcome setup when no endpoints are configured;
  proposed endpoints and credentials are checked before persistence and the
  application cannot be entered until at least one endpoint responds.
- [x] Passed 289/289 tests, TypeScript typechecking, modern Web and Samsung/Tizen
  production builds, and `git diff --check`.

## Consistent Status refresh controls

- [x] Added the shared fixed-size refresh icon to Overview, Client,
  Connectivity, Nodes and individual node-detail headers, including loading and
  error states.
- [x] Retained each page's appropriate refresh mechanics: cluster reloads,
  explicit client endpoint probes, and connectivity probes followed by current
  status.
- [x] Removed the separate `Check connectivity` text action; Connectivity and
  node detail now expose that operation through their standard refresh icon.
- [x] Passed 290/290 tests, TypeScript typechecking, modern Web and Samsung/Tizen
  production builds, and `git diff --check`.

## Playback admission endpoint exhaustion

- [x] Made node-local HTTP 5xx responses retryable for safe cluster reads and
  idempotent playback generation creation while preserving single-attempt
  management mutations.
- [x] Added regression coverage for active node A failing, node B returning a
  media-open 500, and node C admitting the identical replacement request with
  the same idempotency key.
- [x] Passed 277/277 tests, TypeScript typechecking, modern Web and Samsung/Tizen
  production builds, and `git diff --check`.

## Consistent section navigation

- [x] Restyled the Music secondary navigation to match the main navigation and
  reused the same shell-level component for Status and Manage.
- [x] Added routed Status sections for Overview, Client, Connectivity and Nodes;
  each route renders only its own content, while Client remains purely local and
  does not wait for cluster status.
- [x] Moved Unmatched, Files and Settings out of Manage's pill tabs and into the
  shared secondary navigation row, preserving management availability rules and
  TV focusability.
- [x] Passed 278/278 tests, TypeScript typechecking, modern Web and Samsung/Tizen
  production builds, and `git diff --check`.
