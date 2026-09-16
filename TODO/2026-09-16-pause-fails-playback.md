# A paused generation is declared dead, and the failover that follows cannot succeed

Date: 2026-09-16

Status: the two client-side faults are fixed and unit-covered (2026-09-16); the
third is core's and is now the more important half, because it turns out to
explain a second symptom nobody had connected to this one. Indexed as a P0 in
`ACTIVE.md`. Reproduced three times in one session against the live cluster.

## The report

Pause a title. Some time later, still paused, the player shows

    Playback failed
    Macha endpoint http://10.35.1.50:7438 failed: Failed to fetch

Pressing play recovers. Reported by Tom from the client served at
`https://ramaroja.macha.network`.

## Environment for the reproduction

- Dev client on `http://localhost:5199`, `VITE_MACHA_SERVER=https://ramaroja.macha.network`
  (there is no Vite API proxy; `MACHA_API_TARGET` in `.env.local` is dead).
- `@machafoundation/core` 0.12.0 from npm (not a link). Server 0.43.0 on ramaroja.
- Chrome, hls.js path. Title `tmdb:episode:4430698` (Foundation S02E01),
  chooser picked transcode: video copy, audio transcode, fMP4.
- Signed in as `webclient`. Diagnostics read from `window.machaDiagnostics.snapshot()`.
- Cluster candidates as the client saw them: `https://ramaroja.macha.network`
  (configured) and `http://10.35.1.50:7438` (discovered). Health probe reported
  `reachable: 2, known: 2` throughout, because the dev machine is on that LAN.

## What happens, in two stages

### Stage 1: the paused generation is failed as if it had died

Three runs, all ending in `source-terminal-failure` and a failover, none of
them while the viewer wanted anything.

**Run B, the clean one.** Pause was pressed 230 ms after a buffer stall.

```
184599  warn   playback.web          media-waiting            (paused: false)
184655  warn   playback.web          hls-error-nonfatal       bufferStalledError
184829  info   playback.coordinator  pause-intent
184843  debug  playback.web          media-pause
191600  error  playback.web          source-stalled           "nothing arrived for 7s"
191601  error  playback.web          source-terminal-failure
191602  warn   playback.coordinator  source-failover-start
```

`source-stalled` fired 7001 ms after the last progress report *before* the
pause. That is `MEDIA_STALL_TIMEOUT_MS` counted from the last `note()`, straight
through the pause.

The mechanism, from the code:

- Core's `MediaStallWatchdog.note()` arms or restarts the countdown on every
  advancing report. Once armed it runs until the next `note()` restarts it or
  something disarms it.
- `WebPlayer.publish()` calls `note()` only while `!video.paused`. So a pause
  stops the restarts and leaves the countdown running.
- Core provides `MediaStallWatchdog.suspend()` for exactly this, documented as
  "Paused is not stalled: the viewer stopped it on purpose", and `note()` has a
  `resumed` branch so a node that died during the pause is still judged after
  resume. **The web player never calls it.** CodeGraph finds no `suspend` in
  this repo; `WebPlayer.pause()` bumps the play generation, tells the read-ahead
  worker, and pauses the element, and that is all.
- `watchForStall` is wired for every generation (`play()` line 658), hls.js and
  native alike, so every pause is exposed.

**Run A** (pause landed after the stall had already begun) is the same shape
with the pause out of the picture: segment 1 started loading at 3.6 s, never
arrived, `media-waiting` at 17.0 s, `source-stalled` at 24.0 s. It shows the
node was genuinely slow, which is what makes the pause case reachable in
practice: a viewer pauses because it is buffering.

**Run C** (healthy pause, no stall beforehand, tab confirmed `visible` at the
end of the run) did *not* fire the stall watchdog in the 13 s watched after the
pause, and I cannot say why from the code above; visibility during that 13 s
window was not recorded, and the deadline only banks visible time, so an
occluded window is the obvious candidate. Left open rather than explained
away. What Run C did show is the second way a pause dies:

