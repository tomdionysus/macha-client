# Completed and tested

Last updated: 2026-09-03

This is the completed-work ledger for the current session. An item belongs here
only after implementation and its stated verification are complete. Detailed
design notes and exact test results remain in the linked records.

## Playback-safe cluster outage handling

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
  work and duplicate demand coalesces by immutable artwork ID.
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
