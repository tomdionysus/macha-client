# Replacing a playing generation

How the Web player (`WebPlayer` in `src/platform/WebPlatform.ts`) swaps one
remux or transcode generation for another, on the same node or a different
one. A *generation* is one stream of a title from one node; each has its own
timeline, init segment and fragment boundaries, so two are never
interchangeable.

There are two cases:

- **Handover:** the viewer did not ask to move. The old generation keeps
  playing until the new one can take over at the same content position.
- **Relocation:** the viewer asked to move (a seek). The picture is held on
  its last frame until the new generation can show the new position.

Both prepare the replacement on a second, hidden media element. A handover that
declines or is abandoned falls back to the relocation hold, and a hold that
declines falls back to tearing down and rebuilding the one element.

Core calls `play(source, positionMs, startPaused, transition)`. The transition
is `relocate` for a seek or a first start, and `continue` for everything else:
a mode or quality change, a node move, a failover, a regenerated session, a
decode fallback.

## Why a second element

Direct Play survives a node change in place: the element plays a stable
same-origin URL and the Service Worker swaps the node behind it, because a
byte range of a file is the same from any node. A transformed generation is
different media, so that does not carry over.

In-place swaps do not work either. `hls.loadSource()` on a live instance
detaches the media and empties the buffer, and appending two generations to
one `SourceBuffer` would need a synthesised playlist and `changeType()` at
every quality change.

## What the player tells core

- **`holdsThroughLead`** (managed HLS): the player can keep the old picture
  playing, so core may hand it a negative position (see *Node moves*).
- **`needsProducedSource`** (native HLS): the player fails permanently on a
  playlist that is not ready, so core withholds the source until the node
  reports media produced.

## Handover

`handOverToSource`, when the transition is `continue`.

1. **Decide.** Both the old and new sources must be managed HLS, the player
   must be playing, not starting paused, and hold at least 3 s of buffer. A
   switch out of Direct Play is therefore never a handover.
2. **Take the clock offset.** The viewer's position on the old generation and
   the position core asks for on the new one are the same content;
   their difference converts between the two clocks.
3. **Prepare hidden.** Build a muted element with `display: none` and a second
   hls.js instance. Nothing is installed as active, so its listeners stay
   inert.
4. **Wait for the join to be buffered**, not for `canplay`. The join moves,
   because the old element keeps playing, so it is recomputed each turn. The
   replacement must also hold 5 s beyond it. `handoverJoinLost()` abandons the
   handover once the replacement is clearly not catching up (judged over 6 s,
   within a 25 s budget) and reports `resumeAtMs`, the viewer's live position,
   so the fallback never puts the viewer back.
5. **Seek the hidden element** to the join.
6. **Cut when the old element reaches the join**, in one synchronous block:
   mute old, show and unmute new, move the bookkeeping across, play new, pause
   old. The old instance is destroyed after the cut, never before.

If the old element stalls first, the cut is forced at once.

**Alignment must be exact.** Promoting the replacement at its own start would
replay whatever the viewer watched while it buffered.

**A failed generation is stopped where it fails and destroyed where it is
replaced.** `retireHls()` stops loading; the instance is destroyed only by the
teardown in `play()`, the cut in `promoteHandover()`, or `stop()`. Destroying
it earlier blanks the picture before anything can replace it.

### Node moves and the lead

Choosing a node calls core's `PlaybackRuntime.moveTo`: it builds a session on
the new node while the old one plays, activates it as `continue`, and releases
the old session at the cut. A refused move leaves the viewer where they were.

A node produces a generation from its start point onwards, so one requested at
the viewer's own position starts a start-up time behind them, and a slow node
never catches up. A move therefore asks for the viewer's position plus a
**lead**: the node's measured start cost plus core's `MOVE_LEAD_MARGIN_MS`.
Core grants a lead only to a `holdsThroughLead` player and never past the end
of the title.

The player then receives a negative position: the viewer is that far before
the new generation's start. `leadJoinStep()` waits, with no budget running,
until the viewer reaches it. If the old picture stops first, the cut goes to
the generation's start.

A change at the viewer's own position has no lead, and on a slow node its join
can lose the race and fall back to the hold.

## Relocation

`holdThroughRelocation`, for every `relocate` and for any `continue` whose
handover did not happen (a failover arrives this way). `canHoldThroughRelocation()`
requires only that hls.js drives the replacement and the old element has a
frame to hold, so a switch out of Direct Play is held too.

The old element stays paused on its last frame while the replacement is
prepared beside it, loaded from its start, seeked to the offset, and swapped
in. Tearing down instead would blank the picture for as long as the node takes
to start.

The old generation is not left *playing*: the viewer would watch the previous
scene under a clock showing the destination. A frozen frame claims nothing. It
is still a wait, of up to 20 s for the replacement's first fragment.

**The control takes the pause, not the player.** Core tells the player nothing
until `play()`, a whole negotiation later, so `PlayerScreen` freezes the
picture when a seek is committed. A seek inside the buffer undoes the freeze
in the same tick; one outside it carries the freeze through to the swap; a
refused seek releases it. For a relocation no control asked for,
`holdThroughRelocation` takes the pause itself.

**A deliberate hold stands the stall watchdog down.** A watchdog cannot tell a
requested freeze from a dead node. Core re-arms it once playback advances.

## Traps

- **`display: none` does not stop buffering.** Visibility does not gate MSE.
- **A hidden browser tab may defer media loading.** `videoState()` reports
  `document.hidden`; record it with any playback measurement, and do not treat
  it as a diagnosis.
