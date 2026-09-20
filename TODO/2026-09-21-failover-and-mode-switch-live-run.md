# The failover, watched in a browser, and the two faults it found

Date: 2026-09-21

Status: evidence record. What a live run showed, what changed because of it,
and what is still unproven.

## What was running

- macha-client `develop` at 0.17.2 plus this session's uncommitted changes,
  served by Vite in development, Chrome on macOS, foregrounded
  (`document.hidden` recorded in every sample and `false` throughout).
- `@machafoundation/core` **0.14.0 from npm**, not a link.
- Endpoints configured by hand to the three nodes directly
  (`10.35.1.50`, `10.34.1.50`, `10.44.1.50`), so the serving node is
  unambiguous and one of them can be failed on purpose. Signed in as
  `webclient`. The page is `http://localhost:5173`, so the https-page P0 is
  not in the way.
- One episode, played from `fi-1`, Direct Play to start with.

**The node was failed from inside the page**, by rejecting every `fetch` and
`XMLHttpRequest` to `10.35.1.50` — which is what a dead node looks like to this
client, and costs the cluster nothing. Nothing was stopped on any node.

## Part one — a mode switch, and the hold that was never asked for

Reproducing 2026-09-20's 16.5 s blackout: Direct Play running, select
Transcode. It arrives as a **representation change**, and 0.17.2 tears the
element down for it.

**The hold was not declining. It was never called.** A representation change
arrives as `transition: 'continue'`, so `play()` asks `handOverToSource()`
first — which declines silently and without preparing anything, because the
outgoing source is Direct Play and a handover needs managed HLS on both sides.
The hold then sat behind `transition !== 'continue'` and was skipped entirely.
Measured on the first run of the day: `source-load-begin`,
`media-element-reused`, `readyState` **0**, no `relocation-hold-begin` anywhere.

Two changes, both in `WebPlatform.ts`:

1. `canHoldThroughRelocation()` owns the rule and asks only what the
   *replacement* needs — an hls.js-driven manifest and a frame actually up to
   hold. It no longer asks the outgoing side to be a manifest, which is a fact
   about media the hold never touches.
2. The hold is asked on **both** transitions. A handover that declined cost
   nothing, so the picture can still be held; one that *spent* the budget does
   not get a second wait before the same blank, and `resumeAtMs` is present
   exactly when that happened, so it is the gate.

**Measured after, twice, on the same title and node:**

```
   0ms  n=1 rs=4 t=2482.17 playing        <- Transcode selected
2400ms  n=2 rs=4 t=2484.41 paused=true    <- frame held, replacement built beside it
7400ms  n=1 rs=4 t=2.49    playing        <- swapped
relocation-hold-begin ... relocation-hold-complete elapsedMs=4977
```

`readyState` never left 4 and no `media-element-reused` was logged. The other
run completed in 2,726 ms. **16.5 s of black became no black at all.**

## Part two — the failover, and the picture that died at diagnosis

Transcode playing from `fi-1`, 30 s buffered, then the node dies.

**First run, before the second change below:**

```
    0ms  rs=4 t=21.89  buffered to 42.0     <- node killed
19200ms  rs=2 t=45.96                       <- buffer spent, last frame still up
       source-stalled readyState=HAVE_CURRENT_DATA
       source-terminal-failure "nothing arrived for 7s"
26201ms  rs=0 t=0                           <- BLACK
35200ms  rs=4 t=0                           <- replacement on es-1
38200ms  rs=4 t=2    playing
```

**Nine seconds of black, and the hold was right to decline** — by the time core
asked for the replacement there was nothing left to hold. The picture had
already been thrown away at `failSourceGeneration`, which called
`hls.destroy()` the moment it diagnosed the failure. `destroy()` detaches the
MediaSource and the element empties: `media-abort` and `media-emptied` at
`HAVE_NOTHING`, seven seconds before anything could replace it.

**The change.** A failed generation is now **stopped where it fails and
destroyed where it is replaced** — `retireHls()` calls `stopLoad()` and keeps
the instance in `retiredHls`, and `destroyRetiredHls()` runs on the three paths
that take the element: the teardown in `play()`, the cut in `promoteHandover()`
and `stop()`. It fetches nothing more from a dead node, and it keeps the last
frame up until something can replace it. That is the rule `promoteHandover`
already stated: release the outgoing generation after the cut, never before it.

**Measured after, same procedure:**

