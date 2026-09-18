# A keyframe index would make every seek exact, and it is nearly free

2026-09-18. Written after a night of measuring seek alignment against the
cluster. Blocked on the server exposing the data; recorded here because the
client is the thing that would use it.

> **Status, later the same day.** The alignment change this file anticipated has
> shipped in server 0.46.0: remux now snaps *backward* to the keyframe at or
> before the request and reports the remainder as `seek_offset_ms`, and
> transcode does not snap at all. The overshoot table below is therefore the old
> forward-snapping behaviour and no content is skipped any more. Everything this
> file argues for is unaffected — the client still cannot tell in advance
> whether a seek will be exact — but read the seek P0 in `ACTIVE.md` and the
> server's `2026-09-18-seek-does-what-it-is-told-plan.md` first.

## The finding

**The client has no keyframe data for the media it is playing, and neither
does core.** `MediaTechnicalProfile` carries `format`, `container`,
`durationMs`, `bitrate`, `sizeBytes` and `streams`, and nothing about sync
samples. Core models no `randomAccessPoints` or equivalent in its source or
its published types. Nothing in this repo has it either.

So every seek this client issues is blind. It names a millisecond, sends it,
and discovers afterwards how far the node had to travel to reach a keyframe it
can actually start a stream on.

## Why it matters — measured, not argued

Four generations created for a seek or a recovery on 2026-09-17/18, remux, one
episode of 3,951,957 ms, against `10.34.1.50` and `10.35.1.50`:

| requested (ms) | node started (ms) | overshoot (ms) |
| --- | --- | --- |
| 2,027,092.2 | 2,028,903 | +1,810.8 |
| 2,818,000 | 2,822,779 | +4,779 |
| 908,791.054 | 918,085 | +9,293.9 |
| 2,926,000 | 2,934,933 | +8,933 |
| 2,450,000 | 2,450,449 | +449 |

Same title, same modes, same nodes. The spread is 449 ms to 9.3 s and nothing
in the client can predict which it will get. The 9,293.9 ms case cost the
viewer about 9.1 s of film at a generation cut, measured two independent ways
(the handover's own join arithmetic, and a 100 ms sampler that knows nothing
of it, agreeing to within 0.2 s).

At the time these were measured the server aligned *forward* — to the first
indexed keyframe at or after the request — which silently removed the content
between. That behaviour is being changed (see
`2026-09-17-paused-session-reaped.md` and the `seek_ms` / `seek_offset_ms`
work), so the content loss goes away. **The blindness does not.** The client
still cannot tell, before asking, whether a seek will land exactly or several
seconds out.

## What the server already has

The server exposes the concept as `video_random_access_points` and states the
contract plainly: **ask for a position in that set and the offset is zero, in
both remux and transcode.** That is the opt-in to an exact, cheap seek, and
the client cannot currently take it because it does not know where those
points are.

The server derives them from the demuxer's index at open time — libavformat's
`AVIndexEntry` with the keyframe flag — so this is serialising a structure it
already holds, not computing a new one.

## The cost, estimated

3 h = 10,800 s, bracketed by keyframe density:

| interval | count | JSON absolute ms | JSON deltas | binary u32 |
| --- | --- | --- | --- | --- |
| 2 s | 5,400 | ~48 KB | ~32 KB | ~21 KB |
| 5 s | 2,160 | ~19 KB | ~13 KB | ~8.6 KB |
| 10 s | 1,080 | ~9.7 KB | ~6.5 KB | ~4.3 KB |

Gzip roughly halves the JSON, so the densest realistic case is ~20–25 KB on
the wire. One 4 s segment at Original quality on this library runs to a couple
of megabytes, which makes the whole index for a three-hour film **one to two
percent of a single segment** — and unlike a segment it is immutable per file,
so it is fetched once and cached indefinitely rather than per session.

The measured gaps above point at the 5–10 s rows for this content. Note those
are distances from an arbitrary point to the *next* keyframe rather than
intervals, and that statistic is biased toward longer gaps, so an interval
should not be read straight off it.

## Container support

**MP4/MOV — complete and immediate.** The `stss` sync sample table in `stbl`
names every sync sample; with `stts` it converts to timestamps. It lives in
`moov`, which the demuxer parses before it can play anything, so the list is
in memory already. About 4 bytes per entry. An absent `stss` means every
sample is a sync sample.

**MKV — quick, but possibly a subset.** The Cues element is the seek index and
`SeekHead` points at it, so it is one seek away even when written at the end.
But Matroska marks keyframes per block, in the SimpleBlock flags, and Cues are
not obliged to name all of them — muxers vary between cueing every video
keyframe, one per cluster, or on an interval. A provably complete list means
walking every cluster, which is reading the whole file.

**Incompleteness costs granularity, not correctness.** The contract is that a
position in the advertised set yields offset 0. A sparse Cues table means
fewer snap targets, every one of which still snaps exactly. It also means the
measured gaps above are an upper bound on the true GOP, which is why the
server is adding cue-density logging.

## What the client would do with it

- [ ] Snap a seek target to the nearest random access point at or before the
  requested position *before* sending it, so the generation begins exactly
  where the client asked and `seek_offset_ms` is zero. No content skipped, no
  re-plan on the node, and the node's seek fast path becomes reachable.
- [ ] Consider snapping the scrubber itself to those points while dragging,
  the way an editor snaps to cuts — the viewer lands on a frame the stream can
  actually start on, and the seek is exact by construction rather than by
  negotiation.
- [ ] Decide whether snapping is unconditional or a preference. Snapping
  backward by up to a GOP is invisible when the intent is "somewhere around
  here" and wrong when the intent is a precise frame; transcode can already
  serve an exact position at the cost of a decode pre-roll, so the expensive
  option should remain reachable.

## What it needs first, and it is not ours

- [ ] The server exposing the random access points for a title, on the
  technical profile or alongside it. Cacheable and immutable per file.
- [ ] Core modelling them, so the platform and the coordinator can read them.

Both are outside this repo. Nothing here is actionable until the first lands.

## Open questions

- Whether to ship the full set or a decimated one for very dense encodes. At
  2 s intervals a long film is ~48 KB of JSON, which is already negligible, so
  decimation is probably unnecessary complexity.
- Whether the set should be per title or per source file. A title with
  multiple sources (the player already offers `Source 1` / `Source 2`) has a
  different index per file, and the client picks the source.
- Whether a sparse index should be advertised as such, so the client knows its
  snap targets are coarse rather than assuming the content has a long GOP.
