# Replacing a playing generation

How the Web player replaces a remux or transcode generation with another — on
the same node or a different one — and what the viewer sees while it happens.

There are two cases, and they are not the same problem:

- **Handover**, where the viewer did not ask to move. The replacement must be
  invisible, so the outgoing generation keeps playing until the new one can take
  over at the same content position.
- **Relocation**, where the viewer asked to move. There is nothing to hide, so
  the picture is held still at the position they left until the replacement can
  present the position they asked for.

Both prepare the replacement on a second media element. Both fall through to a
teardown of the existing element if they cannot complete cleanly, so neither can
be worse than rebuilding in place.

## Why a second element is required

Direct Play survives a node dying without a flicker, and that method does not
generalise. The media element is never given a node URL: `directPlayReadAheadUrl()`
hands it a stable same-origin proxy URL and the Service Worker holds a list of
upstream URLs behind that key, so `video.src` never changes and the element
cannot tell which node answered. That works because the resource is identical
everywhere — a byte range of a file is the same bytes from any node.

A transformed generation is not interchangeable. Each has its own timeline
origin, its own `EXT-X-MAP` initialization segment and its own fragment
boundaries, so two nodes transcoding one title produce different media.

Two in-place alternatives were measured and rejected:

- **`hls.loadSource()` on a live instance** fires `MEDIA_DETACHED`, `BUFFER_RESET`
  and `emptied` within milliseconds. With 78 s buffered, `currentTime` went to
  zero and the buffer was gone. It destroys the runway exactly as a teardown
  does.
- **Appending both generations to one SourceBuffer** is what
  `EXT-X-DISCONTINUITY` is for, and hls.js handles discontinuities within one
  playlist. Spanning two generations would require synthesising a playlist
  across them through a custom `pLoader` plus `SourceBuffer.changeType()`
  whenever initialization segments differ, which they do as soon as quality
  differs.

Nothing in the `Player` contract changes for either case: core calls
`play(source, positionMs, startPaused, transition)` and the platform decides how
to get there. Other targets are unaffected.

## Handover

`WebPlayer.handOverToSource`, taken when the transition is `continue`.

1. **Decide.** Both sides must be managed HLS, the outgoing element must be
   playing, and there must be enough buffered runway to be worth protecting.

   **Both sides** is the guard that is easily missed. The outgoing
   `activeSource.isManifest` is checked as well as the incoming source's, so a
   switch out of Direct Play can never be a handover: there is no second
   managed-HLS element to hand over to. The first transformed generation after a
   Direct Play session therefore always tears down, however the transition is
   labelled.

2. **Take the clock offset.** At the moment core asks, the viewer is at
   `lastPublishedEvent.positionMs` on the outgoing generation and core is asking
   for `positionMs` on the incoming one. Those denote the same content, so
   `clockOffsetMs = positionMs - outgoingPositionMs` converts between the two
   clocks for the rest of the handover. It is however far the viewer travelled
   while core negotiated.

3. **Prepare hidden.** Build a wired element with `display: none`, muted, and
   attach a second hls.js instance with `startPosition` at the expected join.
   Nothing is installed as active, so every listener on both instances stays
   inert — they already guard on `video !== this.video` and `this.hls !== hls`.

4. **Wait for the join to be buffered, not for `canplay`.** `canplay` means the
   first fragment arrived; the join is `clockOffsetMs` in and must be fetched.
   Seeking before it is resident makes the element wait for data instead of
   firing `seeked`. The join is recomputed each turn because the outgoing element
   keeps moving, and the replacement must also hold some road beyond the join,
   or it starves seconds after being promoted.

   The join is not a fixed point: it recedes at the viewer's rate while the
   replacement fills at its node's rate. `handoverJoinLost()` compares the
   distance from the replacement's buffered edge to the join at the start of a
   six-second observation and now, and abandons the handover as soon as the
   race is decided — not closing at all, or closing too slowly to arrive
   inside what is left of the budget — rather than waiting the 25 s budget
   out. An abandoned handover reports `resumeAtMs`, the live position in the
   replacement's clock, and the fallback attaches there instead of at the
   position core computed before the attempt began, so the viewer is never
   put back.

