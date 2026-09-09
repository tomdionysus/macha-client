# Active tasks and concepts to explore

Last updated: 2026-09-08

This is the working backlog for the current session. Add new work here. When an
item is implemented and its stated verification is complete, remove it from
this file and add a dated entry with evidence to `COMPLETED.md`.

The existing documents in this directory remain the detailed plans,
checkpoints, and verification records. This file is only the current index.

Scope: this file (and this repo) is macha-client only — the UI/playback
client. Server-side backlogs (e.g. `macha`'s own `TODO/ACTIVE.md`) are a
different repo's concern and are not tracked or duplicated here, even when a
client bug and a server bug are related.

**The test cluster is deliberately not uniform.** `gbni-1` (`10.44.1.50`) is
wired, `gbni-2` (`10.44.1.51`) is on **wireless** (a knowingly flaky link),
and `es-1` (`10.34.1.50`) is a remote site across the internet. This is the
point — the client is developed in the conditions it must actually survive.
So: never read a cross-node measurement as if the nodes were equivalent, and
never call a slow or stalled result on `gbni-2`/`es-1` a client bug until the
same test has been run against wired `gbni-1`.

Equally, do not reach for the topology to explain every odd number. On
2026-09-07 the server's `peer_latency_ms` looked badly asymmetric
(gbni-1→gbni-2 114 ms against gbni-2→gbni-1 4 ms) and the tidy explanation —
every path *toward* the wireless node slow, wifi power-save buffering inbound
frames — was wrong. The metric was sampling every control call, counting
payload and handler time as network distance. Sampling heartbeat pings only,
the same pair measured 2 ms and 5 ms and es-1→gbni-2 went from 207 ms to
62 ms. Check how a metric is sampled before explaining its shape with the
wiring.

Priority reflects active-breakage/user-impact, not effort: P0 is a live or
recently-live correctness problem in playback itself; P1 is important,
scoped, and actionable now; P2 is real but either blocked on something
outside this repo or needs groundwork before it can be started safely.

## P1 — `matroska` is missing from this client's advertised containers

`WebMediaCapabilities.ts` advertises `mp4`, `webm`, `mp3`, `flac` and `ogg`.
There is no `matroska` probe, so no .mkv can ever be cleared for direct play
on the web or on either television, and every Matroska file in the library is
remuxed or transcoded for devices that may well play it whole. It would look
like correct behaviour from every angle.

Measured 2026-09-08, and this is the reason it is written down rather than
wondered about: Chrome played a 2582×1080 HEVC Matroska **whole**, from a
`mode=direct` session — `readyState 4`, `currentTime` advancing, 1,149 video
frames decoded. The container is playable and the client says it is not.

- [ ] Probe it honestly on both hosts (`video/x-matroska`, and the codec
      strings inside it) rather than adding the string to the list. A
      capability states what the device does; asserting one to obtain a
      better instruction is the same mistake as excluding a codec to obtain a
      worse one, in the other direction.
- [ ] The audio is the catch, not the container: that direct session played
      silently, because the E-AC-3 inside it has no decoder in Chrome
      (`canPlayType` and `MediaSource.isTypeSupported` both refuse `ec-3` and
      `ac-3`). So direct play of .mkv is right only where every stream in it
      is playable, which is what the chooser already reasons about — it just
      needs to be told the truth about the container.

**Sized 2026-09-08 — this is 23% of the library, not a corner case.**
`scripts/playback-baseline.mjs` bucketed 748 items against gbni-1 with live
Chrome capabilities: **173 titles are remuxed for `container-not-playable`
with both streams already `copy`** (Aliens, Casino, 28 Years Later, …). Those
are exactly the ones that would become direct play if the container claim were
honest, since nothing else objects to them. A further 115 Matroska titles
would *stay* transformed regardless — they carry E-AC-3, TrueHD or DTS, which
Chrome cannot decode at all — so the honest claim wins 173 titles, not 288,
and the audio caveat above is what accounts for the difference. Re-run that
script after any capability change to re-measure rather than re-estimate.

## P1 — The MPEG-TS preference is asserted, not gated

Samsung HLS playback is fixed (see COMPLETED.md). The reporting half of this
is now closed: server 0.33.1 states `output.container`, `@macha/core` maps it,
and the player's top line shows the container actually served.

- [ ] **The preference is still not gated on a fact from the node serving
  it.** `copy_into_mpegts` exists on `operations` as of 0.33.1, and the
  chooser asks about whichever carriage the instruction names — but the facts
  are fetched from one node and the instruction may be performed by another.
  A cluster is not uniform in what its builds can do, and nothing checks that
  the node which answers can emit what the node which was asked said it could.

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

**2026-09-08: the symptom is now bounded, and did not reproduce.** The client
no longer waits forever on a source that never delivers — see the start
watchdog in `COMPLETED.md`, which fails the generation over to another node
and records whether the *browser* never dispatched or the *node* never
answered. That does not close this entry; it closes the unbounded wait.

Reproduction attempt, `document.visibilityState` confirmed `visible`
throughout (dev server, Chrome 151, gbni-1, The Boondock Saints, Direct Play,
DevTools docked in-window so it could not occlude): **15 consecutive clean
playbacks** — 12 of them play→stop→play inside one long-lived page, which is
the condition the connection-exhaustion lead requires. Zero hangs, zero
stalls, zero watchdog fires, time-to-first-frame flat at 1.3–2.4s with **no
upward trend**. With the 5 clean cycles of 2026-09-05 that is 20 confirmed-
visible attempts without a failure, against a failure history taken entirely
under unconfirmed (and probably occluded) conditions.

That weakens per-origin connection exhaustion considerably but does not kill
it: a flat first-frame time is what a healthy pool looks like, and the
original report spanned an evening with far more concurrent activity.

- **Connection exhaustion cannot be measured from JS — stop trying.**
  Confirmed this session: cross-origin Resource Timing to the node is opaque
  (no `Timing-Allow-Origin`, so `requestStart`/`connectStart` are zeroed), and
  the media bytes travel through the Service Worker, whose cross-origin
  fetches never appear in page Resource Timing at all. 63 requests to gbni-1
  were recorded with no usable timing on any of them. The DevTools Network
  panel really is the only route, and it is only informative *during* a hang —
  so it needs a reproduction first, not a watch.
- The next genuinely new evidence will most likely arrive on its own, from
  `source-start-starved`'s `dispatch` field, the next time a real viewer hits
  this. That is now a better instrument than another scripted evening.

## P0 — Any-node client and seamless playback failover

Detailed plan, phase-by-phase status, and dated live-verification evidence:
[the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md).
Phases 0–5 are implemented and live-verified against a real 3-node cluster
(repeated `systemctl stop`/`start` against real nodes, not synthetic
failures). Remaining work, in priority order:

- [ ] **Measure playback under live import load (requested 2026-09-07 by the
  Macha server session; no deadline, the import runs for days).** Needs a
  genuinely foregrounded Chrome window — see the occlusion confound in the
  P0 above; numbers from an occluded tab are worthless. Measure both a
  locally-written film (`/UAT/final/gbni-1/Jurassic.Park.1993...mp4`) and a
  remote-written one (`/UAT/final/es-1/Idiocracy 2006 ... BONE.mkv`, the one
  that matters — the es-1 WAN is saturated by the import, so this measures
  whether viewer traffic is prioritised over bulk import traffic). For each:
  (a) time to first frame, (b) 60 s of playback, stall-free or not, (c) a
  seek to the middle of the file and how long until it plays again. Expect
  the remote film to be worse; the useful answer is *how much*. Report
  numbers back to that session. See also the >90 s mid-file segment stall
  they measured server-side, under the hard-reactivation item below.
- [ ] **Finish Phase 6 UAT.** Direct Play range-transfer failure is verified
  (silent mid-stream swap, no video reload, confirmed live with zero
  measured stall). Not yet *live-exercised*: HLS failure, and failure
  specifically during session POST and manifest transfer.
  **Audited 2026-09-06** (automated-coverage check only, no live cluster
  available that session) for what each of these already proves or doesn't
  at the unit/integration level, ahead of the still-needed live UAT:
  - Session POST failure: well covered for Direct Play
    (`ClusterPlaybackResolver.test.ts`, `ClusterNodeFailover.test.ts`); added
    an equivalent HLS-mode (`remux`) test proving the candidate loop is
    genuinely mode-agnostic, not just implied.
  - Found and fixed a real bug while auditing this, unrelated to live UAT:
    `ClusterPlaybackResolver.resolve()` (the *initial* session POST) called
    `create()` without `attemptTimeoutMs` — unlike `failover()`/
    `prepareAlternate()`, which both pass it. A node that hung (accepted the
    connection, never responded) on the very first POST would hang playback
    forever with no failover, no error, nothing queued behind it to notice.
    Fixed: `resolve()` now passes `this.generationAttemptTimeoutMs` like its
    siblings. Regression test in `ClusterPlaybackResolver.test.ts`
    ("abandons a hung initial session POST...") confirmed to fail (real
    5-second timeout) against the pre-fix code.
  - HLS failure (mid-stream): already has full-stack coverage
    (`ClusterNodeFailover.test.ts`, "prepares an HLS standby..."), but the
    trigger is synthetic (`player.degrade()`/`.fail()` calls), not a real
    hls.js manifest/segment failure flowing through `WebPlayer`. Checked
    `WebHlsPolicy.ts`'s error classification specifically: it branches only
    on `data.type` (`NETWORK_ERROR`/`MEDIA_ERROR`), never on `data.details`
    — so a manifest-load error is already provably classified identically
    to the already-tested `fragLoadError` case; no test gap there. Proving
    a *real* hls.js manifest fetch failure end-to-end would need a heavier
    fixture (real `hls.js` against jsdom) — not attempted; the existing
    synthetic-trigger integration test plus the type-based policy unit
    tests are judged adequate until/unless that's shown insufficient.
  - Pause: confirmed not applicable. `PlaybackCoordinator.setPaused()` is
    purely local (`player.pause()`/`.resume()`) — no resolver call exists,
    so there is nothing server-side that could fail. Removed from this list.
  - **Seek and option-change: NOT just untested — a real, undesigned gap.**
    `PlaybackCoordinator.drainMutations()`'s catch block (handling every
    seek/representation/subtitle PATCH failure from `resolver.update()`)
    only does `patchSnapshot({ notice: ... })`; it never calls `this.fail()`.
    Failover-on-error only exists on the *player's* failure/degradation
    channel, not on a failed PATCH itself. So today, a seek or option-change
    that fails because the owning node just died gets a client-side notice
    and otherwise silently does nothing — no retry, no failover, no
    recreation on another node — until/unless the player *also* independently
    notices the stream died. **Deferred deliberately (2026-09-06): revisit
    with the live cluster**, since judging the real UX cost needs to be seen
    rather than reasoned about. Analysis done so far, so it need not be
    re-derived:
    - Severity is lower while *playing* — the dead node kills the stream too,
      so the player's own failure channel eventually triggers failover
      anyway; the cost is latency plus a confusing "my seek did nothing".
      While *paused* it is a genuine dead end: nothing is loading, so no
      player error will ever arrive, and the seek is simply lost.
    - The naive implementation is actively dangerous. `ClusterPlaybackResolver
      .update()` wraps every failure via `endpointFailure()`, and
      `retryableEndpointFailure()` returns true for *any* `MachaEndpointError`
      — so gating on the wrapper treats a 400/422 "server rejected this
      request" as node-loss evidence, and would burn through every candidate
      node before landing on a fatal error screen. Strictly worse than the
      current notice.
    - A correct discrimination does exist: the raw error survives as
      `MachaEndpointError.cause` with its HTTP status intact, and
      `retryableEndpointFailure(cause)` classifies correctly (TypeError/5xx/
      429 → true; 400/404/422 → false). The open design question is layering:
      `PlaybackCoordinator` is deliberately cluster-agnostic and does not
      import the cluster error types, so this needs either a small
      classification hook on the `PlaybackResolver` interface or the resolver
      tagging the error — plus a decision on how it interacts with the
      fail()/seek-race deferral (see `COMPLETED.md`, 2026-09-06).
    - **Fixed separately, no design decision needed:** the same failure path
      used to leave `seek()`'s optimistic target pinned forever (see
      `COMPLETED.md`). That was the user-visible half of this gap and is done;
      what remains here is purely the failover-policy question.
  Also still open (needs the live cluster, not addressable by more unit
  tests): prove the client never navigates away, loses its queue/
  preferences, creates an unbounded retry/session loop, or waits on
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
  **A candidate raised and then disproved, 2026-09-08 — recorded so nobody
  re-raises it.** Transformed playlists are served as
  `#EXT-X-PLAYLIST-TYPE:EVENT` with no `#EXT-X-ENDLIST` (verified off the wire
  on 0.36.0, remux and transcode alike), so `video.duration` and
  `video.seekable` only ever reach the generated frontier — Clerks' element
  read 8.05 s for a 92-minute film. That was reported as the cause of this
  entry and **it is not**. Two live checks killed it:
  - The scrubber does not use `video.duration`. `PlaybackCoordinator` prefers
    `session.durationMs` (`durationMs: session?.durationMs || next.durationMs`),
    and the UI for that same Clerks session correctly showed **1:31:46** with
    the scrubber max at 5,506,272 ms.
  - A seek past the frontier works. Driven with real key input on a live
    transcode buffered to 426 s with the frontier at 462 s: presses inside
    coverage logged `seek-local`, presses beyond it logged
    `seek-needs-generation`, coalesced into **one** `session-update` PATCH, and
    `generation-update-ready` → `source-activate` had it playing again at
    10:38 after 7,275 ms.
  So the client already implements the server's stated contract (timeline from
  the session, `PATCH seek_ms` for anything past the frontier), and the
  EVENT playlist is a deliberate 0.32.14 fix for the 98 s black screen this
  project itself measured — proposing a VOD list was proposing to revert it.
  Also disproved on the way: `localSeekCoverage()` does **not** over-report for
  transformed playback; it returns buffered ranges, which is honest.
  Still open and genuinely unexplained: the `levelLoadError` below.
  **Possible server-side component, 2026-09-07 — do not assume this is
  purely a client bug before checking.** The Macha server session probing
  `/api/v1/playback/sessions` on gbni-2 during the live import measured
  transcode-mode segments generating at ~0.7 MB/s and **a mid-file segment
  request that did not return within 90 s**, for both a locally-written and
  a remote-written film. That is the same shape as this symptom (a seek to a
  non-zero position that never produces bytes) arriving from the other side
  of the wire, so the container/keyframe hypothesis above is no longer the
  only candidate. Their probe was transcode mode; whether the real player's
  direct/remux path (HEVC-capable client) hits the same wall is exactly what
  the import-load playback UAT (first bullet of this section) should settle.
  Measure that before spending more time on the client-side hypothesis.