```
510113  info   playback.coordinator  pause-intent
531318  error  playback.web          hls-error-fatal
531319  warn   playback.web          hls-recovery-network-start-load
...     warn   playback.web          hls-error-nonfatal   (x5 over the next 90 s)
640461  error  playback.web          hls-error-fatal
640461  error  playback.web          source-terminal-failure
640465  warn   playback.coordinator  source-failover-start
640465  warn   playback.cluster      generation-exclusion-relaxed
```

While paused, hls.js keeps loading to fill its forward buffer. This node's
segment production was slow enough (its own session POSTs answered 503 after
20 s and 34 s: "VOD planning timed out while loading video seek index" and
"timed out waiting for first fragmented-MP4 segment") that hls.js's bounded
network recovery ran out, the one permitted `restart-network` was spent, and
the second fatal went terminal. Two minutes into a pause, with nothing on
screen the viewer was waiting for, the generation was torn down.

### Stage 2: the failover cannot succeed, and its error is what the viewer sees

Once the generation is failed, `recoverFromSourceFailure` asks
`ClusterPlaybackResolver.failover()`, which excludes the failed node. The only
other candidate is the discovered LAN address `http://10.35.1.50:7438`.

- From Tom's client at `https://ramaroja.macha.network`, a fetch to a plain-http
  LAN address is blocked as mixed content. The browser reports that as
  `TypeError: Failed to fetch`, `endpointFailure()` wraps it as
  `Macha endpoint http://10.35.1.50:7438 failed: Failed to fetch`, and that is
  the message on the screen. The same address is unreachable from outside the
  LAN for the ordinary reason too.
- From the dev client on the LAN the node *is* reachable, and the POST simply
  took longer than the 12 s generation deadline (it answered 503 at 20 s), so
  the same screen read `Playback generation attempt exceeded 12000 ms`.

Either way `source-failover-exhausted` follows and `failTerminal` shows the
*last endpoint's* error, so the message names a node that was never serving
the title and says nothing about the stall or the pause that started it.

Pressing play recovers because `PlaybackRuntime.setPaused(false)` on a
`failed` lifecycle is an explicit `retry()`: a fresh coordinator, a fresh
candidate walk with no exclusions, and ramaroja answers.

## What this is not

- Not a server request made on pause. `PlaybackCoordinator.setPaused()` is
  local only; the "Pause: confirmed not applicable" note in the any-node
  failover section was correct about that and wrong about the conclusion.
- Not the tab being hidden. Run B's timing is exact to the millisecond of the
  watchdog budget. Tom's requirement stands regardless: a pause must hold
  indefinitely whether or not the tab has focus.

## A second symptom, same second stage

Reported by Tom while this was being fixed: **"random 'Failed to fetch' in a
running stream which resolves if you press play."** Not a pause at all, and it
is the same stage 2.

Stage 1 is only one of several doors into a failover. A stall, a fatal hls.js
error, a premature source end — any of them hands the coordinator a generation
to replace, which is correct and is the feature working. What follows is
identical every time: the failed node is excluded, the only remaining candidate
is the discovered plain-http LAN address, an https page cannot fetch it, and the
viewer gets a failure screen naming a node that was never serving them. Play
recovers because it is a fresh candidate walk with no exclusions.

So the client-side fixes below remove the *pause* door. They do nothing for this
one, and cannot: while playing, failing over off a stalled node is the right
call. What is wrong is that the cluster offers a candidate this host has no way
of reaching, and says "Failed to fetch" when it turns out it cannot.

**That makes item 3 the load-bearing one.** It was written up as the tail of a
pause bug; it is actually the common cause of both symptoms and the only one a
viewer meets during ordinary playback.

## What was fixed, client-side

Both changes are in `WebPlatform.ts`, and both say the same thing in different
places: a judgement about whether a node is failing the viewer may only be made
while there is a viewer to fail.

1. **`WebPlayer.pause()` calls `stallWatchdog.suspend()`.** Core already had the
   method and the other half of it — `note()`'s `resumed` branch re-arms on the
   first report after a resume — so a node that dies mid-pause is still judged
   the moment anyone waits on it again. Stood down, not switched off.
