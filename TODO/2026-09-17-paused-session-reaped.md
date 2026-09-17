# A pause longer than the node's session idle budget kills the play session, and nothing checks

**2026-09-17. P0, reproduced live and verbatim.** Pause a title, leave it for
thirty minutes or more, press play: the buffer plays out and then the failure
screen reads

```
Macha endpoint http://10.35.1.50:7438 failed: Failed to fetch
```

Nothing between the pause and the resume asks the node whether the play session
still exists, and nothing re-creates it when it does not. The client spends a
minute retrying a session the server has already erased, spends its one
permitted hls.js network recovery on it, then fails the node over — and the
failover lands on the unreachable plain-http LAN address, which is the message
the viewer is given.

## The server erases the session at thirty minutes, by design

`streaming.session_idle_ms` defaults to **1800000 — thirty minutes exactly**,
and `fi-1` is deployed at the default (`/etc/macha/macha.yaml:176`, read on the
node 2026-09-17). The reaper in `src/playback.cpp` erases any session whose
`touched` is older than that budget, and the server's own comment is the
important half:

> Both clocks run from `touched`, so a client that is still talking to us — polling the session, PATCHing a plan — is never evicted by this; only one that created a session and never came back for the media is.

A paused client is exactly a client that stopped talking. hls.js fills its
bounded forward buffer, reaches `maxBufferLength`, and stops requesting; the
Direct Play worker's read-ahead is bounded the same way. Every fragment request
touches the session (`playback.cpp`, `touched`/`stream_touched` set together),
so the session survives only as long as the buffer is still filling — a minute
or so. After that the clock runs unopposed and the session is gone at thirty
minutes. **A pause longer than the idle budget is not a risk; it is a
certainty.**

A reaped session is indistinguishable from one that never existed:

| route | answer |
| --- | --- |
| `GET /api/v1/playback/sessions/<dead id>` | `404 not_found` — "playback session not found" |
| `GET /api/v1/playback/stream/<dead id>/…` | `404 not_found` — "stream not found" |

Both measured against `fi-1` on 2026-09-17.

### And it is not distinguishable from an ordinary end-of-plan 404 either

Measured side by side, same node, same run, both fetched from the page so the
capability token never left it — a segment past the end of the plan on a **live**
session against the same segment URL with the session id replaced by `ffff…ff`:

```
live, past end of plan   404  {"error":{"code":"not_found","message":"stream object not found"}}
dead session             404  {"error":{"code":"not_found","message":"stream not found"}}
```

Same status, same machine-readable `code`; one word of English apart. Nothing to
classify on — and it is moot anyway, because **the body never reaches the
adapter**. hls.js reports `response: { code: 404, text: "", url }` and leaves
`data.response.data` undefined, exactly as the note in `WebHlsPolicy.ts` already
says. Classification has to be on the status, and "is this session still alive"
has to be a separate question asked of the session route.

## What the client actually does, minute by minute

Reproduced on `https://ramaroja.macha.network`, Chrome, the episode from the
report — HEVC 10-bit 1920×960 in matroska, 5.1 AAC, negotiated to **video and
audio transcode over fMP4 HLS**. The play session was created on **`es-1`
(10.34.1.50)**, fronted by `ramaroja` through haproxy.

The thirty-minute wait was collapsed rather than served: the session was deleted
out from under the paused client with
`DELETE /api/v1/playback/sessions/<id>` on `es-1`, which leaves exactly the state
the reaper leaves. Everything after that is the client's own behaviour, unaided.

```
19:15:10  playback.web         pause-request
19:15:10  playback.coordinator pause-intent
          -- session deleted on es-1 (stands in for the 30 min reap) --
19:15:32  playback.web         resume-request        restartParkedHlsLoad + play
19:15:29..19:16:29             hls-error-nonfatal x9  (the 404s, retried blind)
19:16:01  playback.web         hls-error-fatal
19:16:01  playback.web         hls-recovery-network-start-load   <- budget spent
19:16:34  playback.web         hls-error-fatal
19:16:34  playback.coordinator source-failover-start
19:16:34  playback.coordinator source-failover-exhausted
19:16:34  playback.coordinator fatal
```

At the resume the element held 138.1 s–202.2 s buffered and was playing at
170.5 s: **~32 s of cache, played out, then 62 s of retries, then the failure
screen.** "Plays out its cache then fails" is precisely it.

Note the last line of the screen names **`10.35.1.50` (`fi-1`)**. The session
was on `es-1`. The viewer is shown a node that was never serving them — the
second half of the existing
[https-page-lands-on-an-http-node P0](2026-09-16-pause-fails-playback.md),
confirmed again here from the other direction.

## The cover is bigger than it looks, and core is already being told

A second run, instrumented to capture the hls.js error payloads rather than the
log summaries. Paused at 55.3 s with the buffer filled to 118.1 s — **62.8 s of
cover**. What the adapter received, verbatim:

```json
{"type":"networkError","details":"fragLoadError","fatal":false,
 "error":{"name":"Error","message":"HTTP Error 404 "},
 "level":0,"sn":33,"start":130.088,"duration":4.004,
 "url":".../playback/stream/<session>/<capability>/2/segment-000033.m4s",
 "response":{"code":404,"text":"","url":"..."}}
```