5. **Seek the hidden element** to the join and wait for `seeked`. This costs the
   viewer nothing; nobody is looking at that element.

6. **Cut when the outgoing element reaches the join**, in one synchronous block:
   mute the outgoing, show and unmute the incoming, move the element, hls
   instance, timeline and generation bookkeeping across, play the incoming,
   pause the outgoing. The outgoing instance is destroyed and its element
   removed after the cut, never before.

If the outgoing element **stalls** during this — the normal end of a reaped
generation — the cut is forced immediately rather than waiting for a position
that will never arrive.

**A failed generation is stopped where it fails and destroyed where it is
replaced.** `retireHls()` calls `stopLoad()`, so nothing more is fetched from a
node that has gone, and the instance is destroyed only on the three paths that
take the element: the teardown in `play()`, the cut in `promoteHandover()` and
`stop()`. Destroying it at diagnosis detached the MediaSource and blanked the
element seconds before anything could replace it.

**Alignment is the part that must be exact.** The replacement is created for the
position the viewer had reached when core asked, and they keep moving while it
buffers. Promoting it at its own start replays the difference, which is plainly
audible.

**What it needs is time.** The lead before activation has to cover session
creation *and* getting the join point resident, not just negotiation.

## Relocation

`WebPlayer.holdThroughRelocation`, asked on every transition the handover did
not take — a seek, a failover, and a representation change whose handover
declined — except after a handover that spent the viewer's budget on the same
blank. `canHoldThroughRelocation()` owns the guard and asks only what the
replacement needs: hls.js must drive it, and the outgoing element must have a
frame up to hold. It does not ask the outgoing source to be a manifest, which
is a fact about media the hold never touches, so a switch out of Direct Play
is held like any other.

The teardown path blanks the element, because hls.js is handed a MediaSource
object URL and attaching a new one resets whatever was showing. That leaves the
element at `readyState` 0 with nothing buffered and `paused` false — trying to
play with no media — for as long as the node takes to build the replacement.

Instead the outgoing element stays where it is, paused on its last frame, while
the replacement is prepared beside it and swapped in once it can present the
requested position. The replacement is loaded from the generation's own start
and then seeked to the offset, which is what the teardown path does, so the
origin rules are the same ones.

This is not the same as continuing to *play* the outgoing generation while the
replacement prepares. That was tried and rejected: the viewer watches the
previous scene while the clock reads the destination, which is a worse lie than
the interruption it avoids. A frozen frame claims nothing.

**The pause is taken by the control, not by the player.** Core tells a player
nothing about a relocation until `play()`, which is a whole negotiation later,
so `PlayerScreen` freezes the picture the instant a seek is committed and it is
released by whichever path core then takes: a target inside the buffer reaches
`player.seek()` synchronously and the hold is undone in the same tick without
reaching a frame; a target outside it carries the freeze through to the swap; a
refused seek releases immediately.

**A deliberate hold must stand down the stall watchdog.** A countdown measuring
"nothing is moving" cannot distinguish a freeze the client asked for from a node
that has died, and left running it ends a held seek in a failure screen while
the node is still building. Core re-arms on the first report after playback
advances, so a node that dies during a hold is still judged the moment anyone is
waiting on it.

## Two things that catch people

**`display: none` does not stop buffering.** An unrendered element still
buffers; element visibility does not gate MSE.

**Tab visibility is a confound to record, not a settled mechanism.** It has
been measured both ways. On 2026-09-17 and 2026-09-20 a backgrounded tab sat at
`readyState` 0 with `networkState` 2 and no error while the node reclaimed an
idle pipeline, which fits Chrome throttling a background tab's timers and
hls.js driving its fragment loop on one. On 2026-09-21 hidden-tab starts
succeeded in 1.0-2.4 s and hidden playback ran at 24 fps with no drops.

`videoState()` therefore reports `document.hidden`, and any sample series taken
while investigating playback should record it. What the field must not do is
stand in for a diagnosis: a stall in a visible tab is a stall.
