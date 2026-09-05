# Active tasks and concepts to explore

Last updated: 2026-09-06

This is the working backlog for the current session. Add new work here. When an
item is implemented and its stated verification is complete, remove it from
this file and add a dated entry with evidence to `COMPLETED.md`.

The existing documents in this directory remain the detailed plans,
checkpoints, and verification records. This file is only the current index.

Scope: this file (and this repo) is macha-client only — the UI/playback
client. Server-side backlogs (e.g. `macha`'s own `TODO/ACTIVE.md`) are a
different repo's concern and are not tracked or duplicated here, even when a
client bug and a server bug are related.

Priority reflects active-breakage/user-impact, not effort: P0 is a live or
recently-live correctness problem in playback itself; P1 is important,
scoped, and actionable now; P2 is real but either blocked on something
outside this repo or needs groundwork before it can be started safely.

## P0 — Direct Play sometimes never starts: `<video>` element stuck at readyState 0 forever

**Top priority — actively breaks playback, found live tonight (2026-09-05).**
Environment: macOS Chrome 152.0.7977.77, dev server (`localhost:5173`), 3-node
cluster, title "The Boondock Saints" (`tmdb:movie:8374`), Direct Play mode
(mp4, video+audio `copy`), streamed from node `gbni-1` (`10.44.1.50:7438`).
Reproduced repeatedly across many separate attempts this session; NOT
reproduced on the very first attempt of the evening (see the pattern note
below — this may matter).

**Symptom:** after a normal, successful session-create (`session-created`
logs fine, `PlaybackSession`/`PlaybackOptions` all look correct), the
`<video>` element never starts receiving data. `video.readyState` stays `0`
(`HAVE_NOTHING`), `video.networkState` stays `2` (`NETWORK_LOADING`),
`video.buffered` stays empty, `video.error` stays `null` — forever (watched
up to ~4 minutes with zero change, no recovery, no error, no timeout). Only
one `media-stalled` DOM event ever fires (~3.2s after `loadstart`, every
single time); nothing after that.

**What's been ruled out, with live evidence:**
- **Not the server.** While a session was live and stuck, a server-side
  session on the `macha` (server) repo checked `gbni-1` directly: all
  process threads idle/parked on normal things, 0 active/queued extent
  work, 0 pending RPC bytes, every TCP connection on port 7438 healthy
  (bytes_sent == bytes_acked, no stale Recv-Q/Send-Q), journalctl clean for
  the whole window. Nothing server-side is waiting on this stream at all.
- **Not a slow/wedged connection either.** With the video element still
  stuck, a plain `fetch()` (with the same `Range` header) issued from the
  *same page, at that exact moment* to the *exact same URL* the video is
  stuck loading returns instantly (single-digit ms, correct `206`/
  `Content-Range`, correct bytes) — repeatable every single time this was
  tried, both against the read-ahead proxy URL and the raw cross-origin
  node URL. So the network path, CORS, and the node are all fine *for a
  fresh request* at the same instant the video's own request is dead.
- **Not the read-ahead Service Worker
  (`public/macha-direct-play-sw.js`).** Temporarily instrumented the SW's
  `fetch` handler (`handleProxy`) and its outbound `fetch()` call to
  `postMessage` the page the instant either one runs; confirmed the
  instrumentation itself works (a manual `fetch()` to the same proxy URL
  triggered it immediately). Reproduced the hang with the instrumentation
  live: **zero messages, ever** — the SW's fetch handler is never entered
  for the video element's own request. (Instrumentation has been fully
  removed; `git diff` on that file is clean.)
  - Also bypassed the SW entirely (unregistered it, blocked
    re-registration, pointed `video.src` straight at the raw
    cross-origin node URL) — identical hang. So it isn't the proxy layer
    either.
- **Not the redundant `video.load()` I initially blamed and fixed.**
  `WebPlatform.ts`'s reused-`<video>`-element reset used to do
  `video.pause(); video.removeAttribute('src'); video.load();`
  immediately before reassigning a new `src` in the same synchronous
  tick — a real, provable double-invocation of the media element load
  algorithm (see the regression test in `WebPlatform.test.ts`, which fails
  on the old code and passes on the fix). **This fix is real, safe, and
  kept** (removing genuine redundant work is correct regardless), but
  retesting live after shipping it reproduced the identical hang — so it
  was not the actual cause of tonight's bug. Flagging this clearly so a
  fresh session doesn't waste time re-deriving it, or wrongly trust that
  it's "the fix."