`response.code` is **404 on the non-fatal events**, so the status is available
from the first one. And the first one does not wait for the resume:

```
133423.4  playback.web         source-degraded              <- first 404, viewer still paused
133424.0  playback.coordinator source-degradation-evidence
133424.3  playback.coordinator alternate-preparation-start  <- a standby, on another node
137159.5  playback.web         resume-request               <- viewer presses play, 3.7 s later
137159.7  playback.coordinator play-intent
133424..157504  hls-error-nonfatal x6+, all sn:33, all response.code 404
165728.6  playback.web         hls-error-fatal
165728.7  playback.web         hls-recovery-network-start-load
```

hls.js was topping up its forward buffer during the pause, hit the reaped
session, and `isHlsNetworkDegradation` — evaluated before the `park-paused`
branch, and true for any network error that is not the 500 hold — reported it on
the degradation channel as kind `'stream'`. Core took it as endpoint evidence and
began preparing an alternate node **3.7 seconds before the viewer was back**.

So the recovery budget is 62.8 s of cover plus a 3.7 s head start, and the
evidence is already arriving on the right channel at the right moment. It is
spent on the wrong recovery — a standby elsewhere instead of a regeneration
here — purely because the kind says `'stream'`. `alternate-preparation-start` at
that moment is the line to make impossible.

Note the consequence for the 0.17.1 pause work: whatever kind replaces
`'stream'` here **will** be received while paused, because the degradation
channel is deliberately not gated by `park-paused`. On this evidence that is
right and should stay — the early warning is the valuable part.

## Where the client classifies, and where it does not

The web adapter classifies, but never from a status. Every `PlaybackSourceError`
it constructs passes a hardcoded kind literal, and `playbackFailureKindForStatus`
is neither imported nor called anywhere in this client. All in
`src/platform/WebPlatform.ts`:

| line | kind | raised by |
| --- | --- | --- |
| 615 | `stream` | native HLS first fragment not served |
| 636 | `stream` | Direct Play read-ahead worker failure |
| 1199 | `stream` | stall watchdog |
| 1269 | `stream` | **the 404 path** — "Web HLS network degradation" |
| 1296 | `media` | `fail-unbuffered` |
| 1332 | `stream` / `not-ready` | `fail-network`, ternary on `isHlsSegmentHold` |
| 1347 | `media` | `fail-media` |
| 1358 | `unknown` | `fail-terminal` |

So a change to core's status mapping alone does not reach the web. Two things
make that cheaper than it sounds: line 1332 is already the exact shape needed — a
status-derived kind (`not-ready`) that core must not treat as endpoint
evidence — and the raw hls.js payload, `response.code` included, is already the
third argument to the error at line 1269.

The client's only status discrimination today is `SEGMENT_NOT_READY_STATUS = 500`
in `src/platform/WebHlsPolicy.ts`, restated locally rather than imported.
`isHlsSessionGone` belongs beside `isHlsSegmentHold`, and must also be excluded
from `isHlsNetworkDegradation` so a reaped session stops being scored as node
health.

## Three defects, layered

1. **Nothing revalidates the session across a pause.** The 0.17.1 pause work was
   right that a pause must not be judged as a stall, and it stopped the client
   declaring a healthy node dead at seven seconds. It did not give the resume
   anything to check. `WebPlayer.resume()` restarts the parked load and asks the
   element to play; no layer asks the node whether the session is still there.

2. **A 404 on a fragment is read as a bad node.** It is not. `not_found` on a
   playback route is a statement about one session's existence, and the only
   correct response is to create a new one at the current position — the node
   answering it is fine, is the node that holds the title's pipeline, and is
   about to be excluded from the candidate list for having answered honestly.
   This is what converts a recoverable condition into a terminal one.

3. **The failover then lands on an http endpoint an https page cannot reach**,
   and reports that endpoint as the failure. Already recorded; this is another
   live instance of it.

## Where the fix belongs, and one thing it must not be

The decision is **core's** — every conceivable client pauses, and every one of
them faces a session reaped out from under it; none of that is browser
knowledge. The classification seam is this repo's, because the web adapter never
calls core's status mapping. Agreed with the `Macha Client Core` session
2026-09-17; it owns the core half and has confirmed the chain in its own source
(`playbackFailureKindForStatus(404)` returns `'stream'`;
`isEndpointRetryablePlaybackFailure` is true for `'stream'`; `failover()` calls
`recordEndpointFailure` as its first statement). Its sharper statement of the
defect is worth keeping: **core has no "regenerate here" verb** — every terminal
source error has exactly one exit, and that exit begins by condemning the node.

Core's half:

- A failure kind for "the node says this source is gone", not endpoint-retryable.
- A regenerate-in-place path on `ClusterPlaybackResolver` rather than only the
  coordinator, because two of the four clients never build a coordinator.
- An explicit branch for it in `degrade()`, which is what buys the 62.8 s.
- A resume probe — one `GET` of the session — but only as latency, never as
  correctness: the regeneration must be right without it.
