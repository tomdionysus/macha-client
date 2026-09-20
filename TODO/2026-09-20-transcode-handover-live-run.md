# The transcode handover, measured at the node and then in the browser

Date: 2026-09-20

Status: evidence record. Nothing here is a plan; it is what a live run found,
and what it changes about the P0 it was taken for.

The run was taken to watch the two unproven client changes of 2026-09-20 — the
handover abandoning the moment the join race is decided, and the fallback
attaching where the viewer actually is. **Neither ran.** What ran instead was a
different path with the same root cause, measured end to end, plus three facts
about the node that were not known when the P0 was written.

## What was running

- macha-client `develop` at 0.17.2, served by Vite in development, Chrome on
  macOS, **foregrounded — `document.hidden` was `false` in every one of the 123
  samples**, which is the check the previous attempt at this measurement failed.
- `@machafoundation/core` linked from `../macha-ts` at its `develop` head
  (`32da3e0`), on Tom's 2026-09-20 direction that a link is how the two
  projects are developed together. Typecheck clean, 387 tests across 50 files
  green against it. The link was dropped after the run.
- `fi-1` (`10.35.1.50`) and the cluster front `ramaroja.macha.network`, both on
  server **0.46.2**. Signed in as `webclient`.
- One episode, 1080p HEVC 10-bit, ~2.2 Mb/s, AAC 6ch
  (`macha:365cbdfd…f302d3`, `tmdb:episode:1288746`).

## Part one — what the node does, measured with curl before any browser

**1. The frontier is stated, and core's clamp is inert here.**
`stream.look_ahead_ms` is **32000** on every transcode session fi-1 created.
`GET /api/v1/status` reports `playback: {startup_timeout_ms: 15000,
segment_timeout_ms: 6000}` for fi-1 and for ramaroja; macnessa is on 0.43.0 and
reports `{}`. So core's `replacementLeadTimeMs` computes `min(26000, 32000 −
4000) = 26000` against a floor of `15000 + 4000 = 19000` and returns the flat
**26 s** either way. The clamp never binds on this node, so the hypothesis that
a missing look-ahead was behind the P0 is dead.

**Scope, from the server session on the evening of the run:** that holds for
generations created under fi-1's configuration as it stands, and not for a
session held across a configuration reload. The reported figure is recomputed
from live configuration every time a session is serialised, but a running
generation's producer gate is not — `MediaSegmentStore` takes
`max_ahead_segments` as a constructor argument and keeps it for the life of the
generation, with no setter. After a reload an in-flight session therefore
**reports a frontier its own producer will not honour**, and re-reading does
not help, because the re-read returns the new configuration's number rather
than that generation's real gate. It is wrong when you read it, not stale in a
way a later read corrects. The server session has filed that as its own P1 with
three options and has given core the detail, including a second divergence with
the same root: `segment_hold_window` *is* read live at request time, so after a
reload of `max_ahead_segments` alone the prediction and the refusal boundary
come from different generations of the configuration. Worth knowing here
because `stream.production.producer_parked` (0.47.0) is derived from the
store's own gate and so tells the truth about the running generation while
`look_ahead_ms` beside it may not — two fields on one object, one current and
one not, with nothing on the wire to say which.

**2. The encoder is faster than realtime, and the lead is still unreachable.**
Pulling segments in order as fast as fi-1 would answer: **70.1 s of media in
47.0 s of wall clock — 1.49x realtime**, steady, first fragment 3.8 s, at
`max_height: 720`. So the join is not receding; it is closing, at 0.49 s per
second. A 26 s lead therefore needs ~53 s to reach, against a 25 s
`HANDOVER_BUFFER_TIMEOUT_MS`. **That is the arithmetic of the P0**, and it is
also the first explanation of "sometimes it works" that survives contact: the
margin is the ratio of production rate to lead, and both vary by title and node.

`max_video_transcodes` is **1** on fi-1, and the node is a Pi
(`libav 7.1.5-0+deb13u1+rpt2`) that **hosts no extents** — every source read
crosses the link from es-1, so 1.49x is a property of node *and* title *and*
extent placement, not of the encoder alone.

**3. A node holds one live playback session per API session, and replacing a
generation destroys the previous one.** A second `POST
/api/v1/playback/sessions` returns **the same `session_id`** with the
generation incremented, and the previous generation's segments answer **404
within about a second**. Measured three ways — no keys; distinct
`idempotency_key` query parameters, which is how core sends them; and distinct
`Macha-Viewer-Session` headers, which core does not send at all. Identical in
all three.

```
[ 2.2] A create=201 session=87ea…41b5 seek=1500000 gen=3   (paced at realtime, like a viewer)
[18.5] A media=18.0s
[19.6] B create=201 session=87ea…41b5 seek=1530000 gen=4   (distinct idempotency key)
[22.3] A status=404 media=18.0s        <- A's supply is gone, 2.7 s after B existed
[22.3] B media=6.0s
```

The server session read the source and made it exact: the key is
`request.session->id` — **the bearer token** (`src/playback.cpp:2236`), not any
client-supplied key, and not the media, so a second POST supersedes whatever
that token was playing **across all media**. `Macha-Viewer-Session` is not read
anywhere in the server; the only occurrence is a comment calling it retired.
`docs/streaming.md` describes both it and an `Idempotency-Key` header as live,
which is why a client implementing that text builds a handover that cannot
work. The server session is fixing the documentation and has put the divergence
to the operator.

**Two live generations of one media on one node are not obtainable with one
bearer token.** So a same-node handover cannot work at any lead time, and
failing fast and landing the viewer correctly — what `develop` now does — is
the right shape rather than a mitigation. Core confirmed it is not itself
exposed: `prepareAlternate` always excludes the active endpoint, `regenerate`
releases the old session before asking, and seeks are a PATCH.

## Part two — the browser run, and the fault it found instead

Switching mode mid-playback does not take the handover path at all. It is a
**representation change**, and the client tears down and reattaches on the same
element. Elapsed times are from the client's own diagnostics buffer.

```
644,710  viewer at 93.671 s, direct, via ramaroja. Transcode selected.
         PATCH …/sessions/fbd3…a169  {mode: transcode, seek_ms: 93671}