- [ ] **Phase 3 compatibility-path rationalisation** — explicitly deferred,
  not actionable yet: blocked on a minimum-supported-node-capability
  guarantee (immutable media profiles) that does not exist yet.

## P1 — Surface server self-healing state (server 0.30.0–0.32.0)

Requested 2026-09-06 by the Macha server session across three messages
(disciplines 2–4 of its self-healing programme), rolling out gbni-1 →
gbni-2 → es-1. Three related pieces of server state the client cannot show
at all today; they share one prerequisite (the client does not read
`diagnostics` from `/api/v1/status` anywhere yet), so do that once and hang
all three off it rather than three times.

Docs: `docs/management.md` "Parked publications" / "Metadata conflicts",
`docs/configuration.md` "Retry budgets and parking", `docs/metadata.md`
"What a snapshot carries, and what leaves it".

### Prerequisite — model `diagnostics` in `ClusterStatusApi`

- [ ] Add `diagnostics.filesystem` and `diagnostics.metadata` to the
  `/api/v1/status` model and surface them on `StatusScreen`. Every field is
  optional: a mixed-version cluster will have nodes below 0.30.0, and the
  counters arrived across three separate server versions.
  - `filesystem` (0.30.0): `parked_publications` (standing count — warn
    badge when > 0, linking to the list), `publication_retries_backed_off`
    (cumulative, informational).
  - `filesystem` (0.31.0), all cumulative and informational — non-zero means
    "read the WARN lines from the last boot", not an outage:
    `journal_recovery_skipped_frames`,
    `journal_recovery_quarantined_bytes`, `recovery_dropped_operations`,
    `publications_abandoned`.
  - `filesystem` (0.32.6): `mountpoint_immutable` (bool — the host
    directory under the mount is immutable; expected `true` on every node
    after that deploy) and `mountpoint_stray_entries` (int — files found on
    the host disk *under* the mount path at startup; expected `0`).
    **`mountpoint_stray_entries > 0` gets a red badge and makes the node
    unhealthy in whatever health summary we show**, not merely a counter:
    those files are hidden by the mount and are not in Macha at all. This
    exists because an rsync starting 25 s after a daemon restart, before the
    mount came up, wrote 52 GB into es-1's host root disk (finding #7 of the
    import). Show both next to `parked_publications` in the node view.
  - `rpc_transport` (0.32.7, not deployed yet): `peer_latency_ms` — node id
    to smoothed control round trip in ms, the measure commits use to pick
    the nearest replica.
  - `metadata` (0.32.7, not deployed yet): `mutations`,
    `mutation_retention_ms_total`, `mutation_retention_ms_max`,
    `mutation_publish_ms_total`, `mutation_publish_ms_max`. Show retention
    and publish *averages* (total ÷ `mutations`) next to the max, not the
    raw totals — a running total is unreadable on its own.
  - `metadata` (0.32.0): `conflicts` (standing total — badge when > 0,
    linking to the list), `namespace_conflicts`, `catalogue_conflicts`,
    `tombstones` (retirement tombstones in the snapshot), and the
    process-lifetime counters `conflicts_superseded`, `conflicts_resolved`.
    Label those last two **"since process start"** — they reset on every
    restart, so a `0` is indistinguishable from "never ran" (confirmed with
    the server session 2026-09-07; a persisted cluster-wide total is coming
    in a later API change, at which point this label can go).