```
    0ms  n=1 rs=4 t=21.89 vw=1920           <- node killed
12200ms  n=1 rs=2 t=33.97 vw=1920           <- buffer spent, frame still up
       source-stalled -> source-terminal-failure (7 s) -> source-failover-start
19201ms  n=2 rs=2 paused=true vw=1920       <- hold engaged on the failover
21800ms  n=1 rs=4 t=0.4                     <- swapped to es-1
24001ms  n=1 rs=4 t=2.01  playing
relocation-hold-begin -> relocation-hold-complete elapsedMs=2596
media-element-reused: 0
```

**`readyState` never dropped below 2 and `videoWidth` never left 1920 — the
picture was never blanked.** The viewer lost no position either:
`source-presented generationStartMs=2515424 positionMs=2515754`, about a third
of a second into the new generation and within ~260 ms of where they were.

## What this leaves open

- **The transcode handover's two exits are still unwatched.** `handoverJoinLost()`
  and `handoverFallbackPositionMs()` did not run: a dead node produces a
  *failover*, and core rebuilds rather than handing over — no `handover-*` event
  appeared at any point. Reaching them still needs core to attempt a handover,
  which this route does not do.
- **Seven seconds of "nothing arrived" is still the detection cost**, and on a
  genuinely dead node that is defensible. It is the same budget the P1 questions
  for the case where the node is alive and merely ahead of its frontier.
- **The freeze is not free.** The viewer sat on a still frame from the moment
  the buffer emptied to the swap — 11.8 s here, 7 s of it the stall budget. A
  frozen frame is better than black and is not the same as uninterrupted.
- **The kill was simulated in the page.** Requests to the node were rejected in
  `fetch` and `XMLHttpRequest`; the node itself stayed up. A real node failure
  (a stopped service, a pulled link) has not been watched, and the read-ahead
  Service Worker used by Direct Play does not see a page-level patch at all, so
  a Direct Play failover was **not** exercised by this method.

## Part three — going for seamless, and the two P0 exits firing at last

**Everything in this part was reverted before committing.** It is recorded
because it was measured and because it is the evidence for the two P0 exits
below — not because it is in the tree. What survives from this evening is Parts
one and two: the hold asked on both transitions, and a failed generation
stopped rather than destroyed. The reasoning for dropping the rest is at the
end of this part.

**The gap between a failover and a seamless one is runway.** Core prepares a
replacement early (a generation on another node existed ~12 s before the
picture stopped) but activates it only when the player reports the generation
dead — and the player could not report that until the *stall watchdog* fired,
which by construction cannot fire until playback has already stopped. So the
whole buffer drained first, and by the time anything was activated there was
nothing left to hand over from. Every failover measured so far ended in a
freeze or a blank for that reason alone.

Three changes, all in `WebPlatform.ts`:

1. **`escalateWhileRunwayRemains()`** — a failing generation is reported while
   it still has runway, at `DEGRADED_RUNWAY_ESCALATION_MS`, instead of waiting
   for the picture to stop. Gated on the source failing *now*
   (`noteSourceTrouble()`, recorded from the first hls.js error of any kind,
   fatal or not, and independent of the degradation latch), so a generation
   that wobbled once or a transcode habitually short of buffer is not torn
   down.
2. **A supply failure keeps playing.** `failSourceGeneration` no longer pauses
   the element when the failure is `stream` and runway remains: that runway is
   what pays for a cut, and `handOverToSource` declines a paused element. A
   decode/`unsupported` failure still stops, and the test that says so was seen
   red first.
3. **A recovery relocation takes the handover.** A relocation that follows a
   failure this player reported is not a viewer asking to move, so it is
   offered the seamless path rather than the teardown.

**The threshold was measured, not chosen.** At 12 s the handover ran, reached
its join and completed — and the outgoing ran dry 400 ms before it:
`handover-join-buffered elapsedMs=12859` against 12 s of runway, then
`handover-join-forced-by-stall joinAtOldMs=70395 stalledAtMs=69995`. A
replacement on a node transcoding from scratch cost 12.9 s, so the budget is
20 s.

**Both of the P0's unwatched exits then fired, live, for the first time:**

```
handover-begin        outgoingPositionMs=74064 requestedPositionMs=6712
handover-abandoned    reason=join-receding-faster-than-it-fills
                      startDeficitMs=2151 deficitMs=4256 observedMs=6049
```

