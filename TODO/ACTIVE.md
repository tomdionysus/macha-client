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

## P1 — Samsung deployment verification

Boot, catalogue, D-pad navigation and playback controls were exercised live
on `10.44.1.183` on 2026-09-07 and the defects found are fixed (see
`COMPLETED.md`). What remains is the one title that still does not work.

- [ ] **Ratatouille (`tmdb:movie:2062`) on the Samsung.** Direct play breaks
  decoding — the set advertises `hevc` and 10-bit but cannot handle this
  file's Dolby Vision — and the transcode fallback plays silent. Both causes
  are server-side and fixed in the server's 0.32.12 line: a real master
  playlist carrying `CODECS` (verified from a real node: `CODECS=
  "hvc1.2.4.L153.B0,mp4a.40.2"`), and a bit-depth/HDR gate that routes the
  title to a transcode instead of a broken direct play. Blocked on that
  reaching `gbni-1`, which is the Samsung build's only endpoint. Re-test when
  it lands: negotiated mode, and whether sound plays.
- [ ] Re-check the rest of the UI once that title works, since every pass so
  far has been interrupted by it.

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