2. **A fatal hls.js error raised while paused parks the load instead of being
   judged.** The decision is in `managedHlsErrorAction`, which gained a
   `viewerWaiting` argument (defaulting to true, so an unconsidered caller gets
   the judging behaviour) and a new `park-paused` action. `WebPlayer` answers it
   with `hls.stopLoad()` and a flag that `resume()` clears by calling
   `hls.startLoad(video.currentTime)` before it asks the element to play. No
   budget is spent, nothing is torn down, and the error — if it is still true —
   is met again with the viewer present.

   Deliberately every fatal class, not just the network one. And deliberately
   keyed on `wantsPlayback` rather than `video.paused`: between a play request
   and the element actually running, `video.paused` is still true while the
   viewer is very much waiting, and that window is exactly when a node refusing
   the stream must be judged rather than excused.

**Tests, each seen red against the unfixed code first.** In
`WebPlatform.test.ts`, "holds a pause indefinitely rather than deciding the
source died" fails with the live message verbatim, `Playback stopped and nothing
arrived for 7s.`; "judges the node again from the moment playback resumes"
covers the opposite error of disabling the watchdog outright. In
`WebHlsPolicy.test.ts`, two cases cover parking every fatal class, leaving the
budget untouched for the resume, and still ignoring nonfatal errors.

## What is still open

- [ ] **Core: an http endpoint is not a failover candidate from an https page.**
      See the second symptom above; this is the one that matters. Same
      constraint as the P1 "https deployment against http nodes" entry, which
      covers the read-ahead worker and not this.
- [ ] **Core: the terminal error should carry the failure that started the
      failover**, not the last endpoint tried. Today the screen blames a node
      that was never serving the title, which is what sent this investigation to
      the wrong place to begin with.
## Verified live, 2026-09-16

Dev client against ramaroja (server 0.43.0), hls.js path, same episode, same
transcode instruction as the failures above.

**`document.visibilityState` confirmed `visible` throughout, and
`document.hasFocus()` was `false` for the first half of the pause.** That is the
condition Tom set — a pause must hold whether or not the tab has focus — and it
is the confound that made the first attempt worthless: with the window occluded
the element sat at `readyState 0` for over a minute and the watchdogs banked no
time at all, so nothing was being tested.

| Measurement | Value |
|---|---|
| Paused at | 43.6 s |
| Held paused | 138 s |
| Warnings or errors in that window | 0 |
| Buffered frontier, pause start to end | 79 s to 165 s |
| Position after resume | 55.2 s |

The old code failed this at 7 s. The buffer figure is the second half of the
result: parking only happens on a fatal error, so an ordinary pause still fills
its forward buffer exactly as the design comment promises, and the resume was
instant rather than a reload.

Resume logged `play-intent`, `media-play`, `media-playing`, `resume-started` and
nothing else. No stall, no failover, no fatal.

**Not covered by this run:** a node that actually dies mid-pause. The re-arm on
resume is unit-covered, and exercising it live means stopping a node at the
right moment.

## Two things deliberately not changed

**The start watchdog is left alone.** `MediaStartWatchdog` fires at 20 s of
visible time against a source that never delivered a byte, and it is armed for
element-owned fetches whether or not the element is paused — so a generation
attached paused (a failover completing, or a seek, while the viewer had paused)
that never receives anything is judged the same way. Observed directly: with the
stall watchdog suspended, the first version of the pause test failed instead on
`The stream delivered no data in 20s.`

It is left as it is for two reasons. In practice `preload="auto"` means a paused
element still fetches, so the window is narrow. And the obvious fix is wrong:
core exposes only `stop()`/`start()`, not a suspend that remembers whether bytes
ever arrived, so re-arming on resume would start a fresh 20 s budget against an
element that resumes from a full buffer and may not fire `progress` for longer
than that — turning a working resume into a false failure. Worth a core seam,
not a client workaround.

**Degradation while paused still prepares a standby.** A non-fatal network error
while paused still reaches `degradeSourceGeneration`, so core may prepare an
alternate that expires unused during a long pause. Parking bounds it — once the
load stops, no further errors arrive — and the cost is a session held briefly on
another node rather than a viewer-visible fault. Noted rather than changed.

## Evidence trail

Raw entries are in the browser's diagnostics buffer for the session in which
this was found and are summarised above; `generation-attempt-failed`,
`source-failover-exhausted` and both 503 bodies were read from
`window.machaDiagnostics.snapshot()` directly.