`handoverJoinLost()` gave up at ~6 s rather than waiting out the 25 s budget,
on a join that was receding, and `handoverFallbackPositionMs()` placed the
viewer where they actually were. That is exactly what both were built to do and
what had never been watched.

**And the first firing exposed a fourth fault of my own making.** The hold was
gated on "the handover did not spend time", so an abandoned handover fell
straight to the teardown — blanking a picture that still had ~10 s of runway
behind it. Time spent is not the question; whether there is still a frame to
keep is, and `canHoldThroughRelocation()` already asks that. Gate removed.

**The run after that, killing the node at 29.4 s of runway:**

```
    0ms  n=1 rs=4 t=48.67 inside=true playing     <- node killed
13599ms  n=2 rs=4 t=62.27 inside=true playing     <- handover preparing, still playing
       handover-abandoned join-receding-faster-than-it-fills (921 -> 3027 over 6053ms)
23000ms  n=2 rs=4 t=71.60 paused=true             <- hold takes over, frame kept
       relocation-hold-begin requestedPositionMs=20643 heldAtMs=71597
28799ms  n=1 rs=4 t=20.78 inside=true playing     <- swapped, viewer inside the buffer
       relocation-hold-complete elapsedMs=5701 landedAtMs=20643
```

**Zero frames at `readyState` 0 across the whole failover**, against 9 s of
black at the start of the day. The viewer played continuously for 13.6 s after
the node died, then held a frame for 5.8 s, then resumed where they were.

**It is still not seamless, and the reason is not this client.** The handover
was abandoned both times because the replacement cannot fill faster than the
join recedes — a node transcoding from scratch, which is the arithmetic already
recorded on 2026-09-20. Seamless needs a replacement that arrives at the join,
and that is core's placement and the server's production rate, not the
player's.

## The buffer with a gap, seen during failover

Reported live by Tom during the run and caught in the samples: the playhead
outside its own buffered range, with media visible elsewhere. Two distinct
shapes, and they are not the same fault:

- **A detached block at the generation's start.** `buf=[[0,1.97],[17.98,21.99]]`
  with the playhead at 20.78. Every attach path except a handover loads the
  generation from its own beginning and *then* seeks to the offset, so hls.js
  fetches a fragment or two at zero, the seek lands 18 s further in, and the
  first block is orphaned with a hole behind the viewer. `attachHls` already
  passes `startPositionMs` for a handover for this exact reason — "loading from
  zero fetches every fragment before the join and throws them away" — and the
  hold and teardown paths do not. Whether they can is the origin question that
  comment defers: `startPosition` changes where the media clock begins.
- **The playhead at the produced frontier.** `buf=[[0,1.96]]` at `t=1.96`, held
  for 19.6 s on a replacement placed where the viewer would be. That is the
  node not having encoded there yet — the arrival-point placement fault
  recorded on 2026-09-20, reproduced from this side.

Neither blanked the picture. Both are worth a UI that distinguishes "buffering
ahead of you" from "the node has not made this yet".


## Why part three was dropped

Seamless is not reachable from this client. The handover was watched twice and
abandoned twice for the same measured reason — the replacement fills at 1.49x
while the join recedes at 1x, so it closes at 0.49 s per second and needs about
53 s against a 25 s budget. That is the arithmetic already recorded on
2026-09-20, re-measured. Worse, the attempt *spends* about 6 s of the runway the
escalation was built to buy, and then the hold does the same freeze-and-swap it
would have done six seconds earlier. The viewer sees the same interruption.

What was dropped, and why each on its own terms:

- **`escalateWhileRunwayRemains()` and `DEGRADED_RUNWAY_ESCALATION_MS`.** The
  budget came from one measurement of one replacement on one Pi with one title.
  A constant with that provenance is a client tuned to a single slow node. If
  this comes back it should read the node's own stated budget rather than a
  compiled-in number, and it should be measured on at least two nodes and two
  titles first.
- **Keeping the element playing through a supply failure.** It exists only to
  serve the escalation above: without early reporting, a failure is diagnosed
  when the buffer is already spent and there is nothing left to keep playing.
- **Routing a recovery relocation through the handover.** Same dependency, and
  without runway `handOverToSource` declines on its own terms anyway.

**What this costs.** A node death is back to: the buffer drains, the stall
budget expires at 7 s, and the hold carries the picture through the swap —
measured in Part two at zero frames of black and an 11.8 s freeze. The nine
seconds of *black* that started the evening stay fixed. Only the attempt to
remove the freeze is gone.