**Net effect:** every layer that can be instrumented from JS or from the
server says "no request ever arrived here." That was read as "this must be
an unfixable Chromium media-engine bug" — the user (rightly) doubts that
conclusion. Logging this instead of asserting it, so a fresh investigation
can either confirm it properly or find what was missed.

**Reinvestigated 2026-09-05, later the same day — found the actual
confound, "Chromium engine bug" conclusion retracted.** Reproducing live via
browser automation (this project's Claude-in-Chrome tooling) hit the exact
symptom above instantly, on the very first `play()` in a brand-new tab, with
two more independently-created `<video>` elements pointed at the identical
stuck URL *also* hanging at readyState 0 in the same tab — and
`performance.getEntriesByType('resource')` showed **zero entries** for the
URL on any of the three elements, meaning Chromium's renderer never
dispatched the request at the network layer at all (not queued, not
stalled — never attempted). That pointed away from connection exhaustion and
toward something suppressing the media pipeline itself. Checking
`document.visibilityState` mid-hang found it stuck at `"hidden"` **while
`document.hasFocus()` reported `true`** — the automated Chrome window was not
actually composited on-screen (confirmed with the user: it was occluded).
Screenshots still rendered throughout because the automation's screenshot
capture forces a render via CDP regardless of page visibility, masking the
occlusion completely from the tooling used to observe the bug.

Once the user brought the real window to the foreground and kept it focused,
the identical title/environment (`gbni-1`, Direct Play, same movie) played
cleanly through 5 back-to-back play/stop cycles in the same tab — readyState
4 every time, no hang, no error, one cycle run continuously past 280s. This
means the specific "zero bytes ever requested" symptom is fully consistent
with ordinary, well-documented Chromium background/occluded-tab throttling
of media resource loading, not an engine bug — and it's now the leading
explanation for the original conclusion too, since that investigation also
leaned on this same automation tooling (a manual `fetch()` from "the page,"
unregistering the SW, reading `video` state) to probe the hang, which would
have silently occluded the tab the same way. **Caveat, not fully closed:**
the original bug was witnessed directly by the user actively watching for up
to 4 minutes, not through automation, so tab occlusion alone doesn't
explain a human-witnessed hang unless something else (a second focused
window, e.g. DevTools undocked to another display) occluded the video tab
without the user noticing. Only 5 cycles were stress-tested today, not the
"dozens across an evening" from the original report, so the per-origin
connection-exhaustion lead below is weakened but not eliminated — it just
needs a real multi-attempt session with visibility explicitly confirmed
before trusting any future "stuck" observation.

**Process note for future investigation of any "stuck"/"never loads" symptom
via browser automation:** always check `document.visibilityState` (not just
`document.hasFocus()`) before trusting the observation, and keep the actual
window foregrounded for the duration of the test. This session's tooling
will happily keep taking convincing screenshots of a tab Chromium itself has
backgrounded.

**Leads NOT yet tried — most promising first:**
- **Per-origin connection exhaustion, accumulated across the evening's many
  repeated play attempts in the same long-lived Chrome process.** Chrome
  caps concurrent connections per origin (historically ~6 for HTTP/1.1;
  this node is plain `http://`, not `https://`). The *only* successful
  attempt tonight was the very first one of the session, before dozens of
  subsequent play()/reload cycles in the same browser profile; every
  attempt after that hung. If earlier aborted/superseded video sources,
  service-worker prefetch fetches, or health-probe connections to
  `10.44.1.50:7438` aren't fully closing, later requests to that same
  origin could sit queued behind a maxed-out connection pool — which would
  look *exactly* like this (readyState 0 forever, no error, a fresh
  `fetch()` from a **different** connection slot still succeeding). Not
  fully re-tested: only 5 quick play/stop cycles were run in the 2026-09-05
  reinvestigation above (all clean, visible tab) — dozens across a real
  evening session, matching the original report, still hasn't been
  reproduced cleanly. Note: `chrome://net-internals` cannot be reached via
  this project's browser-automation tooling at all (Chrome extensions are
  hard-blocked from navigating/scripting `chrome://` pages) — that check
  needs the user to open it manually, not automation.
