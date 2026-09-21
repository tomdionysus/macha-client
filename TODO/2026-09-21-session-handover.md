# 2026-09-21 — handover

Written at the end of a long session, in preparation for a context clear. It
records what is true, what is merely believed, and what is running on this
machine. Where something was measured, the measurement is here; where it was
inferred, it says so.

## Where the repo is

**0.18.0 is committed and pushed** (`5b8bff5` on `develop`), and **deployed
nowhere**. Every node still serves `index-NDVfpduh.js`, built at 14:37 against
core `648474d`, which predates everything below. The deploy procedure is
unchanged and is in `ACTIVE.md`: rsync `dist/` to all three nodes, additive,
never `--delete`.

The working tree after that commit contains only `TODO/ACTIVE.md` changes and
this file. `CLAUDE.local.md` and `basemind.toml` are untracked on purpose.

**Last local build**: `index-CXIMJJGN.js`, 633,577 bytes, `shasum`
`edf7e4ce4640`, against core `5077468` / dist `04554181bfba`. Markers re-read
in the minified bytes: `Bj=404,Ij=410`, `standby-preparation-refused` present,
no `playback/stream` string.

**Suite**: 461 tests, 56 files, green. Typecheck clean. `npm run build`
succeeds — core's session established today that the build, not the typecheck,
is the gate.

## What shipped in 0.18.0

The `CHANGELOG.md` entry is the authority; in one line each:

1. A node selector in the player, grouped by `nodeId`, sorted by name, pinning
   through core's `prefer()`. Switching costs **13.2 s of black**, measured.
2. A mode press no longer asks a node to copy audio this device cannot decode
   — the AC-3 fault, which cost most of the evening.
3. Keyboard seeking on the scrubber commits instead of moving the thumb alone.
4. A session holding no roles gets a sentence that leads with the remedy.
5. Timestamps presented in local with the zone named; Zulu everywhere else.

## Core, and what is waiting on it

Core is `5077468`, dist `04554181bfba`, verified with core's own
`npm run dist:hash`. After any core rebuild: **`npm run dev -- --force`**, or
the dev server keeps serving its pre-bundled copy — that ghost cost an hour
today.

- **`prefer()`** — adopted. `PinnedEndpointRegistry` is deleted;
  `preferredEndpointForNode` stays, because a viewer picks a node and
  `prefer()` names an endpoint.
- **`moveTo(endpointId)`** — landed in core, **not called**. Wiring
  `selectNode` to it removes the 13.2 s gap: it builds on the new node,
  promotes, then releases. This is the next feature-sized job.
- **`nodeId` population** — landed. **Verified live**: the node pills went
  from five to three, so one machine reachable at two addresses now appears
  once. **`useNodeIdentity` should therefore be deleted**; it was kept only
  until that was seen working, and it now has been.
- **`playbackFailureDetail(error)`** — available, not adopted. It would
  replace the failure screen's own cause-chain reconstruction.
- **Core's `stop()` fix** — verified on the wire: pressing stop now issues
  `DELETE /api/v1/playback/sessions/<id>`. Before today it silently dropped
  the close when its in-process map had lost the id, which is why fi-1 had
  24 creates and no expiries.

## The one open symptom, and four dead explanations

**A player sometimes sits at `readyState` 0 while the node's journal says it
served.** Intermittent, seen on both playback paths, and **no mechanism is
known**. Four candidates died today, each by measurement:

1. *The element is not on the proxy URL* — it is; the path segment is
   `__macha_direct_cache__` and I had grepped for the wrong string.
2. *The read-ahead worker never answers an open-ended range* — it answers
   `bytes=0-` with `206` in 46 ms; my probe had awaited a 1.76 GB body.
3. *The node never produces a first fragment* — es-1 served the stalled
   session's generations in 247 ms and 208 ms, and an instrumented AC-3
   remux took 48 ms.