- The terminal error carrying what started the failover.

This repo's half, once the kind exists:

- `isHlsSessionGone` beside `isHlsSegmentHold` in `WebHlsPolicy.ts`, 404 mapped
  onto the new kind.
- Excluded from `isHlsNetworkDegradation`, so it stops being scored as node
  health.
- Routed to both the degradation and failure channels with the new kind.
- Tests seen red first against the current code; the payload above is the
  fixture.

**Do not fix this with a keepalive.** Polling the session while paused would
hold it open, and the server is explicit that the transcode entitlement is held
by the session rather than by the pipeline:

> reclaiming the engine at pipeline_idle only makes an abandoned session cheap -- it goes on holding the slot until the session itself is erased, and with max_video_transcodes at 1 that closes the node to transcoding for the whole session_idle.

A viewer who pauses and walks away would pin the node's only video transcode
slot for as long as the tab is open. The reaping is correct behaviour and the
client should let it happen; what the client owes is to notice on the way back.

## Verified live against a linked core, 2026-09-17

Against `macha-ts` at `ce8b596` linked in place of the registry copy, `es-1`
(10.34.1.50) through a local dev server — haproxy and the mixed-scheme item
deliberately out of the picture. Paused at content position 222 s with **62.1 s
of cover**, session deleted, resumed.

```
17:16:31.719  playback.web          resume-request
17:16:31.749  playback.web          resume-started          plays on from buffer
17:16:34.115  playback.web          source-not-found        this repo's adapter
17:16:34.448  playback.api          session-gone            core's liveness probe
17:16:34.449  playback.coordinator  session-reaped-regenerating
17:16:34.611  playback.api          session-create
17:16:37.553  playback.api          session-created
17:16:37.565  playback.coordinator  session-regenerated
17:16:42.739  playback.web          media-playing
```

Same endpoint on both sides of the regeneration, `seekMs: 222093`. Zero
occurrences of `alternate-preparation-start`, `source-failover-start`,
`generation-exclusion-relaxed` or `source-terminal-failure`. First 404 to new
session created: **3.44 s**. The on-screen clock ran 3:42 → 4:52 continuously.

**Direct play was chosen for this title and the HLS path had to be forced** with
the player's MODE control. The episode from the report direct-plays in Chrome on
macOS; it only reaches this code when transcode is asked for.

**Raw `currentTime` is generation-local and will look like lost position.** It
read 13 after the swap against 51.9 before it. Nothing was lost — the content
position was 222 s throughout. Check the on-screen clock, not the element.

### What is still wrong: the cover is discarded one step before it is used

```
17:16:37.560  source-activate
17:16:37.580  media-emptied     <- 62 s of buffered video, gone
17:16:37.581  media-waiting     <- spinner
17:16:42.739  media-playing
```

**5.16 s of stall**, and a further 0.65 s wobble after it. At `source-activate`
the element still held everything from 51.9 to 114.1. Activation empties it and
starts the new generation cold, so the whole margin this design exists to
exploit is thrown away. The probe and regeneration were free; this is not.

The decision is *when* `source-activate` fires — immediately on `session-created`
rather than once the cover is nearly spent — and that is core's. Raised with the
`Macha Client Core` session. It is the difference between invisible and a five
second spinner, which is the difference between a fix and a better-behaved
version of the same complaint.

## The same fault reaches the viewer through Direct Play, differently and worse

Found 2026-09-17 after the managed-HLS half was proven. **This matters more than
it looks: the episode in the original report direct-plays in Chrome on macOS**,
and only reaches the HLS code when transcode is asked for explicitly. So the
default path on the reporting host does not exercise any of the fix above.

`retryableSourceStatus` in the read-ahead worker is `408 || 425 || 429 || >= 500`.
A 404 is in neither that set nor any other, so it fell through to the success
path: `preferSource(...)` and the response returned. **The media element was
handed the error envelope as though it were media.** It then raised a generic
`MediaError`, `webMediaElementFailure` mapped code 3 to `media` and code 4 to
`unsupported`, and neither is `not-found` — so a reaped Direct Play session
would still have failed terminally with no regeneration after core ships.

Proven by lifting `retryableSourceStatus` out of the shipped worker and
executing it: `retryableSourceStatus(404) === false`.

**The worker still does not splice an alternate over a 404, and must not.** That
invariant predates this and has a test (`does not splice an alternate over a
non-retryable HTTP response`); an early version of this change broke it and the
existing test caught it. The response travels exactly as before. What changed is
that the failure is now *reported*, carrying the status, so the client learns
what the node said instead of only that the media was unplayable.

An absent status stays absent, deliberately. No status means a transport failure
that never became a response — evidence about the node, to be failed over. A
`404` means this source is gone — to be re-created. Defaulting either way
collapses two different answers into one.

## To reproduce without waiting thirty minutes

1. Play anything the client negotiates to remux or transcode, and let it buffer.
2. Pause through the UI, not through the element.
3. `DELETE /api/v1/playback/sessions/<session id>` on the node that issued it
   (find it by trying the session route on each node; only the owner answers
   200).
4. Resume. Roughly 60 s later, the failure screen.