656,167  session-updated mode=transcode          <- the PATCH took 11.5 s
         generation-update-ready reason=representation requestedPositionMs=93671
         media-element-reused, media-emptied      <- the picture goes
         source-presented generationStartMs=93671 positionMs=105092
661,006  loadedmetadata (manifest parse 2.8 s)
661,007  initial-local-seek requestedPositionMs=11421 targetMediaMs=11421 mediaOriginMs=0
668,018  source-stalled / source-terminal-failure
         "Playback stopped and nothing arrived for 7s."  buffered=[0, 1.96]
668,023  source-failover-start requestedPositionMs=105092
672,391  session-created 5c76…e85f on http://10.35.1.50:7438, seek 105092
672,394  source-presented generationStartMs=105092 positionMs=105092
672,695  playing
```

**The viewer lost about 16.5 seconds of picture and did not lose their place.**

**The seek was correct and the generation was in the wrong place.** The client
computed the target exactly right: the viewer was 11.421 s into a generation
that starts at 93.671 s, and it asked for 11.421 s. The node had produced
**1.96 s** of it. The 11.5 s the PATCH spent negotiating is time the viewer
spent watching, and the generation was created at the position they were at
when they clicked rather than the position they would be at when it existed —
**which is the same fault as the P0's join, arriving by a different path.** The
node then behaved exactly as documented: a request past the produced frontier
is a bounded wait, and the client called it terminal after 7 s.

**The recovery landed the viewer correctly, and it was not this client's new
fallback that did it.** Failover created a fresh generation at `105092` and
presented it at `105092` — the arrival point rather than the stale request — so
playback resumed where the viewer was, with no rewind. That is core's failover
path placing a generation, not `handoverFallbackPositionMs()`, which never ran.
It is evidence that the *shape* is right; it is not evidence that this repo's
implementation of it works.

**Core found the line, from this trace.** `PlaybackCoordinator.ts:1479` binds
`seekMs` to the intent position as the request is dispatched — correct as far
as it goes, since it stops a queued mutation carrying stale transport intent,
but it is the position at the moment the request *leaves*, with no allowance
for how long it will take. The compensation that exists,
`userMovedDuringRequest` at `:1519`, is gated on `positionRevision`, which is
incremented in exactly one place: `seek()`, at `:1226`. **Playback merely
advancing does not touch it.** So core compensates for the viewer moving during
a negotiation and not for the negotiation taking time — which is why a viewer
sitting perfectly still is the case that breaks, and why this went unnoticed.
Core has recorded it as one fault with the lead-time placement: both put a new
generation where the viewer *was* rather than where they will be when it is
usable, one measured in the lead time and one in the round trip, neither
anything to do with handovers.

**What is still unwatched.** `handoverJoinLost()` and
`handoverFallbackPositionMs()` did not execute: no handover was attempted,
because a representation change does not attempt one. They remain unproven live
and the P0 stays open on that basis. Reaching them needs a reap or a node
failure under a playing transcode, not a mode switch.

## What this changes

- The lead time is the binding constraint, and core has taken the fix:
  creating a deferred replacement at the **arrival point** rather than at the
  playhead, so the join lands on the new generation's first fragment. Core has
  recorded both items from this repo's P0 as core's, with provenance.
- The operator has approved the server publishing encoder production on the
  session payload; core owns the client-facing surface and has told the server
  it must be raw and single-sample sufficient. **This client should not read
  the server field directly** — the rate is a property of node, title and
  extent placement together, and two clients deriving it separately would
  disagree about the same generation.
- A representation change costing 16 s of black screen is its own fault, and
  it is not the handover. It is filed as its own item.

## Method notes

- `document.hidden` was recorded in every sample and was `false` throughout.
  The tab had to be raised to the front first: the extension's tab was in a
  background window, and the client showed `readyState` 0 with nothing
  buffered while `hasFocus()` returned `true` — the exact reading that cost
  the first attempt at this measurement.
- `scripts/playback-baseline.mjs` had been broken since core 0.10.0 removed
  `mintAnonymousSession` ("one account model, no special anonymous"). It now
  signs in as the test account and gives its session back at the end.
