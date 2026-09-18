# Seamless generation handover

How this client replaces a playing remux or transcode generation with another
one — on the same node or a different one — without the viewer seeing it.

It is the transcode counterpart of what the Direct Play read-ahead worker
already does for a dying node, and it exists because that mechanism cannot be
reused here.

## Why Direct Play's answer does not transfer

Direct Play survives a node dying without a flicker. The media element is never
given a node URL: `directPlayReadAheadUrl()` hands it a stable same-origin proxy
URL, and the Service Worker holds a *list* of upstream URLs behind that key
(`configuredSourceUrls`). Core pushes a second node's URL down through
`Player.addDirectSourceAlternative`, and `directFetchWithFailover` walks the list
on every fetch. `video.src` never changes, the MediaSource is never rebuilt, and
the element cannot tell which node answered.

That works because **the resource is identical on every node**. Byte range
5,000,000–5,065,535 of a file is the same bytes from anywhere.

A transcode generation is not like that. Each carries its own timeline origin,
its own `EXT-X-MAP` init segment and its own fragment boundaries, so two nodes
transcoding the same title produce *different media*. There is no stable URL to
put in front of them, because the thing behind the URL is not interchangeable.
This is why the existing method has "Direct" in its name: it was never general.

## Two things that do not work, both measured

**Offering hls.js a new source in place.** `hls.loadSource(url)` on a live,
attached instance fires `MEDIA_DETACHED`, then `BUFFER_RESET`, then `emptied` on
the element, within 3 ms. Measured with 78 s buffered: `currentTime` went to 0,
`paused` to true, and the buffer was gone. It destroys the runway exactly as a
teardown does, so it is not a seam.

**Appending both generations to one SourceBuffer.** This is what
`EXT-X-DISCONTINUITY` is for, and hls.js handles discontinuities natively — but
only within one playlist. Spanning two generations would mean synthesising a
playlist across them through a custom `pLoader`, plus `SourceBuffer.changeType()`
whenever the init segments differ, which they do the moment quality differs.
Reachable, and far more machinery than the alternative.

## The method

The replacement decodes on a **second media element** while the first keeps
playing, and the elements are swapped once the replacement is buffered and
aligned. `WebPlayer.handOverToSource` does this; `promoteHandover` performs the
cut.

1. **Decide.** Both sides must be managed HLS, the outgoing element must actually
   be playing, and there must be enough buffered media to be worth protecting.
   Anything else falls through to the teardown path, which is what every other
   target still does.

   **Both sides** is the guard that gets forgotten. The *outgoing*
   `activeSource.isManifest` is checked as well as the incoming source's, so a
   switch out of Direct Play — to remux or transcode — can never be seamless:
   there is no second managed-HLS element to hand over to, and `play()` falls
   through to teardown. The first transformed generation after a Direct Play
   session therefore always tears down, however the transition is labelled, and
   no reasoning about handover behaviour reaches it. Confirmed 2026-09-18 while
   three sessions were separately explaining a stall on a run that had never
   been a handover at all.
2. **Take the clock offset.** At the moment core asks, the viewer is at
   `lastPublishedEvent.positionMs` on the outgoing generation and core is asking
   for `positionMs` on the incoming one. Those denote the same content, so
   `clockOffsetMs = positionMs - outgoingPositionMs` converts between the two
   clocks for the rest of the handover. Measured at −51 s and −104 s in two runs:
   it is however far the viewer travelled while core negotiated.
3. **Prepare hidden.** Build a wired element with `display: none`, muted, and
   attach a second hls.js instance to it. Nothing is installed as active, so
   every listener on both stays inert — they already guard on
   `video !== this.video` and `this.hls !== hls`.
4. **Wait for the join to be buffered, not for `canplay`.** `canplay` means
   fragment 0 arrived; the join is `clockOffsetMs` in and has to be fetched.
   Seeking before it is resident makes the element wait for data instead of
   firing `seeked`. The join is recomputed each turn because the outgoing element
   keeps moving.
5. **Seek the hidden element** to the join, and wait for `seeked`. Free to the
   viewer, because it happens on an element nobody is looking at.
6. **Cut when the outgoing element reaches the join**, in one synchronous block:
   mute the outgoing, show and unmute the incoming, move `video`/`hls`/timeline
   and generation bookkeeping across, play the incoming, pause the outgoing. Then
   destroy the outgoing instance and remove its element — after the cut, never
   before.

If the outgoing element **stalls** while this is going on — which is the normal
end of a reaped generation — the cut is forced immediately rather than waiting
for a position that will never arrive. Without that, a handover once held a
fully-prepared replacement for 25 s while the picture sat frozen.

## Measurements

Standalone, `es-1`, transcode over fMP4, audible, judged seamless by ear:

```
B created at A + 25 s, attached to a second <video> with display:none
B canplay                       1.35 s
B buffered while unrendered     50 s and growing, faster than realtime
seek B to the join while hidden
A reached  20.8998 min
B resumed  20.8997 min          ~6 ms of content error
handover                        0.6 ms
```

For comparison on the same recovery: 12.7 s of black before any of this, and
4.5 s with the teardown suppressed but no handover.

## Two things that will catch the next person

**`display: none` is enough, and that is not obvious.** An unrendered element
still buffers. Element visibility does not gate MSE. **Tab** visibility gates
everything — a backgrounded tab stops decoding dead, `readyState 0`,
`networkState 2`, no error — which is the same signature as the Direct Play
readyState-0 investigation, and it was walked into twice while building this.
That case is deliberately unhandled: a gap nobody is watching is not worth
paying for.

It throttles **loading** as well as decoding, which is the half that keeps
catching people, because it looks like a server fault rather than a browser
one. Chrome throttles a background tab's timers to roughly one firing a
minute, and hls.js drives its fragment loop on a timer. Measured 2026-09-18 in
a tab opened programmatically and never foregrounded: `hls-manifest-parsed` at
02:00:50, first `hls-fragment-loading` at **02:02:43** — 113 s in which the
node's journal records the client asking it for nothing at all, while the node
reclaimed the idle pipeline out from under it at 60 s. Nothing was wrong with
either end.

**So record `document.hidden` in every sample series.** It is one field, and
without it a throttled harness is indistinguishable from a client that is
genuinely slow to start — which is a claim worth a server engineer's day.

**Alignment is the part that must be exact.** The replacement is created for the
position the viewer had reached when core asked, and the viewer keeps moving
while it buffers. Promoting it at its own start therefore replays the
difference — about two seconds in the first attempt, plainly visible and
unmistakable with sound.

## What this needs from the coordinator

Nothing in the `Player` contract: core still calls `play(source, positionMs)` and
the platform decides how to get there. Other targets are unaffected.

What it does need is **time**. The lead before activation has to cover session
creation *and* the client getting the join point resident — not just
negotiation. Creation alone is 3–9 s, because the server starts the pipeline and
blocks on the first fragment inside the `201`; fetching the join is a
multi-megabyte fragment at Original quality. Measured against core 0.13.0 the
player was handed the replacement with **4.9 s** of runway remaining, having had
77 s available when the reap was detected, and the handover could not finish in
time. The mechanism was not the limit.