- **Tried 2026-09-05: a brand-new `<video>` element per `play()` instead of
  reusing one.** Result was a wash, not a confirmation — under the tab
  occlusion confound above, two independently-created fresh elements hung
  identically to the original reused one; once the tab was genuinely
  visible, the existing reused-element code played cleanly across 5 cycles.
  So element reuse is now a weaker suspect than it looked: fresh and reused
  elements behaved identically in both the broken and healthy conditions.
  Not fully closed either way — no long-running (dozens-of-cycles) session
  has compared fresh-vs-reused elements side by side yet.
- **Never opened the real Chrome DevTools Network panel** (as opposed to
  the Resource Timing API / this session's network-request tool, both of
  which only ever record *completed* transfers and so cannot distinguish
  "never sent" from "sent, still pending" — this was a real blind spot in
  tonight's investigation, not a settled fact). The Network panel shows
  pending/stalled requests live, including Chrome's own stall reason
  (queueing, stalled, DNS, etc.), which would immediately confirm or kill
  the connection-exhaustion theory above.
- Not tried: reproducing with `video.crossOrigin` unset entirely (only
  ever tested with it left at `'anonymous'`, inherited from the pooled
  element).
- Not tried: a genuinely fresh, unbounded wait (>4 minutes) to see if it
  *ever* self-clears without intervention, versus truly hanging forever.

Do not re-do the ruled-out checks above without new evidence prompting it —
the point of this entry is to skip straight to the untested leads.

## P0 — Any-node client and seamless playback failover

Detailed plan, phase-by-phase status, and dated live-verification evidence:
[the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md).
Phases 0–5 are implemented and live-verified against a real 3-node cluster
(repeated `systemctl stop`/`start` against real nodes, not synthetic
failures). Remaining work, in priority order:

- [ ] **Finish Phase 6 UAT.** Direct Play range-transfer failure is verified
  (silent mid-stream swap, no video reload, confirmed live with zero
  measured stall). Not yet exercised: HLS failure, and failure specifically
  during session POST, manifest transfer, pause, seek and option-change.
  Also still open: prove the client never navigates away, loses its
  queue/preferences, creates an unbounded retry/session loop, or waits on
  old-node cleanup during any of the above.
- [ ] **Blocked on the server, no client action available:** a node that
  becomes the failover target must actually be able to read the extent it's
  handed — the 2026-09-01 UAT hit a real `open media: Input/output error`
  on the alternate node. Sent to the server session 2026-09-04; awaiting a
  response. Client-side failover correctness can't fully prove out until
  this is fixed, since a "successful" failover to a node that can't read
  the data isn't actually successful.
- [ ] **Root-cause the hard-reactivation seek failure.** A full session
  reactivation (reload) at a non-zero position can fail instantly
  (`NotSupportedError`, zero bytes ever requested) even though the
  underlying byte range is confirmed valid and fully readable (verified via
  direct `curl` range requests against the exact node and offset). Leading
  hypothesis: an MP4/MKV container cannot begin decode from an arbitrary
  byte offset without a keyframe-aligned, container-aware start, and the
  hard-reactivation path may be attempting exactly that. This blocks the
  remaining Phase 6 boundaries above (pause/seek/option-change all force a
  real reactivation).
- [ ] **`fail()`'s reactive path has the same shape of race `degrade()` had.**
  `degrade()` now correctly ignores playback errors while a seek-driven
  generation replacement (`this.activeMutation?.reason === 'seek'`) is
  already in flight (fixed 2026-09-05, live A/V-desync report — see the plan
  doc, Phase 5). `fail()` was deliberately left unguarded: the same
  short-circuit there would risk silently swallowing a genuinely unrelated
  fatal error during a seek, with neither recovery nor failure UI. Needs a
  real design (e.g. wait for the in-flight mutation to settle before
  treating a fatal error as fresh), not a copy of the `degrade()` fix.
- [ ] **No bounded per-request timeout anywhere in the cluster status/
  catalogue/routing fetch layer.** Every `AbortSignal` in that layer is
  caller-supplied for unmount cancellation only, never a timeout. Caught
  live: a single already-known-good endpoint took 19.7s on one request,
  serialized behind nothing, blocking unrelated work. Add a real
  `AbortController`-based timeout to every fetch in this layer.
- [ ] **Endpoint registry has no memory across a reload.** Runtime-discovered
  cluster membership (`discoverClusterEndpoints()`) lives only in memory; a
  page reload reseeds purely from the single original bootstrap URL in
  localStorage. If the client already failed over away from that node
  because it went down, a reload while it's still down has no way back in.
  Persist a small, bounded set of endpoints actually confirmed working
  (not unbounded discovery history), treated as `bootstrap`/`environment`
  source so it survives `applyAdvertisement()`'s replace-on-refresh.
- [ ] **Phase 3 compatibility-path rationalisation** — explicitly deferred,
  not actionable yet: blocked on a minimum-supported-node-capability
  guarantee (immutable media profiles) that does not exist yet.

## P1 — Samsung deployment verification

- [ ] Complete interactive UAT of the build installed on `10.44.1.183`:
  confirm application boot, catalogue refresh, D-pad navigation and playback
  controls on the Tizen 3 TV.

## P1 — Android hardware back button, device/emulator verification

The mini-player-removal work (see `COMPLETED.md`) added a JS↔native bridge
so Android's hardware back button closes the player instead of silently
leaving it running off-screen: `MainActivity.onBackPressed()` now calls
`window.__machaHandleBack()` via `evaluateJavascript` before falling back to
`WebView.goBack()`/`finish()`. This was verified by reading the native
source and reasoning through the call sequence, and the JS side was
live-verified on Samsung (same `onStop()` code path) — but **never run on
real Android hardware or an emulator**, since none was available in this
session. `AndroidWebPlatform`'s dev-in-browser Escape/Backspace path was
exercised live and works; the actual native bridge call was not.

- [ ] Build and install on an Android device or emulator (`npm run
  build-android`) and confirm: pressing the hardware/on-screen back button
  while the full player is showing closes playback and returns to the
  previous screen (no silent mini-player-via-WebView-history-pop, no
  restart-from-zero), and that back navigation on every other screen is
  completely unaffected (the hook is absent outside the player, so
  `MainActivity` should fall through to its original behavior there).

## P2 — TV spatial navigation redesign

Deliberately not urgent: a previous incremental attempt (row/group focus
replacement) made things worse. Needs proper groundwork before another
attempt, not a faster one.

- [ ] Rethink Samsung and Android D-pad focus navigation from first principles;
  the current geometry scorer remains unintuitive. Do not make another
  incremental scoring adjustment without first defining and reviewing
  expected focus paths for the primary navigation, secondary navigation,
  media grids/rails, detail actions, management forms/modals and the player.
- [ ] Build a route-by-route focus-path fixture suite from those expectations,
  including uneven card layouts, overlays, scrolling, modal containment,
  remembered/default focus, text inputs and the seek bar. Validate the
  proposed model on both Samsung and Android hardware before adopting it
  globally.

## P2 — Catalogue dates

Blocked on the server; no client action is available until the wire contract
exists.

- [ ] Add a full optional release or air date to the Macha catalogue wire model
  and persist it from metadata providers. For TMDB, populate movie
  `release_date`, series `first_air_date`, season `air_date` and episode
  `air_date`. (Server-side; tracked here only because the client is waiting
  on it.)
- [ ] Update the client wire mapping after the server contract exists. The
  client already has an optional `releaseDate` field and displays a neutral
  placeholder until the server supplies it; do not introduce a provisional
  wire field beforehand.

## P2 — Native platform players

Real, substantial feature work with no active bugs behind it — sequence
after the P0/P1 items above, not before.

- [ ] Implement an Android Media3 platform host against the existing player
  boundary while preserving `PlaybackRuntime` ownership and state-machine
  semantics.
- [ ] Implement a Samsung Tizen AVPlay platform host against the same boundary.
  Until then, retain the shared HTML5/Web player and conservative Tizen 3
  capability profile used by the current Samsung package.
