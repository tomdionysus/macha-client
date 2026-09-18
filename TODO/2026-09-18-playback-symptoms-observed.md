# Playback symptoms observed, 2026-09-18

**Symptoms and measurements only. No causes, no mechanisms, no attributions.**
Three separate attempts at explaining these were wrong, one of them invented
outright, so this file deliberately records what was seen and nothing about
why. Add a cause here only once it has been demonstrated, and say how.

> **Causes since demonstrated are in the seek P0 in `ACTIVE.md`**, with how each
> was demonstrated; the contract they are judged against is the server's
> `2026-09-18-seek-does-what-it-is-told-plan.md`. Symptoms 1, 4 and 5 are
> attributed there, symptom 3 is core's, and symptom 2 remains unexplained. The
> measurements below are unchanged and stay the record.

## Environment

- Client `0.17.1` working tree, core linked from `macha-ts` at `6369f2c`.
- Nodes `10.34.1.50` and `10.35.1.50`, both server `0.46.0`.
- Media `tmdb:episode:7203311`, title duration 2,464.462 s.
- Foreground tab, `document.hidden` false in every sample. These are not the
  backgrounded-tab artefact described in
  `docs/seamless-generation-handover.md`.
- Sampling at 100 ms over the media element, plus the client's own log lines.

## 1. Timeline jumps with no user interaction

**Reported:** "odd jumping around the timeline (no user interaction)".

**Measured**, on one generation, remux, element duration 1,748.9 s:

| | |
| --- | --- |
| element duration | 1,748.9 s |
| title duration − element duration | 715.56 s |
| reported position − element `currentTime` | **733.68 s, constant** |
| difference | **18.12 s** |

Constant to two decimal places across 52 s of 100 ms samples. Cross-checked
directly: element at `currentTime` 180.48 computes to title 896.0 s, while the
readout showed 15:14 (914 s) and the scrubber sat at 914,000 ms. The displayed
playhead was **ahead** of the picture.

Not reproduced since. Two later generations measured clean:

| generation | `serverSeekMs` | title − duration | reported − `currentTime` |
| --- | --- | --- | --- |
| transcode | 1,500,000 | 1,499.96 | 1,499.06 |
| transcode | 1,235,000 | 1,235.000 | 1,234.902 |
| remux | 1,282,531 | not captured | not captured |

Both clean cases were **transcode**, which the server states is frame-accurate
with a zero offset, so neither could have exhibited the fault. The 18.12 s
case has not been reproduced and no payload was captured for it.

## 2. Freeze on seek: still video, audio continues

**Reported:** "The freezes happen on seeks with still video, but sound playing.
When the video catches up to the sound, it plays."

**Measured**, transcode, Original quality, HEVC 2160×1080, EAC3 5.1:

| | |
| --- | --- |
| generation duration | 968.5 s |
| generation origin (title − duration) | 1,495.962 s |
| element position at start | `currentTime` 0 |
| longest run with `webkitAudioDecodedByteCount` advancing and `webkitVideoDecodedByteCount` flat | **5.40 s** |
| span | `currentTime` 0.057 → 5.454 |
| video bytes decoded in that span | **0** |
| `readyState` throughout | 4 |
| `seeking` throughout | false |
| errors raised | none |

One such run in 511 samples. 184 scattered single-frame audio-only gaps also
occurred and are normal — video decodes in bursts. The 5.40 s run is
contiguous and is the only one.

The element was at `currentTime` 0, the generation's own start, so it had not
been seeked into the middle of the media.

**Not established:** whether the video track had no data at that position, had
data the decoder could not start from, or had data the decoder did not decode.
The reading that would separate these is per-track `SourceBuffer.buffered`
(the element's own `buffered` is the intersection) together with
`getVideoPlaybackQuality().totalVideoFrames`. Not taken.

## 3. Failure message does not match the recorded cause

**Reported:** the screen says "Playback failed: The node no longer has this
source, and the buffer has run out" — "and that's also not true."

**Recorded log sequence:**

```
283481  source-not-found (manifestLoadError)
283481  hls-error-fatal
283481  source-gone
291834  generation-attempt-failed: "Playback generation attempt exceeded 12000 ms"
291835  source-failover-exhausted  (10.35.1.50)
```

The presented message names a missing source and an exhausted buffer. The
terminal event was a generation attempt exceeding its budget, followed by
failover exhaustion.

## 4. Generation build time against the client's attempt budget

**Measured** `session-update` → `session-updated` round trips:

| | |
| --- | --- |
| seek to 1,500,000 | **13,433 ms** |
| seek to 1,235,000 | **10,422 ms** |
| client `generation-attempt` timeout | **12,000 ms** |

For comparison, on media `tmdb:episode:1747124` earlier the same night, a
session update was ~200 ms and a create ~1,407 ms.

## 5. Outgoing generation stops resolving before its replacement exists

**Measured**, twice:

| | seek A | seek B |
| --- | --- | --- |
| `session-update` | 82,369 | 193,539 |
| first `hls-error-nonfatal` on the outgoing generation | 84,021 | 194,323 |
| gap | **1,652 ms** | **784 ms** |
| `session-updated` | 95,802 | 203,961 |

The outgoing generation began failing roughly one to two seconds after the
PATCH, while its replacement was still being built. `readyState` reached 0 in
both cases.

## Still unverified from earlier work

`WebMediaTimeline.establishOrigin`'s non-zero branch has still never run
against a real non-zero offset. Every generation captured so far either had a
zero offset or was joined after creation.

**Superseded 2026-09-18.** It had run, on the generation in symptom 1, and it
produced a negative origin of −18,120 ms. Reproduced deterministically against
the current source rather than inferred; the figures and the mechanism are in
the seek P0 in `ACTIVE.md`.