Two presentation rules the server session asked for specifically, both
derived from a real fault found during the 2026-09-07 import UAT below:

- **Publication progress is `completed` vs `started`, and flat is a
  warning.** `data_publications_started` rising while
  `data_publications_completed` stays flat for minutes *and* spool bytes are
  not falling is a stall, not slow progress. That exact pattern (114 started
  / 0 completed on gbni-1) turned out to be every publication thread parked
  behind a one-op-per-commit namespace queue. Worth a warning, not just a
  number.
- **`retained_memory.owners.publication` is the saturation signal on a
  small node.** On gbni-1 (4 GB) it sitting near ~500 MB means the importer
  is saturating retained memory and writes are being held back — 0.32.1
  makes them wait rather than fail, so nothing else surfaces it. Watch
  `shed_requests`, `cancelled_waits` and the `waits` counters alongside it.

### Parked publications (0.30.0, commit `bb3697c`)

A FUSE
write whose publication keeps failing transiently is now retried with
per-inode exponential backoff and then *parked*: the bytes stay in the
spool/journal and it leaves the loader queue so everything else keeps
publishing, but an operator must retry or abandon it. Parked data is
invisible until someone reads the server docs.

Wire contract (existing authenticated `/api/v1/manage` prefix):
- `GET /api/v1/manage/filesystem/parked-publications` →
  `{ parked: [{ inode: u64, path, error_code: int, error_message, attempts:
  u64, failing_for_ms, parked_for_ms, pending_bytes }] }`; empty array when
  nothing is parked.