4. *A backgrounded tab cannot start playback* — the strongest-looking one,
   and false. Hidden-tab starts succeed in 1.0-2.4 s at 6 s hidden, at 104 s
   hidden, and three times back to back; an already-playing stream in a
   hidden, unfocused tab runs at 24 fps with no drops. One window had three
   consecutive hidden starts fail at 25 s, 85 s and 56 s and nothing has
   reproduced it since.

**What is understood is the consequence**, and it deserves a fix of its own:
when a start does stall, the node reclaims the unstreamed session at 120 s
(`session reclaimed without ever being streamed idle_ms=120000`), the client
then meets a session that is gone, six `hls-error-nonfatal` escalate to fatal,
and it fails over — **condemning a node that behaved correctly**. A generation
that has never produced a byte should not be able to charge its node.

**Next step is instrumentation, not a fifth theory**: a recorder armed before
`src` is set, capturing the element's event sequence, `readyState` and
`networkState` per second, hls.js error payloads flattened to text, and
whether any request left the page.

## Facts about the cluster worth not rediscovering

- **Nodes and zones.** `corvus-fi-1` = `10.35.1.50`, EEST, advertises nothing
  ("behind CGNAT"). `corvus-es-1` = `10.34.1.50`, CEST, advertises
  `ramaroja.macha.network`. `corvus-gbni-1` = `10.44.1.50`, BST, advertises
  `macnessa.macha.network`. **This machine runs EEST**, which matches fi-1 and
  is an hour ahead of es-1 — that mismatch put every timestamp in one report
  an hour out today. Quote UTC.
- **Caps, read off each node's own `macha.yaml`**: `streaming.max_sessions` 64,
  `max_sessions_per_account` 32, `max_video_transcodes` **1**,
  `max_audio_transcodes` 4. The per-account cap is reachable here; the
  8-against-32 contradiction lives in the compiled defaults
  (`config.hpp:502`/`:540`) and bites only a node that sets neither.
- **Three different 429s**: `account_session_limit` (per-account cap, do not
  walk), `resource_limit` (node-wide session limit *and* both transcode
  limits), `too_many_sessions` / `try_later` (the auth session store and
  password rate limiting — a different subsystem). Match on the code.
- **The orphan theory is dead.** An abandoned session for the same media on
  the same node does not cause `playback_pipeline_start_failed`: es-1 built
  the second session while the first was still present and served it.
- **AC-3 copied into fMP4 stalls** and is the server's open question. This
  client cannot decode AC-3 in fMP4 at all —
  `MediaSource.isTypeSupported('audio/mp4; codecs="ac-3"')` is `false` — so
  the client-side half was asking for a copy it could never play, and that is
  fixed.

## What is running on this machine

- **`vite dev --host`** on `:5173`, started with `--force`. Log in the session
  scratchpad. Kill with `pkill -f "vite --host"`.
- **An SSH tunnel** `127.0.0.1:7438 → 10.44.1.50:7438` (gbni-1), which is what
  `MACHA_API_TARGET` in `.env.local` points the dev proxy at.
- **Chrome** with two tabs open on the dev server, driven through the
  extension. One of them holds a stopped player.
- The test account is `webclient`; the password is in `.env.local`.

## Other sessions

Core, the phone client, the television client and the server each run their
own session and were coordinated with all evening. Core is the channel that
reaches everyone. Open with them:

- **Server**: the AC-3 copy stall, and their journal now carries Zulu.
- **Phone**: failover reported not working at all on mobile, which supersedes
  their 2026-09-08 note.
- **All clients**: Tom's ruling that timestamps are presented in local and
  dealt in UTC everywhere else.
- **Parked on Tom's instruction**: segmented subtitles, where this client
  composes `segment-${index}.vtt` because the manifest states no names.

## A note on method, because it cost real time today

Four mechanisms were asserted and then disproved in one evening, all of them
read off a stalled player rather than measured. Two reached other sessions
before they were withdrawn. The pattern was always the same: one correlation,
generalised immediately, written up with more confidence than the evidence
carried. What worked, every time, was a measurement that could have come back
the other way — a codec probe, a first-chunk read, a hidden-versus-visible A/B.
Prefer those, and say "not established" in writing rather than in passing.