- `POST .../parked-publications/{inode}/retry` — resets the retry budget and
  re-queues. 204 / 404 (not parked) / 400 (non-integer inode) / 405.
- `POST .../parked-publications/{inode}/abandon` — **destructive**, discards
  the unpublished generation from the spool. Same status codes. Must sit
  behind an explicit confirmation step.
- Existing `namespace_blocked_op` can now carry `error_code` `EAGAIN` /
  "retry budget exhausted" — that keeps retrying at ceiling backoff, so
  present it as "stuck, still retrying", not a hard failure.

- [ ] Add the three management calls to `ManageApi`/`MachaManageApi` (+
  `ClusterManageApi` passthrough) and a parked-publications view. Reuse the
  unmatched-files pattern rather than duplicating it: `IngestScreen` already
  does list → per-row retry → destructive delete against
  `/api/v1/manage/unmatched`, which is the same shape.

### Metadata conflicts (0.32.0)

Two concurrent writers publishing duplicate media paths left 116 standing
conflicts in the production namespace that nobody could see. 0.32.0 prunes
the ones a later write already decided and exposes the rest.

- `GET /api/v1/manage/metadata/conflicts` → `{ generation: u64, conflicts:
  [{ id: sha256 hex, kind: "namespace_entry" | "catalogue_root", key (path,
  or `"catalogue_root"`), left_head: hex, right_head: hex, base, left,
  right }] }`. For `namespace_entry`, `base`/`left`/`right` are
  `{ type: "file" | "directory", size: u64, mtime_ns: u64, version: u64,
  extents: u64 }` or `null` (absent on that side); for `catalogue_root`
  they are object-id strings or `null`. `503 metadata_unavailable` while the
  node has no snapshot yet — a normal transient state, not an error screen.
- `POST /api/v1/manage/metadata/conflicts/{id}/resolve?choice=left|right|base`
  — installs that alternative and drops the conflict in one metadata commit.
  204 / `409 not_standing` (superseded by a later write, or already
  resolved) / `400 bad_choice` / 405.

- [ ] Conflict list + side-by-side resolution view: show both alternatives
  (size / mtime / extent count) before the operator picks, and label `base`
  as "restore the common-ancestor value". A `409 not_standing` is expected
  in normal use (the server resolved it first) — refresh the list and say
  so, don't present it as a failure.
- [ ] Verify live once each version is deployed (gbni-1 first).

## P1 — An https deployment against http nodes breaks Direct Play entirely

Not observed, derived from the mechanism 2026-09-09, and recorded because it
is invisible in development and total in production.

The read-ahead worker gates on `window.isSecureContext`. Today the dev client
is `http://localhost:5173`: localhost *is* a secure context, so the worker
registers — and the page is not https, so the worker fetching
`http://10.44.1.50:7438` is not mixed content and goes through. Both halves
happen to line up.

Serve the same build over **https** against **http** nodes and they come
apart. The worker still registers, but every fetch it makes is now active
mixed content from a secure context and is blocked by the browser. And this
does not merely cost the seamless failover: `directPlayReadAheadUrl()` has
already put the proxy URL in `video.src`, so the element is pointed at a
worker that can no longer fetch anything. **Direct Play breaks outright**, on
453 of 748 titles, with no code change and nothing in the logs to explain it.

- [ ] Decide the behaviour deliberately rather than discovering it. The cheap
      guard is to treat "page is https and the node is http" as read-ahead
      being unavailable — the same fall-back-to-the-native-URL path that
      already exists when no Service Worker is present, which is correct and
      already tested. Losing read-ahead there is a real cost; breaking Direct
      Play is not a cost, it is an outage.
- [ ] The real fix is TLS on the nodes, which is already in motion — haproxy
      is installed on es-1 for TLS offload, and the server replaced
      `api_host`/`api_port` with a scheme-carrying `api_endpoint` partly for
      this reason. Until then the guard above is what keeps an https
      deployment working at all.
- [ ] Same constraint governs whether the seamless path could ever work in an
      Android WebView: it needs a secure origin *and* https nodes, so it is
      blocked on the same thing.

## P0 — A ready standby is discarded 33 s before it is used

Measured live 2026-09-08, web client, remux/HLS generation on gbni-2, node
stopped mid-playback:

```
397973  source-degraded (fragLoadError)
398240  alternate-ready -> gbni-1          <- rescue ready 267 ms in
428241  alternate-recovery-window-expired  <- thrown away, unused
461395  source-terminal-failure
461548  source-failover-ready -> gbni-1    <- the same work, done again
```

**63.6 s of black screen where the replacement was ready in 267 ms.**

Two budgets chosen independently, each defensible, whose product is a rescue
that always goes stale. `ALTERNATE_RECOVERY_WINDOW_MS` holds a standby for
**30 s**. hls.js's `errorRetry` is 6 attempts backing off 1/2/4/8/8/8 —
about 31 s — and `managedHlsErrorAction` permits one `restart-network` per
generation, which resets that budget, so the primary cannot go fatal for
~63 s. `recoverFromSourceFailure` only runs on fatal. The window therefore
expires before anything can ask for it, every time.

A longer window is the wrong fix: it would make the rescue survive, but the
viewer still waits for the fatal. Once an alternate is ready *and* the primary
is still producing degradation evidence, there is nothing left to wait for —
retrying a node already replaced is the whole 63 seconds.

- [x] **`PlaybackCoordinator` is `@macha/core`'s.** Raised with that session
      2026-09-08 with the trace, framed as: should continued degradation with a
      ready alternate promote it, rather than only terminal failure doing so?
      `prepareAlternate` already validates and preflights the alternate, so the
      thing promoted is known good; the guard needed is the one `degrade()` and
      `fail()` already use against an in-flight seek mutation. Landed in
      `@macha/core` 0.6.1 as `promoteReadyAlternate`.
- [ ] Re-measure after it lands. The bar is set by the path that works: the
      silent Direct Play swap failed over in **17 ms** on the same cluster and
      title, uninterrupted (`alternate-promoted-silently`).

**Why this is P0 rather than a latency complaint:** the Samsung has no Service
Worker and now `neverDirect`, so it can *only* take this path. Two live
attempts to stop a node mid-film gave a long black screen and then an error,
ending in "No untried Macha playback endpoint remains" with three healthy
nodes. Not yet proven to be this same defect — `failedGenerationEndpoints` is
cumulative across a generation lineage, so anything failing three replacements
in a row exhausts the cluster regardless of cause — but the shapes match.

Ruled out on the way, so nobody re-checks them: session admission is not
refusing (all three nodes create sessions for one client token with another
already open, tested directly); and the stall watchdog arming on a source's
first report *was* a real bug of mine, killing freshly promoted generations
before they could deliver a frame — fixed, and the TV symptom survived the fix.

**Cause found 2026-09-09: failover asks for the wrong segment container.**

`container` is not among a session's confirmed preferences, and failover
rebuilds a generation from exactly those (`completePreferences` →
`currentPreferences`). So a Samsung set that asked for MPEG-TS was handed
**fMP4 by every replacement node** — the one carriage it cannot play. The PATCH
path already restated the container, with a comment naming this very failure
("a device handed fragmented MP4 where it asked for MPEG-TS shows a black
picture and reports nothing"); the create path never got it. That asymmetry is
the whole fault, and it is what the decisive observation was pointing at all
along: after the error, selecting Auto — a PATCH — **resumes instantly from the
same node that had just starved**.

- [x] `withRestatedSegmentContainer` in `@macha/core`, shared by the update
      path and `currentPreferences`, so failover and standby preparation ask
      for the carriage the generation was created with. Regression test
      confirmed to fail against the pre-fix code.

**Two earlier theories of mine, both wrong, kept so nobody re-raises them.**

*Segment holds.* The trail carries no `hls-native-first-fragment-held` line, so
no fragment was ever held: the nodes answered the readiness probe at once. The
gate below still earns its place as the elimination — it is how "the node is
not serving" was ruled out — but it fixed nothing.

*A wedged media element.* The measured trace read:

```
139.4  source-start-starved     10.44.1.51  readyState HAVE_NOTHING, no data in 20s
139.4  source-failover-start    -> 10.34.1.50
160.4  source-start-starved     10.34.1.50  readyState HAVE_NOTHING, no data in 20s
160.4  source-failover-exhausted / fatal
```

Zero bytes on a reused element looked like the element. It was the *carriage*:
a native player handed fMP4 it cannot decode fetches nothing and says nothing,
which is indistinguishable from a wedged element from the outside. Discarding
a failed element shipped on that theory and did **not** fix the fault — it is
still in `WebPlayer.play()`, gated on failure so the seek path is untouched,
but it is unproven and should come out unless something turns up to justify it.

**Superseded — the media-element theory, for the record.**
Measured on the set with the failure trail now shown on the failure screen:

```
139.4  source-start-starved     10.44.1.51  readyState HAVE_NOTHING, no data in 20s
139.4  source-failover-start    -> 10.34.1.50
143.6  media-stalled            readyState HAVE_NOTHING
160.4  source-start-starved     10.34.1.50  readyState HAVE_NOTHING, no data in 20s
160.4  source-failover-exhausted / fatal
```

Both replacements were attached to the **reused** `<video>` element and sat at
`HAVE_NOTHING` for the full 20 s starvation budget without fetching a byte —
while a plain `fetch` of each generation's own first fragment, issued moments
earlier by the readiness gate below, was served immediately. The nodes were
serving; the element was wedged, and each starvation was charged to a healthy
node until the candidate list was empty. Reuse has always worked for a seek,
where nothing failed first; it does not survive a generation that failed.

- [x] `WebPlayer.play()` discards a media element whose previous generation
      failed, rather than reusing it. Gated on failure specifically, so the
      seek path — the case reuse exists for — is untouched.

**The segment-hold theory below was wrong, and is kept because the work it
produced is still right.** The trail carries no `hls-native-first-fragment-held`
line, so no fragment was ever held: the nodes answered the readiness probe at
once. What the gate bought was the elimination — it is how "the node is not
serving" was ruled out and the fault localised to the element.

**Superseded — the segment-hold theory, for the record.** A native HLS
player has no retry policy this client can reach. Failover creates a fresh
generation mid-file; the playlist is complete from the moment the plan exists
(the server moved its readiness gate off `media.m3u8` deliberately), so the
wait now lands on the *first fragment*, which the node holds and then answers
`500 segment_not_ready` with `Retry-After`. hls.js rides that out —
`isHlsSegmentHold` exists for exactly this — but the native player sees one
`MEDIA_ERR_NETWORK`, immediately and permanently. That reaches the coordinator
as `'stream'`, which is legitimate endpoint evidence, so a healthy node is
charged and the next one is tried; it cold-starts its own generation and
answers identically. Three of those and `failedGenerationEndpoints` covers the
cluster, which is why the message is *"No untried Macha playback endpoint
remains"* — that string is only produced when the candidate list is **empty**,
never when creates failed. It also explains the recovery Tom found: selecting
Auto PATCHes the session still alive on the last node, whose pipeline has been
producing for half a minute by then, so it plays at once.

- [x] `WebPlayer.play()` asks the node for one byte of the first fragment
      before handing the element a native-HLS URL, through the same admission
      and hold path the player itself would use: it waits while the node says
      it is producing (honouring `Retry-After`, 30 s budget = five server-side
      holds), and stops immediately on `503`/transport, which *is* node
      evidence. `awaitNativeHlsFirstFragment` in `WebPlatform.ts`.
- [x] The element is emptied before that wait, so a failure still arriving
      from the generation being replaced cannot be billed to its replacement.
      The native branch was the only one of the three doing neither this nor
      the direct path's documented refusal to.
- [x] `readFirstResponseBytes` no longer requires `response.body`. Chromium 47
      has `fetch` and not response streams, so **every warm standby the
      Samsung ever prepared failed its own preflight and was discarded** —
      the set least able to afford a cold failover was the one guaranteed
      never to have an alternate ready.
- [ ] Live-verify on the TV: stop the serving node mid-film with all three up.
      Expect one wait, not three failures. A wait that actually happened logs
      `hls-native-first-fragment-held` at `warn` with its duration and attempt
      count, so the Samsung build's `warn`-and-above buffer captures it
      without raising the level for the run.

## P1 — `levelLoadError` evicts a healthy node, with no server error behind it

Observed twice on 2026-09-08, unprompted, on **wired gbni-1** during a Clerks
transcode. Full sequence the first time:

```
10020  source-degraded          Web HLS network degradation (levelLoadError)
13057  hls-error-fatal          bounded network recovery starts
16102  source-terminal-failure  failed after bounded recovery (levelLoadError)
16107  source-failover-start    → promoted to es-1 (the WAN node)
```

The client's own behaviour is correct given the evidence it had. What is not
explained is the evidence.

- **The server returned no errors.** The Macha server session grepped gbni-1's
  journal for the whole day: zero `not_ready` (404), zero `stream_failed`
  (503); every `media.m3u8` request was answered, and it can see this session's
  playlist growing normally to 53 segments. Independently confirmed here by
  hooking XHR/fetch in the page: **every playlist poll captured returned 200.**
- **A timeout was proposed and disproved — do not re-raise it.** The first
  degradation fired at 10,020 ms against hls.js's default `levelLoadingTimeOut`
  of 10,000 ms, which looked conclusive. It is not: hls.js reports a expired
  deadline as `levelLoadTimeOut` and a genuine load failure as
  `levelLoadError`, two distinct `ErrorDetails` values (confirmed in the
  installed `hls.js/dist/hls.d.ts`, lines 1117–1118). Our log says
  **`levelLoadError`**, so the deadline did not expire. The 10 s coincidence is
  unexplained and may just be hls.js's internal retry schedule.
- So: an error that produced no HTTP status on either side. Most likely a
  transport-level failure that never became a response — a reset or a dropped
  connection — which neither the server's journal nor a captured `load` event
  would record.
- [ ] Capture the failing poll at the moment it fires. The XHR+fetch hook
  records `error`/`timeout`/`abort` as well as `load`, so an armed hook should
  catch it; it simply has not coincided with a failure yet. Log
  `data.details` and `data.response` from the hls.js error alongside it.
- [ ] Separately, weigh whether a `levelLoadError` should carry the same
  node-health weight as a segment failure at all. Since 0.32.14 the playlist is
  an EVENT list polled for the life of the session, so this evidence arrives
  hundreds of times per session where a VOD playlist produced it once. The
  server session has recorded the same trade-off on their side and neither
  wants to decide it unilaterally. `@macha/core`'s owner asked for a timeline
  from any failover off a node that was demonstrably fine — the one above is
  exactly that, and should be sent.

## P1 — The endpoint registry routes media to a node it has never measured

Found 2026-09-08 while chasing "the video is very choppy". The client had
settled on **gbni-2 — the deliberately flaky wireless node — for playback**,
and its own persisted throughput table explains why:

```
macha-client-bandwidth:<client>
  http://10.44.1.50:7438   3,312,869 B/s   (gbni-1, 2 samples)
  http://10.34.1.50:7438     315,489 B/s   (es-1,   1 sample)
  http://10.44.1.51:7438   — no entry at all —   (gbni-2)
```

`EndpointBandwidth` is fed from `readJsonBody()` in `httpCompat`, so it only
ever samples catalogue/manage/acquisition **JSON** transfers of ≥32 KB. Media
never feeds it: byte-range streaming and HLS segments go nowhere near that
path. gbni-2 arrives by runtime discovery and mostly serves media, so it
accumulates no sample — and `candidates()`, which consults throughput ahead of
configured order, has nothing to deprioritise it with. The node that carries
the most bytes is the one we measure least.

Measured cost, raw byte reads of a direct-play source, three different titles:

| node | read rate |
| --- | --- |
| gbni-1 (wired) | 3.31 MB/s (client's own estimate) |
| gbni-2 (wireless) | **0.31–0.58 MB/s** across Inglourious, Aliens and Jurassic Park |

Identical across titles, so it is the node and not extent placement. And it is
enough to explain the transcode throughput results directly: Inglourious
Basterds is 21.1 GB over 153 min, so realtime needs ~2.3 MB/s of source reads.
On gbni-2 that ceiling is ~0.55 MB/s, and the title measured **0.46×
realtime** there — while the same title on the same day reached 1.00× when it
landed on gbni-1. The "sub-realtime transcode" investigation was largely
measuring our own endpoint choice.

**The deeper half: only the node we already use can ever be measured.** Three
mechanisms compose into that, and each is individually reasonable:

1. `readJsonBody()` is the *only* feed into the recorder, so just the
   catalogue/manage/acquisition JSON paths sample anything at all.
2. `ClusterEndpointRouter` sends real work to the **preferred** endpoint. So
   those samples only ever accrue for one node.
3. The health monitor does contact every known endpoint every ~10 s — but with
   `GET /api/v1/catalogue/status`, a tiny body, far under the 32 KB floor. It
   calls `fetchWithTimeout` directly and never touches `readJsonBody`, so it
   cannot sample even in principle.

So the client talks to every node in the cluster six times a minute and learns
nothing about any of them except the one it is already using. And
`compareThroughput` needs *both* sides to have evidence, so the moment
authority moves the comparison goes silent exactly when it is needed to move
it back. `THROUGHPUT_MIN_SAMPLES = 2` also leaves es-1 unmeasured on 1 sample.
There is no good reason for the client not to hold two or more samples for
every node; the machinery to get them is already running on a bounded cadence.

**Do not fabricate traffic to measure the link — estimate better instead.** A
throughput probe against every node is speculative work competing with viewer
traffic, which `docs/principles-and-laws.md` forbids outright, and it is
self-defeating on the wireless node where the probe consumes the capacity it
is measuring. Restricting it to endpoints lacking evidence does not save it: a
cold client lacks evidence for all of them.

**The signal is already arriving.** `/api/v1/status` — which the client
already fetches — carries per-node telemetry for *every* node, and nothing in
endpoint selection reads any of it. Measured 2026-09-08 while the client was
routing playback to the worst node:

| node | `runtime.load1` | `runtime.process_cpu_percent` | freshness |
| --- | --- | --- | --- |
| gbni-1 (wired) | 1.01 | **25.2%** | live |
| gbni-2 (wireless) | 1.18 | **62.0%** | live |
| es-1 (WAN) | 2.67 | **104.5%** | live |

Load alone would have kept authority on gbni-1, for free. Also present and
unread: `storage.available` and free/used bytes, `cache` pressure (all three
nodes report the 4 GiB cache entirely full — `free_bytes: 0`), `phase`, `state`,
`live_age_ms`, `telemetry_freshness`, and `diagnostics.rpc_transport
.peer_latency_ms`.

**The one thing that telemetry cannot see is the link.** CPU and load describe
a node's capacity to *serve*; they say nothing about the path between this
client and it. gbni-2 is a healthy, lightly-loaded node behind a bad wireless
hop — no server-side metric would ever reveal that, and a naive
least-loaded estimator would be blind to exactly the case that caused this
entry. Client-measured latency is the complement: it is the only signal we
hold about the *path*, and we already collect it for every node.

**Owned by the `@macha/core` session as of 2026-09-08** — cluster routing is
their half of the boundary, and the change is theirs to make. Asked for:
capacity captured off the existing status fetch, ranking given more than one
axis, and an interface this client can read back (per-endpoint latency,
throughput with sample count, reported load, and **which axis actually
decided**). That last is the lesson of the day: the client could not say why
it was on gbni-2, so the answer had to be reverse-engineered from a
localStorage table and a comparator read.

Client-side work that remains here:

- [x] **Feed real media throughput into `EndpointBandwidth`** — done
      2026-09-08, see `COMPLETED.md`. Direct Play only (453 of 748 titles);
      HLS segments are fetched inside hls.js and remain out of reach.

- [ ] Surface it on **Status → Nodes** — per endpoint, latency, throughput
      estimate with sample count, reported load, and the deciding axis.
      Endpoint selection is currently the least legible thing in the client,
      and that screen exists precisely to make the cluster legible. Shares the
      `/api/v1/status` `diagnostics` prerequisite with the self-healing item
      below; do that modelling once.
- [ ] **Show `cpu_cores` per node on Status → Nodes** once the server sends it
      (asked of macha-a4 2026-09-08; blocked until then). Without it `load1`
      and `process_cpu_percent` are unreadable on a screen as well as
      uncomparable in code — 2.67 and 104.5% mean nothing to an operator who
      cannot see the machine size, and this cluster is deliberately non-uniform
      hardware. Show the raw figure beside the normalised one rather than
      replacing it: the raw value is what the node reported, and the
      normalisation is ours.

**Everything ranks. Operator's decision, 2026-09-08: "It's all ranking."**
One estimator, every signal an axis in it — capacity, latency, throughput.
A capacity *gate* was floated and rejected; do not re-propose it.

Two things ranking has to get right, both solvable with patterns the registry
already has:

- **Damping.** Capacity moves in response to our own routing — send work, CPU
  rises, work leaves, CPU falls — so the capacity axis needs a minimum relative
  difference before it changes any decision, the way throughput already has
  `THROUGHPUT_MIN_RELATIVE_DIFFERENCE`. The swap cooldown and the
  consecutive-cycle streak in `evaluatePreferredSwap` are the other half of
  that vocabulary and apply unchanged.
- **Normalisation.** `load1: 2.67` is saturated on two cores and comfortable on
  eight, and `process_cpu_percent: 104.5` exceeds 100 because cores are not
  divided out. Asked macha-a4 for `cpu_cores` on 2026-09-08 — a constant, cheap
  to add. Until it lands, normalise capacity by something stated rather than
  comparing raw values across a cluster that is deliberately non-uniform
  hardware.

Design notes handed over with it:

- [ ] **Build one estimator from the three free signals, and rank on it.**
      Server-reported *capacity* (`load1`, `process_cpu_percent`,
      `storage.available`, cache pressure, `phase`/`state`) says whether a node
      can serve; client-measured *latency* says whether the path to it is any
      good; opportunistically sampled *throughput* refines both where real
      bytes happened to flow. None of the three costs a byte more than the
      client already spends. Weight capacity and latency so that neither a
      busy-but-close node nor an idle-but-distant one wins on one axis alone —
      the failure here was ranking on a single axis that happened to abstain.
- [ ] **`candidates()` must actually read them.** Today its sort is readiness →
      preferred → `retryAt` → `consecutiveFailures` → throughput →
      `left.order - right.order`, so when throughput abstains it falls to the
      order the endpoints were typed into `.env`, and no telemetry or latency
      is consulted at any point. Note latency is already recorded for every
      endpoint (5-sample rolling, from the 10 s probe cycle) and is used *only*
      in `evaluatePreferredSwap`, never in candidate ordering.
- [ ] **Model `/api/v1/status` node telemetry into the registry.** This shares
      the prerequisite with the "Surface server self-healing state" item below,
      which also needs `diagnostics` read for the first time — do it once.
- [ ] **Sample the transfers already happening**, as refinement rather than
      foundation: HLS segments and byte ranges are megabytes attributed to
      whichever node served them, and artwork Blobs route *advisory* across
      alternates, so they are the natural evidence for nodes not currently
      preferred. `setTransferRecorder` is already injected, so this is call
      sites rather than new machinery.
- [ ] `return 0` for unmeasured throughput stops being load-bearing once
      ranking has other axes, which is the right outcome — no clever answer to
      "what does unmeasured mean" is needed, because it is no longer the only
      question being asked.
- [ ] Re-run the transcode throughput table pinned per node afterwards. Every
      figure sent to the server session on 2026-09-08 conflates node choice
      with encoder speed, and the corrections are already with them.

## P1 — Status calls a node's RPC socket its "Endpoint"

`StatusScreen` renders `node.host:node.port` under the label **Endpoint**
(line 510), and falls back to `node.host` as the node's display name (line 56).
That is the node's internal **RPC bind address**, not its HTTP API — core's own
comment in `discoverClusterEndpoints` says so explicitly, and refuses to build
a URL from it for exactly that reason: "using it here would guess at a port
that is frequently wrong".

On this cluster it looks plausible and is wrong: RPC is `:7437`, the API is
`:7438`. So the Status screen tells an operator the node lives one port away
from where anything can actually reach it — a number that reads as an address
and is not one.

- [ ] Relabel, or better, show the real thing. The server is replacing
      `api_host`/`api_port` with a single `api_endpoint` URL (raised with
      macha-a4 2026-09-08, may carry a scheme and a path so a node behind a
      proxy is expressible). That is the first value this field could honestly
      display. Hold the change until the shape lands rather than relabelling
      twice — but do not leave "Endpoint" pointing at the RPC socket
      indefinitely on the strength of that.
- [ ] Not a display concern, and worth confirming before the server's cut:
      `resetNodeIdentityAssociation(nodeId, host, port, reason)` is a
      **mutation** keyed on host and port, fed from `node.host`/`node.port`.
      If `host`/`port` survive as the RPC address, nothing changes. If they are
      tidied away alongside the `api_`-prefixed pair, identity reset loses its
      arguments and fails silently. Confirmed by the `@macha/core` session
      2026-09-08: `port` is optional through `ManageApi`, `MachaManageApi` and
      `ClusterManageApi` alike, so a payload that stopped carrying it would
      neither fail to compile nor throw here — it would send a **destructive
      identity reset with the port missing**, against whatever the server makes
      of that. Everything else in this wire change fails closed; this is the
      one path that does not, which is why it was raised with macha-a4 as an
      explicit ask rather than left as an assumption.

This client reads no `api_host`/`api_port` anywhere (verified 2026-09-08), so
the server's replacement of those two is safe here; discovery is core's alone.

## P1 — Music playlist refactors onto the RN client's store

Tom's decision, relayed 2026-09-08: the React Native client's playlist store is
being abstracted into `@macha/core` and this client refactors onto it. Theirs is
a collection of **named** playlists (create/rename/delete, versioned and
validated at file and playlist level, `getSnapshot`/`subscribe` for
`useSyncExternalStore`); core's current `MusicPlaylistStore` is a single unnamed
array. Both use the same `MusicPlaylistEntry` shape, which is what let two
sessions compare entries, agree, and miss that the *stores* differ entirely —
had the port gone ahead, a viewer with five named playlists would have got one
and lost the rest on first write.

**Settled with the RN session, 2026-09-08.** Core's single-list
`MusicPlaylistStore` is **deleted**, not renamed — a collection subsumes it,
and a degenerate one-list store sitting beside a collection store is the kind
of thing that survives for years because nobody wants to decide. `replace` does
**not** come into the collection API: its existence is an artefact of there
being exactly one list, and "discard every playlist and substitute this album"
has no legitimate caller. `create(name, items)` covers the honest version.

- **No migration needed here: there is no live data.** `localStorage` in the
  running client has never written `macha.musicPlaylist.v1.*`, consistent with
  the music library being empty on this cluster. Treat the web client as
  greenfield. The port will adopt any single unnamed list it finds under a
  default name anyway, so a TV install holding one is covered.
- [ ] **`playAlbumAll` must stop calling `playlistStore.replace(tracks)` and
  set the queue instead.** Pressing "play all" on an album currently *discards
  the whole playlist* and substitutes that album — defensible when there is one
  unnamed scratch list, data loss with a friendly label once playlists are
  named. It is queue behaviour writing to the wrong store: `PlaybackQueueStore`
  is already the queue, and `playNext`/`playLater` correctly use it.
- [ ] **Build the UI for named playlists, in this client's existing idiom.**
  Named playlists are useless without a way to make and pick one, and the
  refactor is the moment to add it rather than shipping a store with no surface.
  Use what is already here rather than inventing: `Modal`/`ConfirmModal` for
  create, rename and the destructive delete — `docs/architecture.md` forbids
  browser `alert`/`confirm`/`prompt` outright, and every destructive action in
  Manage and Status already goes through the shared focus-managed modal;
  `AsyncIconButton` for anything with a request behind it, so the control
  disables and swaps to a spinner for the whole lifetime; and the `MusicNav`
  secondary row is the established place for switching within the Music
  section, styled and focused like the primary nav. Every control needs
  `data-tv-focusable="true"` — this screen is reachable on both televisions,
  where there is no pointer to fall back on.
- [ ] Move `useMusicController` from `useState` reassigned by every mutation to
  a real subscription. Today exactly one component owns the list, so nothing
  else can observe it and two consumers would silently diverge. Note the RN
  session's scar when doing it: subscribing to a revision counter and then
  calling `list()` freezes, because the memo is keyed on a store whose identity
  never changes — the snapshot must *be* the value the caller renders.
  **Note this may be decided above us:** core currently has two subscription
  idioms — the coordinator and runtime return stable snapshots, the four state
  stores do not — and the `@macha/core` session has put the question of fixing
  all four to Tom, citing this controller as the live evidence. Wait for that
  answer rather than fixing the playlist store alone.

## P1 — Seek acceleration is Samsung-only and should work everywhere

`PlayerScreen`'s scrubber `onKeyDown` returns immediately unless
`samsungControls`, so `accelerateSeek`/`seekAcceleration.ts` — the
hold-to-travel-further behaviour — never runs on web or Android. Web gets
`webSeekDeltaForKey`, a flat ±10 s per press.

Confirmed live 2026-09-08 rather than read: moving ~200 s through a film on
web took **20 discrete ArrowRight presses**, each a separate 10 s step. On a
long title that is unusable, and it is the same remote-shaped interaction on
Android, which has a D-pad and no acceleration either.

- [ ] Make the accelerating hold the shared behaviour for every platform with
  key-driven seeking, not a Samsung special case. The existing pieces are
  already platform-independent — `accelerateSeek` is a pure function with its
  own tests, and the commit-on-release/one-request-per-hold property is the
  part worth preserving everywhere.
- [ ] Keep pointer dragging on web working exactly as it does now; this is
  about the keyboard/D-pad path only.

## P1 — Session create can be refused outright (429), by design

Observed live 2026-09-07 while measuring transcode latency: `POST
/api/v1/playback/sessions` answered `429` on gbni-2 while an earlier session
of the same client was still open, and `201` immediately after that session
was `DELETE`d. Confirmed with the server session as **admission control by
design — handle it as a hard limit, not a queue.**

- [ ] Do not retry a `429` from session create on a timer, and do not fail
  over to another node for it (a second node would refuse it too, and the
  candidate loop would burn every endpoint before surfacing anything). Treat
  it as "too many streams open", say so, and make sure the client is not the
  one leaking: a session that outlives its player is what turns this into a
  user-visible dead end.

## P1 — Android/Google TV is a Chromium WebView and nothing has been run on it

The set at `10.34.1.116` (ES-1, across the WAN) carried the 0.8.1-era client
until 2026-09-07 and now carries 0.10.7. Its whole playback pipeline is a
Chromium WebView, so every browser-side fault found on 2026-09-08 applies to
it and none of them has been observed there.

- [ ] Install the current APK. Built and waiting as of 2026-09-08 01:07; the
      set was off the network that night (`es-1` beside it answered at 97 ms,
      the television did not answer at all). `versionCode` is now derived from
      `package.json`, so an upgrade presents a higher code than the copy
      installed and no uninstall is needed unless the debug key has changed
      again.
- [ ] Play a 5.1 title on it. Server 0.33.3 fixed an AAC configuration that
      Chrome's MP4 parser rejects outright (see COMPLETED.md); that fix is
      verified on Chrome by two independent measurements and **is not
      verified on this host**, which would have failed identically.
- [ ] Confirm the bounded HLS recovery behaves there: the WebView is the same
      engine, but it is across a WAN link, so the failure it protects against
      is more expensive and slower to arrive.

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
