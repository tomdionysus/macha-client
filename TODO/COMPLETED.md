# Completed and tested

Last updated: 2026-09-16

## A pause is no longer read as a dead node

2026-09-16. The client half of the P0 in
[a paused generation is declared dead](2026-09-16-pause-fails-playback.md),
which has the full timelines. Not the whole entry: the failover half is core's
and stays open, and a live re-measurement is still owed.

**The symptom.** Pause a title, leave it, and the player fails on its own with
`Macha endpoint http://10.35.1.50:7438 failed: Failed to fetch`. Play recovers.
Reproduced three times against the live cluster, client on core 0.12.0, server
0.43.0 on ramaroja, hls.js path, transcode with video copied.

**Two independent detectors were judging a node with nobody waiting on it.**

*The stall watchdog ran straight through the pause.* Core's
`MediaStallWatchdog` restarts its countdown on every advancing report and is
armed until something disarms it; `WebPlayer.publish()` reports only while
`!video.paused`. So pausing stops the restarts and leaves the countdown running.
Measured from the diagnostics buffer: `source-stalled` fired **7001 ms** after
the last report before the pause, which is the budget exactly. Core had built
`suspend()` for this case — "Paused is not stalled: the viewer stopped it on
purpose" — and the web player had never called it.

*hls.js exhausted its recovery budget while paused.* It keeps filling its
forward buffer through a pause, which is the intended design. On a node
producing segments slowly — its own session POSTs answered 503 after 20 s and
34 s, `VOD planning timed out while loading video seek index` and `timed out
waiting for first fragmented-MP4 segment` — the one permitted `restart-network`
was spent at 21 s into a pause and the next fatal error went terminal at 130 s.
A generation nothing was using, torn down.

**The fix, in one sentence each.** `pause()` now suspends the stall watchdog,
which core re-arms on the first report after the resume, so a node that dies
mid-pause is still judged the moment anyone waits on it again. And a fatal
hls.js error raised while paused now parks the load rather than being judged:
`managedHlsErrorAction` gained a `viewerWaiting` argument and a `park-paused`
action, `WebPlayer` answers it with `stopLoad()`, and `resume()` calls
`startLoad(video.currentTime)` before asking the element to play, so the same
error is met again with the viewer present and the budget intact.

Keyed on `wantsPlayback`, not `video.paused`. Between a play request and the
element actually running, `video.paused` is still true while the viewer is very
much waiting, and that window is precisely when a node refusing the stream must
be judged rather than excused.

**Seen failing first, in the shape that shipped.** "holds a pause indefinitely
rather than deciding the source died" fails against the unfixed player with the
live message verbatim — `Playback stopped and nothing arrived for 7s.` — and
"judges the node again from the moment playback resumes" covers the opposite
error of switching the watchdog off, asserting silence through the pause and
exactly one failure after the resume. Both confirmed red by removing the single
`suspend()` call from the finished code and running them again. Two policy tests
cover parking. 346 tests green, typecheck clean.

**Verified live the same day**, dev client against ramaroja on server 0.43.0,
hls.js path, same episode. Paused at 43.6 s and held for **138 s with zero
warnings or errors**, where the old code failed at 7 s; resumed cleanly to
55.2 s. `visibilityState` was confirmed `visible` throughout and `hasFocus()`
was `false` for the first half, which is the condition Tom set — a pause must
hold whether or not the tab has focus. The first attempt at this measurement was
worthless for exactly that reason: with the window occluded the element sat at
`readyState 0` and the watchdogs banked no time, the same confound recorded
under the `readyState 0` P0.

The buffered frontier moved from 79 s to 165 s across the pause, which is the
other half of the result: parking only happens on a fatal error, so an ordinary
pause still fills its forward buffer as the design comment promises and the
resume is instant rather than a reload. Not covered live: a node that actually
dies mid-pause, which needs a node stopped at the right moment; the re-arm is
unit-covered.

**One thing found on the way and left alone.** With the stall watchdog
suspended, the first version of the test failed instead on `The stream delivered
no data in 20s.` — the *start* watchdog, which is armed for element-owned
fetches regardless of pause. It is narrow in practice (`preload="auto"` means a
paused element still fetches) and the obvious fix is wrong: core exposes only
`stop()`/`start()`, so re-arming on resume would run a fresh 20 s budget against
an element resuming from a full buffer that may not fire `progress` inside it.
That is a core seam, not a client workaround. Recorded in the dated document.

## Same-origin endpoint discovery, and two Status corrections (client 0.16.0)

Released 2026-09-15. Raised by Tom in session rather than from `ACTIVE.md`, so
each section is written here with its measurements rather than moved.

### A client served from a Macha node should find it without being told

**The idea, as Tom put it:** if the SPA is served from the same host, the API
links automatically; if it is not there, the client shows the endpoint screen.

**The trap that decided the design.** `README.md` states the deployment
requirement — the web host must serve `index.html` for unknown application
paths, or a deep link never reaches React Router. So a host serving this bundle
and *not* running Macha answers `200` at `/api/v1/health`, with the application
shell. Core's `checkEndpointConfiguration` confirms on `response.ok` alone, so
every correctly-deployed Macha web host would have identified as a Macha node.
Status is not a usable signal; the body is.

**Measured against the deployed cluster before writing the check**, through the
`Macha Server` session, because reading the server's source has been wrong
twice on this project. The body was exactly `{"status":"ok"}` — 15 bytes, no
product field, no version, no custom header, no `Cache-Control`. Three states:
`ok` with 200, `starting` and `failed` with 503, answerable with no session and
no role because liveness is the first bearer-auth exemption. CORS headers
unconditional with `Allow-Origin: *`.

**The server change that followed.** Tom approved requesting a product marker;
server 0.42.1 adds `service: "macha"` in the single return that serves all
three states. `version` was removed and then reinstated by Tom's own decision,
taken against the stated objection that a version lets a scanner index
unpatched hosts rather than spray — recorded on the server side at
`health_response()`, in the test that used to forbid it, and in its changelog.
This client gates on `service` alone and never asserts on `version`.

**Verified live on all three nodes, 0.42.1:**
`{"service":"macha","status":"ok","version":"0.42.1"}`, and es-1 was caught
mid-restart serving `503 {"service":"macha","status":"starting"}` — the state
the client's predicate pairs, observed in production rather than asserted
against a fake.

**Seen failing first.** Against a naive status-only implementation, 6 of 14
tests go red, including the SPA-host case with exactly the expected diff
(`expected { status: 'ok', marked: false } to be undefined`). Green against the
real one.

**Not persisted.** The confirmed origin is seeded into the registry as
`environment`, like discovered membership, and never written where
`bootstrapEndpoints` is read from. Re-derived and re-confirmed on every cold
start. The open question below is whether that stays.

### Status: a normal topology was painted as a warning

`ClusterSummaryStatus.conditions` is `string[]` with no severity on the wire,
and `.cluster-conditions span` is amber. So "1 node accepts no inbound
connections" — a standing, intended state — read as a fault on every visit.
Now rendered in the neutral palette; anything unrecognised keeps the amber.
Matched on prose (`/\bno inbound connections\b/i`, count excluded because the
server counts the nodes), which is not good and is the server's to fix with a
severity if it ever earns a release.

### Status: inbound RPC capability, and two wrong derivations

**Both wrong answers were about the same confusion, and both were confidently
wrong about the one node the feature exists for.**

First: derive it from `api_endpoint`, matching core's discovery filter
character for character. Wrong — `api_endpoint` is the HTTP URL a *client*
dials and is published whenever the node's API is enabled; inbound capability
is whether *peers* can dial the RPC plane. `corvus-fi-1` reports
`inbound_capable: false` **while advertising** `http://10.35.1.50:7438`, a LAN
address usable inside that building and dead from anywhere else.

Second, after the first was corrected: explaining the failover pool with the
flag. Same error inverted — fi-1 is a discovered endpoint and a legitimate
failover target for a client on its own network.

**A server change was requested and then withdrawn.** Measured with the
`webclient` account (one `/api/v1/status` read, session revoked, `204`), 0.42.1
already reports per node: `inbound_capable`, `dialable`, `hosts_extents`, with
`_mode` variants, and `nodes_inbound_incapable` on the summary. Nothing was
needed. Core's `ClusterNodeStatus` does not declare these, so `inbound_capable`
is read through a narrow cast that goes when core adopts it.

The node page carries `Inbound RPC connections — Yes / No / —`, beside the RPC
address it belongs to. The em dash is a node that did not report the field,
which is not a No.

## Artwork caching, blank posters, the Users redesign and volume (client 0.15.0)

Released 2026-09-13. Each section below is the item as it stood in
`ACTIVE.md` when it was closed, with its measurements.

### Artwork caching: posters reload from scratch and the viewer waits

Raised by Tom 2026-09-13 as a P0 in its own right. His words: images "load
slowly, and when 'cached' they're just less slow. Changing anything or waiting
for a minute or two, and they all load from scratch again. It's crap." The
governing rule is [[never make the user wait]] — a poster the viewer has
already seen should never be fetched twice.

**The framing he set, which is the useful part:** *media posters are long-term
cache objects*. They are content-addressed and immutable — artwork is served by
id, any node serves the same bytes, and an artwork capability URL is a cluster
credential whose signature covers the id and expiry but never the host. Nothing
about a poster changes. So anything that re-fetches one is wrong, not slow.

### Measured 2026-09-13, against the whole cluster. Diagnosed and fixed.

Measured through the real client at `localhost:5173` signed in as `webclient`,
against all three nodes live. **Both suspects in the original writeup were
wrong, and the real cause is the host in the cache key.**

**The signature does not churn.** Two `/catalogue/items?type=movie` fetches a
second apart returned 418 artwork refs with **418 identical URLs and zero
changed**. `exp` is pinned to a UTC day boundary (`1789430400000` =
2026-09-15T00:00:00Z) and is the *same value for every artwork object in the
catalogue*. The comment at the top of `LazyArtwork.tsx` says the server
re-signs on every fetch; on the deployed cluster that is **no longer true**, and
`lastLoadedUrlById` is guarding a hazard that no longer exists in the form it
describes. That comment has been corrected; the guard itself stays, because a
mixed-version cluster is this client's normal operating condition and an older
node may still re-sign.

**Which build, because it was briefly disputed.** The nodes report
**0.40.0**, and 0.40.0 is the release the server session built day-bucketing
for — so the stable `exp` measured here *is* their bucketing, already deployed.
Core had relayed their source reading of `exp = unix_ms() + ttl`, millisecond
granularity and explicitly unbucketed, which contradicted this; the
contradiction was two different builds, not two different facts. Re-measured
2.6 hours after the first reading: `exp` **had not moved by one millisecond**
(1789430400000 on both macnessa and ramaroja, 836 refs each), which `now + ttl`
cannot produce. Whatever a client assumes about `exp`, measure it against the
deployed cluster rather than against the server's source.

**`Cache-Control` is already right, on every node.** A signed artwork 200
answers `cache-control: public, max-age=86400, immutable`, identically from
macnessa, inverbeg and ramaroja. **This needs no server involvement** — that
was Tom's crux question and the answer is no.

**What actually happens.** The host is part of the browser's cache key and the
signature is not. So:

1. `EndpointHealthMonitor` runs a probe cycle every **10 s**
   (`ENDPOINT_HEALTH_INTERVAL_MS = 10_000`) and calls
   `registry.evaluatePreferredSwap()`, which re-ranks on throughput, latency
   and capacity.
2. A swap moves the preferred node. Catalogue reads follow the new head, and
   `withAbsoluteArtworkUrls` stamps *that node's host* onto every signed
   artwork URL.
3. Every poster on screen is now a URL the browser has never seen, so every
   poster re-downloads — from a node whose copy the browser already holds
   under a different name.

Observed live: `preemptive-endpoint-swap` logged at 17:27:13, and in the same
window **29 posters re-fetched from `inverbeg` at 2.7–3.0 s each**. The proof
that nothing was actually missing — same artwork id, same `?exp&sig`, three
hosts:

| host | result |
| --- | --- |
| macnessa | 200, 29,987 B, **3 ms** (browser disk cache) |
| ramaroja | 200, 29,987 B, 135 ms |
| inverbeg | 200, 29,987 B, **923 ms** |

Byte-identical. The bytes were in the cache the whole time.

The irony worth keeping: the swap is chosen *for throughput*, and the swap
itself costs a full re-download of every visible poster. The measurement
behind "this node is faster" is about streaming media and says nothing about
which node's artwork the browser already has.

**A plain reload is fine.** 31 posters, identical URLs, **all 0 ms**. So
"reload from scratch" is not about page lifetime — it is the swap, on a 10 s
cadence, which is exactly Tom's "waiting for a minute or two".

**Where `lastLoadedUrlById` stands.** It does real work — 32 of 40 posters
still rendered from macnessa after the swap — but 29 requests still escaped to
inverbeg, and it dies on reload. Which subset escapes it (never-loaded lazy
images below the fold is the obvious candidate) is **not yet established and
should not be guessed at**; establish it before designing around it.

### The blank posters are the same root cause, 2026-09-13 — fix applied

Tom, looking at Movies: *"STILL MISSING POSTERS."* They were not missing, and
they were not slow. **They had loaded and were never painted.**

Established on the blank cards themselves, not inferred:

- `complete === true`, `naturalWidth === 500`, `naturalHeight === 750` on every
  visible image, at **every 250 ms sample from t=0** across a 12 s trace —
  33/33 visible images loaded, while the screen showed three of them blank.
- The bytes are real: fetched and decoded to a canvas, `Airplane!` measured
  mean luma 162 / stdDev 68 over a 68,338-byte JPEG. Not a blank image.
- Nothing is covering them: `elementFromPoint` at the centre of each blank box
  returns that card's own `<img>`, `visibility: visible`, `opacity: 1`, no
  transform, no filter, no clip, wrapper `overflow: visible`.

**What makes them appear is the tell.** Anything that dirties *paint* on the
element works — setting `outline`, appending a child. Anything that does not
re-raster leaves them blank — a 1 px scroll (compositor only), removing 185
sibling cards. So the image is resident and correct and Chrome never schedules
a raster for it.

**The trigger is ours, and it is the host churn above.** `CapabilityArtwork`
renders `<img key={url} …>`, so every preferred-endpoint swap changes `url`,
React destroys and recreates ~200 `<img>` elements at once, and ~200
simultaneous async decodes land with some paint invalidations dropped. One
cause, two symptoms: the re-download *and* the blank posters.

**Fix applied:** `decoding="async"` removed from the `CapabilityArtwork`
`<img>` (browser default `auto`). Before: blanks on most loads, a different
set each time. After: clean on repeated reloads and scrolling ~100 posters
through the grid. 44 files / 307 tests pass.

This is a treatment for the symptom. The cause is still the `key={url}` churn,
and the stable-host fix removes it — after which the `decoding` attribute is
worth revisiting rather than kept by superstition. `LegacyLazyArtwork` still
carries `decoding="async"` on the Blob path; the same hazard applies there in
principle but has not been observed, so it was left alone deliberately.

### Fixed — a sticky artwork host, and it now lives in core

The bytes were already cached correctly under `immutable`; the client kept
*renaming* them. So artwork now has its own host preference, independent of the
streaming endpoint: whichever node last served a poster successfully keeps
being asked, persisted in `localStorage` under `macha.artworkHost.v1`, and
`signedSources` orders the candidates by it.

It is expressed as an **ordering over URLs the cluster already offered**, not a
choice of node, and that is what makes it need no failure handling. A preferred
host that is down, cooling off or gone from the registry contributes no
candidate, so the ordinary order and the ordinary per-image failover apply
untouched — and a single artwork 404, a normal event while the replication P0
stands, is not read as evidence about the host. The preference follows success
only, so a genuine failover re-points it onto whatever actually answered.

Verified live, not just in tests: with the catalogue served by **macnessa**, a
preference forced to **ramaroja** put all 208 posters on ramaroja — the
preference beats the node that signed them, which is exactly the property that
survives a swap. Restored, a clean reload was **63/63 requests at 0 ms**, all
on one host. 45 files / 315 tests pass, typecheck clean.

`lastLoadedUrlById` stays, with its comment corrected: it guards the
*signature* (an older node that re-signs on every read), the host preference
guards the *host*, and the file now says which does which.

**Now in core, and this client's copy is gone.** Tom approved it and core
shipped `ArtworkHostPreference` with `MachaMediaApi.artworkUrls` promoting its
candidates, plus `MediaApi.noteArtworkLoaded?(url)`. `src/state/artworkHost.ts`
and its tests are deleted; `LazyArtwork` calls `api.noteArtworkLoaded?.(url)`
on load and nothing on error, and the ordering assertions went with the module
because they are core's to make. Core's version is better than the one it
replaced on two counts: the node base is recovered by splitting on
`/api/v1/catalogue/artwork/`, so a proxy-mounted node with a path prefix
survives, and the ordering is stable, so everything behind the promoted host
keeps the cluster's own ranking.

Re-verified live after the swap, same test as before: catalogue served by
macnessa, preference forced to ramaroja, all 208 posters on ramaroja.
Restored, a reload made **zero artwork requests at all** — not cache hits,
no requests — and every poster rendered. 44 files / 309 tests, typecheck clean,
`pretest` green again now core has rebuilt.

**The reasoning, which is Tom's and is worth keeping.** He asked why we cannot just index
artwork by the file sha256 — and the answer is that we already do everywhere we
control. `ArtworkRef.id` *is* the sha256, core's `artworkCache` is keyed on it,
and the URL path is already `/artwork/{sha256}`. The cache that was broken is
the platform's, which keys on the whole URL and which no client can re-key. So
the question was never "add a cache", it was **"why does the host vary at
all?"** — and the answer was: by accident. What stays here is only the `<img>`
failover, which is genuinely browser-shaped.

Related but distinct: the artwork *replication* P0 above is a server-side
availability fault, not a caching one. Do not conflate them.

### Do not work around the anonymous account's missing password

Raised by the server session 2026-09-13, unprompted, as a thing a client
might reasonably be tempted to do. Recorded so nobody tries it later.

On server 0.38.0, `PATCH /api/v1/users/me` needed only `media_viewer`, which
`anonymous` holds at genesis — so an anonymous session could set the anonymous
account's own password and get a token back. Combined with the mint path never
checking `allow_anonymous`, that turned an anonymous visit into a credentialed
login which survived anonymous access being switched off.

0.38.4 closes it: the anonymous account holds no credential at all (`kdf` 0),
`verify` refuses the username, and a password `PATCH` on it answers
`409 no_password` with `mutable.set_password: false` on the record.

**This also answers Tom's "the anonymous user has no password and one cannot
be set" — it is deliberate, not a fault.** The client now renders that from
the server's own `mutable` block (`AccountScreen`), the same rule the Users
screen already follows, rather than testing the username. An absent `mutable`
is treated as "this node does not say", not as a refusal.

- Never add a client path that sets a password on the anonymous account, and
  treat any code that `PATCH`es `/api/v1/users/me` as worth a second look.

### One small account-screen fault Tom found

Both raised 2026-09-13, both now closed.

- [x] The **Discard** button on edit user was styled wrongly (`UsersScreen`).
      Gone: the Users redesign below replaced in-row editing with a dialogue,
      whose Cancel is the shared modal's own control.
- [x] The **anonymous user has no password and one cannot be set** — answered
      by the server session: deliberate, and a security fix. See the P2 above.

### One UI design language: records listed compactly, edited in a dialogue

Tom, 2026-09-13, on Manage → Users: *"It should display the users and their
roles in a compact list, and allow editing in another dialogue. This is
actually true in a few places in client — this should be the single UI design
language."*

**Written down as the rule** in `docs/architecture.md`, beside the existing
ban on `alert`/`confirm`/`prompt`, so it is a stated convention and not one
screen's taste. In short: a row states what a record is and holds no inputs;
every mutation opens a dialogue that owns the form, the busy state and the
failure, and stays open when the server refuses; the row itself is the edit
control with secondary and destructive actions in its overflow menu; acts with
different consequences get different dialogues.

**Done — Users.** `UsersScreen` was the worst case: every account rendered a
permanently-open edit form, so a list of accounts was a stack of username
inputs, role checkboxes with descriptions, a password field and four buttons
each. It is now a compact row per account — name, a `You` tag, and the roles
in one line in canonical order — opening `Edit`, `Set a password` and `Remove`
dialogues. `FormModal` was added to `components/Modal.tsx` as the shared piece
so no screen hand-rolls a dialogue's actions row again. 27 tests, every
behaviour the old screen pinned carried over, and eight of them were watched
going red against deliberate breaks before being trusted green
([[see the check fail]]) — one of which caught a real inversion in the sort.

**Ordering, Tom 2026-09-13: root, then anonymous, then a faint divider, then
everyone else alphabetically.** Both halves read the server's `mutable` flags
rather than the two usernames, which is the rule this screen has followed
since it was written — the names are the server's to choose, and a client that
tested for them would pin the wrong accounts the moment they changed and pin
nothing at all on a deployment that names them differently.

- Protection is `mutable.rename === false`. Deliberately *not* `delete`, which
  is also withheld from the last `manage_users` holder and from your own
  account — sorting on that would pin whoever happens to be signed in.
- Root above anonymous is `mutable.set_password`. Anonymous is the account
  that can hold no credential at all (server 0.38.4 made that explicit:
  `409 no_password`, `set_password: false`), so "can hold a password" is what
  actually separates the superuser from the account that exists to be nobody.
  The alphabet gets this pair backwards, which is what the test pins.
- The divider is drawn only where both groups have members. A fresh install
  holding just the protected pair is the case that made that worth a test.

**Still to convert, in the same idiom:**

- [ ] **`ManageScreen`'s `UnmatchedReview`** is the other bad case and is
      worse than Users was: choosing "Review" expands a panel inside the list,
      which then expands `ManualMetadataForm` inside *itself*, with a
      `scrollIntoView` to compensate for the form appearing at the foot of a
      tall panel. The `scrollIntoView` is the tell — a dialogue needs no such
      compensation, because it is not somewhere else on the page.
- [ ] **`ManageScreen`'s `FileManager`** already opens a dialogue to create a
      folder, so it is half-converted; check the rest of its mutations follow.
- [ ] **Music playlists**, when the named-playlist UI is built (see the
      playlist item below). It should be born in this idiom rather than
      converted later — the entry already says to use `Modal`/`ConfirmModal`,
      and `FormModal` is now the more specific answer.

### Session lifetime: decided, and already built

**Tom's call, 2026-09-13: keep the token in `sessionStorage`, and check it on
client boot.** `localStorage` was the alternative and was not taken — a
30-day bearer token at rest outlives the tab that earned it. The accepted
consequence is that a new tab is a new `sessionStorage` and therefore signed
out; signing in has to be cheap rather than the session being long-lived.

**Nothing to build: core already does exactly this**, verified by reading
`@machafoundation/core`'s `SessionManager` rather than assumed.
`signIn` and `mintNow` both call `cacheSession`, which writes
`{token, expiresAtMs}` to `machaHost().ephemeralStorage` under
`macha-session`; `bootstrap` — `start()`'s entry point — loads it, checks the
expiry, validates it with `validateAnonymousSessionAnyNode` and adopts the
roles that validation returned, minting only when that fails. `signOut`
removes the key. This client supplies no storage override
(`configureMachaHost({ origin })` in `main.tsx:30`), so it inherits
`sessionStorage` on web. The signed-in token is cached the same way the
anonymous one is, so a **reload** keeps the account — it is only a new tab
that does not.

- [ ] Confirm on the set, during the same sitting as the login work below:
      sign in, reload, and check the account survives rather than dropping
      back to anonymous. Read rather than measured so far, and the signed-in
      reload is the path nobody has actually walked.

### `/api/v1/users` envelope, checked 2026-09-13

The server is changing `GET /api/v1/users` from `{"users": [...]}` to
`{"items": [...]}`, and asked about an accept-either shim it believed this
client had built. **It does not exist here, and never did.** Verified rather
than recalled: the only `api/v1` strings in `src` are a test fixture
(`test/fakeCluster.ts`) and two prose comments; every users call goes through
core's `UsersApi`, obtained from `createMachaServices` in
`app/useMachaServices.ts`. Core's `userList` already accepts a bare array,
`users` or `items`, so the envelope change is invisible here. If such a shim
exists it belongs to one of the other clients. Recorded so this does not come
back as an action for this repo.

### `root` and `manage_users`

**Answered: no, root does not keep `manage_users` permanently.** Tom, and not
this client's concern either way — the UI renders from the per-field
`mutable` block, so it states whatever the server decides without knowing the
rule. Recorded here only so nobody re-opens it.

### Volume moved out of core; `setVolume` stayed

**`VolumeStore` is this client's own, at `src/state/volume.ts`**, copied from
`@machafoundation/core` on Tom's authorisation and deleted from core once both
this client and Android TV held copies. The key is unchanged —
`macha.volume.v1.${clientId}` — so no viewer's volume was lost and no migration
was needed. All five import sites repointed; 45 files / 317 tests, typecheck
clean, `pretest` green against core's post-deletion build.

**Core keeps `PlaybackRuntime.setVolume`, and this is the part worth
remembering.** Core planned to delete it as "a one-line passthrough that only
existed to carry the member", and that premise was wrong twice over. It touches
`VolumeStore` nowhere — it is `this.player.setVolume?.(volume)`, delegating to
`Player.setVolume?`, which core keeps. And the advice that came with it, "call
your player adapter directly instead", was impossible: `PlaybackRuntime` holds
`private readonly player`, built internally by `platform.createPlayer()`, so no
client ever receives that reference. `PlayerScreen.tsx:276` would have been
left with no way to set volume at all.

The distinction that settles it, and Android TV stated it best by finding the
same fault from the other end: in their `usePlayerVolume.ts` the hook passes
`effective` to the runtime and `setting` to the store, four lines apart, because
**one applies a volume to the player and the other persists a viewer's
choice**. Same word, different concern.

**One behaviour was changed deliberately, and both clients changed it
together.** `Number('')` is `0`, and `0` is finite, so an empty stored entry was
read as a deliberate mute — the exact "comes up silent with nothing explaining
why" failure this store exists to prevent. `load()` now treats an empty or
whitespace-only entry as absent (`raw.trim() === ''` → 1) while a stored `0`
keeps meaning silence, because that is a choice a viewer made. The store was
copied faithfully first and the old behaviour recorded in a test before being
changed, so the move and the behaviour change are not the same commit.



Tom, 2026-09-13: *"Why does core carry anything to do with volume at all?"*
Raised with the `Macha NPM Core` session and both React Native clients on his
instruction — core owns the change, the other clients had to be told directly
rather than find out from a release.

Core carries four volume things and they are not equally defensible:

- **`VolumeStore` (`src/state/volume.ts`) — moves out, but as a copy per
  client, not a deletion.** 27 lines persisting a clamped 0–1 number to
  `macha.volume.v1.<clientId>`. Core has no internal consumer — `grep` across
  its tree outside the store's own file returns nothing — so core has no stake
  in it beyond exporting it.

  **Correction, 2026-09-13: "nobody uses it" was wrong.** The Android TV React
  Native client is a real second consumer — `MachaProvider.tsx:95` constructs
  it, `hooks/usePlayerVolume.ts` reads and writes it — wired that same day,
  plausibly after the grep that found it dead. So it moves as *each client owns
  its own*, which the per-client storage key already suits, and **both clients
  hold a local copy before core removes anything**. Deleting it as unused would
  break their build.
- **`Player.setVolume(volume)` — done, core `develop`, 2026-09-13.** Now
  optional, with `PlaybackRuntime.setVolume` forwarding via `?.`.
  Source-compatible for every existing implementation, so nothing here had to
  change: verified by running this client's own `typecheck` and full suite
  against it — 44 files, 307 tests, green. The evidence was stronger than the
  argument made for it: **all three** `Player` implementations in core satisfy
  the member with an empty body (`FakePlayer.ts:71`, and the local fakes in
  `PlaybackCoordinator.test.ts:45` and `PlaybackRuntime.test.ts:85`), plus
  `src/test/fakePlayer.ts` here. A required member that every real
  implementation satisfies with an empty body is the interface saying it is
  optional and not being believed.
- **`PlaybackRuntime.setVolume()`** is a one-line passthrough carrying the
  above. No opinion — it goes or stays with it.
- **`Platform.initialVolume?()` — keep.** Optional, and the seam by which a
  platform says "I do not do app volume, do not restore one". *Whether the
  host owns app-level volume* is the genuine cross-client fact, and it is the
  one both clients agree belongs in core.

**A television does not imply the set owns volume — that was this client's
mistake, 2026-09-13, and it is worth keeping.** `SamsungWebPlatform` returns 1
from `initialVolume()` because a Tizen widget has no meaningful per-app level.
That is evidence about *Samsung*, and it was generalised into "a television
owns volume", which is false for Android TV: `expo-video` is Media3 underneath
and exposes a real per-player volume independent of the set's. The remote's
keys drive the television's output stage and the app's 0–1 rides underneath
it, so both are real. A persisted app volume is meaningful there and
meaningless here — which is precisely why `initialVolume` exists, and precisely
what one host's truth must not be allowed to answer for another's. The claim
went into a core doc comment before it was caught; core has been asked to
correct it.

The boundary test ([[core versus client boundary]]) therefore gives
`initialVolume` yes, the rest no — but on the narrower ground that *some* hosts
own no app-level volume, not that none do.

**Core confirmed the three facts in its own tree rather than on my reading:**
`VolumeStore` has zero consumers inside core (only its own file and test
mention it), `Platform.initialVolume?()` was already optional, and
`setVolume` was required against three empty-bodied implementations.

- [ ] **`VolumeStore` is held, waiting on Tom, and that is right.** Core is in
      session with him and will not delete from a shared package on a relayed
      instruction — a cross-client deletion is his to authorise directly. He
      raised the question unprompted this morning, so a yes is likely, but
      nobody should act on a second-hand one.
- [x] Whether either RN client imports `VolumeStore`: **Android TV does, yes.**
      Answered 2026-09-13. The mobile client has not replied yet, so a third
      consumer is still possible.
- [ ] **Both clients take a local copy first, then core deletes** — in that
      order, so the store never exists nowhere for either of them. The two
      changes do not share a release.
- [ ] Worth reconsidering rather than assuming: with a second real consumer,
      "27 shared lines two clients both want" is a defensible reason to leave
      it in core. The original argument was that it was dead weight in a
      package that assumes no browser, and half of that is now false. Tom's
      call, on the corrected facts.
- [ ] **Steal the Android TV client's mute design when taking the copy.** They
      keep `{ effective, setting, muted }` where `setting` is what persists and
      never goes to 0 because of a mute; adjusting while muted unmutes, and
      unmuting from a 0 setting restores to an audible floor. This client has
      none of that. Writing 0 on mute makes the next launch come up silent with
      nothing explaining why — a bug this client would otherwise have shipped.
- [ ] `PlaybackRuntime.setVolume()` stays for now. Removing the passthrough
      would break this client's controller for no gain while the store is
      undecided; it can go with the store if the store goes.

## Matroska direct play, the login wall, and role-gated navigation (client 0.14.0)

### Matroska is claimed honestly, and it is worth 15% of the library

The container was excluded outright. The exclusion was written for a real
fault — the Samsung accepts Matroska and renders corrupt video — but the cause
was `matroska,webm` being read as WebM, and core now resolves a demuxer list to
one container family. It had become a falsified capability outliving its
reason, which is exactly what `SamsungWebPlatform`'s own policy comment warns
against.

`detectMatroskaSupport` does not take `canPlayType` at its word: it requires
the engine to **refuse** an impossible codec in the same container before
believing a yes — the discipline `hlsDeliveryProbe` already applies, and it
turns "this host's oracle lies" into something each host demonstrates about
itself rather than a name hardcoded in the client. Measured on Chrome 151:
`video/x-matroska; codecs="avc1.42E01E"` → `probably`, `codecs="zzzz.invalid"`
→ `""`.

Measured against 1004 items on gbni-1 with `scripts/playback-baseline.mjs`:

```
                                    before   after
direct     video:copy audio:copy      745  →   898
remux      video:copy audio:copy      153  →     0
transcode  (all three buckets)        106  →   106
```

Every one of the 153 was `container-not-playable` with both streams already
`copy`, and **no title in any other bucket moved** — the result to expect,
since `containerPlayable` is read only by the direct branch of
`choosePlaybackInstruction`. The 101 still transcoding are E-AC-3/TrueHD/DTS
that Chrome cannot decode, objected to per stream before direct play is reached.

### The login wall

For deployments where only registered users see media. `media_viewer` comes off
the `anonymous` account and the session arrives holding an empty role list.

The server met this halfway: it had conflated "no roles" with "anonymous
disabled" and refused the mint with `403 anonymous_disabled`, so the client
never received the list it needed. Fixed server-side in 0.38.4 —
`PasswordCredentialValidator::validate` read
`if (!user || user->roles.empty()) return disabled;`, one branch for two
unrelated states. `anonymous_disabled` now means only
`session.allow_anonymous: false` in `macha.yaml`.

Verified live against 0.38.4 on gbni-1: `POST /api/v1/session {}` → 201 with
`roles: []`; with that powerless token `GET /api/v1/session` 200,
`/api/v1/catalogue/items` **403**, `/api/v1/status` 200, `/api/v1/users/me`
**403**. Driving the real client: a cold start lands on `/login` with one
button and no "Browse as guest"; `/movies`, `/series`, `/manage/users`,
`/status` and `/` all bounce to it; `/settings/connection` renders.

Three things the wall gets right, each for a stated reason:

- **It never interrupts playback.** It is raised from a re-read of the session,
  and a re-read happens on every re-mint — which is what failover does. Tearing
  the player down would turn a node dying mid-film, the event this client exists
  to survive invisibly, into a black screen. Revoking a role bumps
  `credential_generation` and stops the stream at the server anyway.
- **Settings → Connection stays reachable, with a link to it.** It grants no
  media, only the ability to point the client elsewhere. Without it a viewer
  whose cluster stops granting roles can neither sign in nor leave, and on a
  television there is no address bar — which is the shape of the bootstrap
  lockout 0.13.0 shipped and needed a release to undo.
- **Unknown is not none.** An unanswered whoami must not read as a session with
  no privileges, or the wall flashes on every cold start.

### Role-gated navigation, and `view_status`

Every nav entry declares the role it is worth showing for, and the routes are
gated to match — hiding a link is not access control, because a bookmark, a
Back or the catch-all all reach a route with no nav involved. **Home is a
catalogue screen despite not looking like one**, and leaving it ungated is what
met an account without `media_viewer` with a wall of failures.

Status carries `view_status` (server 0.38.5) rather than borrowing `manager`.
Neither existing gate said "see the health of this cluster": `manager` took the
diagnostic screen from an ordinary viewer at the moment it earns its place, and
ungated showed it to a session granted nothing. Liveness, ranking, failover and
the connection gate all run off `/api/v1/health`, which needs no session and no
role, so withholding it costs the Status screen and nothing else.

### Account screen, menu and logout

- The identity **is** the control. It used to be an inert chip beside a `⋯`
  button: two targets for one idea, an icon that looked pressable and did
  nothing, and an extra D-pad stop to reach the half that worked.
- **"This ends the session everywhere" was false.** `logout()` is
  `DELETE /api/v1/session`, which revokes one token — verified by minting two
  sessions for one account and revoking one while the other kept answering 200.
  Signing out everywhere is what a password or role change does. The wording
  came from misreading core's "the revocation propagates to every node", which
  means the token cannot be used against a different node.
- A refusal is now stated in this client's words. `Could not start a session:
  401` describes the transport, not the situation. One message covers a wrong
  password and an unknown username alike, because the server answers those
  identically so nobody can enumerate accounts; anything that is not a refusal
  keeps its own wording.
- **A successful login no longer strands the viewer on the login screen.** The
  token is live at once but the roles are not, so `navigate` was judged against
  the session just replaced and bounced back — and nothing navigated again when
  the roles landed. Signing in returns them to the page that sent them there.
- No password control for an account that holds no credential, rendered from
  the server's `mutable.set_password` and never from the username. An absent
  block is "this node does not say", not a refusal.

### Session policy moved into core

`sessionPermits(roles, role)` and `sessionLockedOut(roles)` are core's, taking
`roles | undefined` rather than a value plus a `known` flag, so "unknown is not
none" holds by construction instead of per call site. Four clients now answer
it identically.

The whoami retry this client had built was **deleted rather than moved**: roles
already arrive with the token on both paths and core was discarding them — the
mint response states `roles`, and `validateAnonymousSession` was already calling
the whoami and reading only the status code. `SessionManager.roles` is populated
by whichever path produced the token, so there is no separate fetch to fail.

Also taken from core: `EndpointCandidate.ready` for the endpoint cooldown state,
replacing a `retryAt` vs `Date.now()` comparison that was correct only because
this application injects a wall clock into the registry.

## Accounts, roles and login (client 0.13.0, core 0.8.x)

The client can now sign in, show who it is, and manage accounts.

**Login** is core's, not the screen's: `LoginScreen` collects two fields and
`sessionManager.signIn()` exchanges them on the same route, with the same
response shape, as the anonymous mint. One session lifecycle, not two.
`signOut()` revokes server-side first (a request that can fail) and only then
clears locally (which cannot), because ending up still signed in after asking
to leave is the one outcome that must not happen.

**Identity** comes from `GET /api/v1/session`. On the 0.37.x nodes deployed at
the time it carried neither `user_id` nor `username`, so `useCurrentSession`
falls back to `GET /api/v1/users/me`. 0.38.0 added `user_id`, and `username`
arrived on 2026-09-13 — **the fallback can be deleted once every node reports
it** (see ACTIVE).

**Roles gate the navigation**, and the rule is that stated roles are literal:
a capability the server did not name is one the session does not have,
including role names this build has never seen. A node that cannot answer
leaves roles *unknown*, which is deliberately different from having none, so
sections that predate roles stay visible against an older node instead of the
navigation emptying for everyone. The one presentational special case Tom
sanctioned: a session belonging to the `anonymous` user shows a "Log in"
control rather than an account menu. Nothing mechanical keys off that name.

**The Users screen** renders every control from the server's own per-field
`mutable` block, never a name check, so `root` and `anonymous` lock correctly
without this client knowing anything about them. A roles lock caused by the
last-manager rule says so rather than greying out silently.

**Two bugs found by running it rather than reasoning about it.** The whoami
could fire before the session mint settled; `SessionManager.fetch` only
retries a 401 when it actually sent a token, so that request was answered 401,
returned as-is, and the roles were never read — leaving every privileged
section visible for the rest of the run. It had only ever worked by timing.
And `MachaUsersApi.list()` read `response.items` while the server sends
`{"users":[…]}`; reading an absent key yields `undefined`, which is not an
error anywhere downstream, so the screen rendered its heading and nothing else
and looked broken rather than reporting a bad answer.

**Not yet verified:** the Users screen against an account actually holding
`manage_users`, and none of this on a television. Both are in ACTIVE.

## Settings left Manage for its own top-level section

Settings is client-local configuration that no role gates, and grouping it
under a privileged section hid it from the people most likely to need it:
anyone who cannot reach a node has no roles either, and the endpoint list is
the one thing that would fix that. It is now a top-level route reached by a
cog beside the account marker, and Manage holds only Unmatched, Files and
Users. Old `/manage/settings` bookmarks redirect rather than falling through
to the catch-all, which would have read as the setting being lost.

The Samsung Return hierarchy was stale and its test caught it: Settings was
still treated as a child of Manage. Fixed, and the account, login and Users
routes were added to it — they had never been in it.

## A bootstrap lockout: saving an endpoint could never succeed

The connection form probed an unauthenticated `catalogue/status` before
saving, and counted an endpoint usable only on an OK response. Every node
answers that 401. Measured against three of Tom's nodes: zero endpoints
qualified, so none could be saved — and with no endpoint there is no session,
so nothing could ever validate one. A fresh install could not be configured.
Invisible to anyone whose endpoints come from build configuration, which is
why it survived.

**The probe is gone rather than repaired.** Reachability is not a question to
ask on a button press; it is a fact the client already maintains. The health
monitor probes every known node on a timer and the registry holds the answer,
and the session mint already walks candidates until one responds. Saving is
configuration, and the registry is built to tolerate dead endpoints. A bad
address now surfaces through the same unreachable path as a node that dies a
minute after being saved — the only path that could ever have reported that
case anyway.

Verified end to end 2026-09-13: typed `https://macnessa.macha.network` into
the form, saved, and the library loaded from it.

## Artwork fails over between nodes instead of vanishing

A poster whose signed capability URL would not load showed a blank card for
sixty seconds. It now tries the same capability on the next node immediately,
then the authenticated fetch.

The premise was verified against the live cluster rather than assumed: an
artwork capability is a **cluster** credential — the signature covers the
artwork id and expiry and never the host — so a capability signed by
`10.44.1.50` returned an identical 68725-byte JPEG from `.51` and from the
remote WAN node. An expired capability is re-hosted nowhere, since every node
would refuse it, but still leads the list because the browser may hold the
image cached under it.

`exp` is **unix milliseconds**, not seconds. That is unusual enough to be
worth stating: read as seconds it makes every live capability look long
expired, no alternate is ever offered, and the failover silently stops
existing while every test still passes. Settled three ways — the server signs
`unix_ms() + ttl`, and core's own parse classifies 41 live capability URLs
correctly — and pinned by a test.

Observed working 2026-09-13: on one page load, four capability failures
recovered on another node and twelve of twelve forced images loaded.

## Three cluster-health bugs in the session and probe paths

All three had the same shape: something that is not a node fault being
recorded as one, and costing endpoint ranking and playback failover.

- **A refused password marked every node unhealthy.** Signing in reused the
  any-node mint walk, which records a failure per endpoint on any error, so
  one mistyped password walked the cluster and marked all of it failed. A 401
  or 403 is a refusal and a cluster-wide answer: record success, stop walking.
  429 is deliberately excluded — a rate limit is worth trying elsewhere.
- **The same shape in session validation.** During a rolling upgrade a session
  minted by the older build carries a role vocabulary the new one refuses, so
  every route answers 403. Treated as a transport fault it marked every node
  unhealthy on the way to re-minting, at exactly the moment the cluster was
  already in flux.
- **The health probe's cache-buster repeated across reloads.** It was built
  from the monotonic clock, which restarts near zero on every page load. Two
  consecutive reloads measured 744 and 571; the first probe of any load lands
  in a band a few hundred wide and is re-entered every time, so a cache could
  answer a probe for a node that is gone — the exact failure the function
  exists to prevent, failing towards reporting a dead node healthy.

The rule that came out of it, now stated in core beside `MachaHost.now()`: a
duration goes through the host clock, an absolute instant stays on the wall
clock, and nothing converts between them.

## The web client is served on the LAN, and installed on the television

A dependency-free Node static host under systemd on `192.168.1.50`, serving
the release build on port 80 as `www-data` with `CAP_NET_BIND_SERVICE` rather
than as root. Deep links fall back to the app but a missing `/assets/` file
stays a 404, because answering that with HTML turns a broken deploy into a
confusing script error. Fingerprinted assets cache for a year; `index.html`
does not, since it is how a browser discovers new fingerprints. Path traversal
was probed in encoded, doubled and null-byte forms; nothing outside the served
directory is readable. Persistence verified by restart and by `kill -9`.

Checked before taking port 80: haproxy already holds 443 on that box and
certbot renews via DNS-01, so renewal is unaffected. Serving over plain HTTP
means the page is not a secure context, so the Direct Play read-ahead service
worker does not register — playback works, the read-ahead does not.

The Samsung build installed and launched on the set 2026-09-13 after
Developer Mode was re-enabled. **Nothing on it has been verified visually.**

## Samsung failover plays: a replacement asks for the carriage its generation was created with

Stopping the serving node mid-film on the Samsung produced a long black
screen and then *"No untried Macha playback endpoint remains"* — with three
healthy nodes in the cluster. The decisive observation was Tom's: at the point
of that error, selecting **Auto** resumed playback instantly from the same node
that had just starved.

**Cause.** `container` is not among a session's confirmed preferences, and
failover rebuilds a generation from exactly those (`completePreferences` →
`currentPreferences`). A set that had asked for MPEG-TS was therefore handed
**fMP4 by every replacement node** — the one carriage it cannot play. The PATCH
path already restated the container, with a comment naming this very failure;
the create path never did. That asymmetry was the whole fault, and it is what
the Auto recovery was pointing at: Auto is a PATCH.

**Fix.** `withRestatedSegmentContainer` in `@machafoundation/core` 0.6.3, shared by the
update path and `currentPreferences`, so failover *and* standby preparation ask
for the carriage the generation was created with. The regression test was
confirmed to fail against the pre-fix code with the exact container mismatch
before it was trusted.

**Verified on the set** by Tom, 2026-09-09: *"That works."*

**Two theories of mine that were wrong, kept so nobody re-raises them.**

*Segment holds.* The trail carries no `hls-native-first-fragment-held` line, so
no fragment was ever held — the nodes answered the readiness probe at once. The
theory was that a native HLS player, which has no retry policy this client can
reach, would see one `MEDIA_ERR_NETWORK` where hls.js rides out a `500
segment_not_ready`, charging a healthy node and walking the cluster. Plausible,
measurable, and false. What it produced is still right and still shipped:

- `WebPlayer.play()` asks the node for one byte of the first fragment before
  handing the element a native-HLS URL, through the same admission and hold
  path the player itself would use — honouring `Retry-After`, 30 s budget,
  stopping immediately on `503`/transport, which *is* node evidence
  (`awaitNativeHlsFirstFragment` in `WebPlatform.ts`).
- The element is emptied before that wait, so a failure still arriving from the
  generation being replaced cannot be billed to its replacement.
- `readFirstResponseBytes` no longer requires `response.body`. Chromium 47 has
  `fetch` and not response streams, so **every warm standby the Samsung ever
  prepared failed its own preflight and was discarded** — the set least able to
  afford a cold failover was the one guaranteed never to have an alternate
  ready. That was a genuine bug found only because the wrong theory sent
  someone to read that function.

*A wedged media element.* Two replacements sat at `HAVE_NOTHING` for the full
20 s starvation budget without fetching a byte, on a reused element, while a
plain `fetch` of each generation's own first fragment was served immediately.
That looked conclusive. It was the *carriage*: a native player handed fMP4 it
cannot decode fetches nothing and reports nothing, which is indistinguishable
from a wedged element from the outside. A change to discard the failed element
shipped on this theory, did not fix the fault, and was **removed at Tom's
request** on 2026-09-09 once the real cause was known. `WebPlatform.ts` no
longer contains it.

The lesson worth keeping: both theories were confirmed by checks that could not
have failed — one by a log line that never appeared, one by an observation that
two different causes produce identically.

## Android TV has been run on a real television, and it plays

The Android target had never been launched on hardware; every browser-side
fault found on 2026-09-08 applied to it in principle and none had been observed
there. Run on the TCL 55B6B (Android 11, WebView 151.0.7922.199, adb over
`10.34.1.115:5555`) on 2026-09-09, with Tom at the screen:

- The APK installs and launches.
- Catalogue browsing and D-pad navigation work.
- Playback works. Stereo titles play correctly, start to finish.

Two changes came out of running it:

- **`forceNativeHls` is gone from `AndroidWebPlatform`.** It was set in the
  commit that first stood the Android target up (`0764d67`) and never
  justified; every written argument for forcing the native path in this
  codebase is about the Samsung's Chromium 47. WebView 151 has MediaSource, and
  the capability probe was already advertising `hlsFmp4` on that basis — so the
  client was asking for a container justified by a code path it then refused to
  take. Confirmed live afterwards: the log reads `hls-js-selected`. This also
  gives that target its first degradation channel, and therefore its first
  possibility of a warm standby.
- **The shell holds audio focus and keeps the screen on.** `MainActivity`
  requests `AUDIOFOCUS_GAIN` with `USAGE_MEDIA`/`CONTENT_TYPE_MOVIE`, abandons
  it in `onPause`, pauses the page's media on loss, and sets
  `FLAG_KEEP_SCREEN_ON`. Android WebView requests no audio focus of its own
  for HTML5 media, so nothing was asking.

**One fault found and not fixed:** 5.1 titles play without downmixing
correctly, and dialogue is what is lost. That is a live entry in `ACTIVE.md`
with the measurement behind it; the decision it needs is Tom's.

Note on the address: one now-removed `ACTIVE.md` entry recorded this set at
`10.34.1.116`. Everything above was measured against `10.34.1.115`, which is
also the address the two surviving entries use and the one adb answered on all
evening. `.116` looks like the typo, but nothing has been checked at `.116` to
prove it is not a second device.

## The media watchdogs moved into `@machafoundation/core`, and the budget says what it is calibrated against

`MediaStartWatchdog` and `MediaStallWatchdog` lived here, which meant the
platforms with the least introspection got the least recovery: `prepareAlternate`
is reachable only from `degrade()`, `degrade()` only from a player's optional
degradation events, and Samsung's native path has none. Both now live in
`@machafoundation/core` 0.7.0 with the environment injected as the first constructor
argument, and this client keeps only `src/platform/mediaWatchdogEnvironment.ts`
— the whole of the DOM in that mechanism. Each host wires them itself; they are
deliberately not wired into `PlaybackCoordinator`.

`note(positionMs, bufferedEndMs?)` takes buffering as **optional**, because
`expo-video` publishes a position and nothing trustworthy about buffered ranges,
and a fabricated zero would read as evidence about the node when the only
evidence is that a viewer is waiting.

The stall budget is **7 s**, and the number is derived rather than chosen:
`MEDIA_STALL_TIMEOUT_MS = SERVER_SEGMENT_HOLD_MS + 1_000`. A node holds a
request for a fragment it has not produced for `streaming.segment_timeout` —
6000 ms — before answering `500 segment_not_ready`. Expiring inside that window
judges a node that was about to deliver. The guard test asserts the
*relationship*, not the value, so it cannot drift back toward the 15 s it
started at without meeting the argument. Tom set 5 s, observed it was too short
in practice, and settled on 7 s.


## Samsung stops direct-playing files, and the last broken title plays

The set had no way to read ahead of a progressive file and never did: the
Service Worker byte-range proxy that does that job on the web cannot register
from a Tizen widget's `file://` origin, and MediaSource on Chromium 47 takes
fMP4 and WebM rather than an arbitrary MP4 or Matroska — which is the reason
the proxy exists rather than an MSE pipeline. Both doors shut, so direct play
there meant handing a television a 20 GB file and hoping its media element
buffered well.

`neverDirect: true` on `SamsungWebPlatform`'s policy hands it segments instead,
which is what a native HLS player is built to buffer. Across the library that
moves **540 titles from direct play into remux**: 847 of 890 now remux with
**both streams copied** into the MPEG-TS carriage this set already preferred —
a container rewrite, no re-encode, no quality lost. The 43 that transcode
needed to before.

Verified on the set (`10.44.1.183`, 0.11.0, operator at the screen):

- An ordinary previously-direct title plays, with a **fast** start.
- The player's top line reads `MPEG-TS : http://10.44.1.50:7438` with `REMUX`
  on both stream lines — carriage preference honoured, streams copied, and the
  endpoint rendered as a real URL.
- Two to three minutes unattended: **no stalls, no stutter**. This was the
  whole bet — whether the native player buffers a playlist better than the
  element buffered a file — and it does.
- **Seeking is near instant**, which was the predicted regression and did not
  materialise. Every seek past the buffer is now a `seekMs` PATCH and a new
  generation, and it still beat the byte-range path it replaced.
- **Ratatouille (`tmdb:movie:2062`) plays**, video transcoded and audio copied,
  slower to start but well within tolerance. That closes the last open Samsung
  title, and confirms the re-attribution made earlier the same day: the silent
  transcode was the server's 0.33.3 AAC defect, not an fMP4 carriage fault.

**Failover on this set is visible, and `neverDirect` did not cost that.** The
only silent path in the client is `promoteSilentDirectAlternate`, gated on
`mode === 'direct'` *and* on `addDirectSourceAlternative()` returning true —
which routes to the read-ahead worker and returns false without a Service
Worker. So it was already unreachable on Samsung for the same `file://` reason.
What the set does get is the reactive standby: an alternate generation created
and preflighted ahead of time, promoted by `play()` on an already-negotiated
session, resuming at position. A brief re-buffer, not a splice. Making it
seamless needs a second decoder, which the failover plan rejects for TVs that
have exactly one.

Still not settled, and deliberately: the "AAC transcoded, silent" row of the
fMP4 table. Ratatouille exercised E-AC-3 *copied into MPEG-TS*, not AAC
transcoded into fMP4, so that row needs a deliberate `preferSegmentContainer`
flip to test and nothing depends on it.

## Media bytes finally count toward endpoint throughput

`EndpointBandwidth` was fed exclusively by `readJsonBody()`, so its record
described catalogue payloads — the one kind of transfer whose speed nobody
cares about — while byte-range media, which is every byte a viewer waits on,
contributed nothing. Combined with `ClusterEndpointRouter` sending real work
only to the preferred endpoint, a node that served nothing but media had no
throughput evidence at all. That is how this client spent an afternoon
streaming from gbni-2, the deliberately flaky wireless node, at 0.31–0.58 MB/s
against gbni-1's 3.31 MB/s — and produced a whole set of "the transcode is
slow" measurements that were really "we picked the worst node".

- The Direct Play read-ahead worker already knew the answer. It tracks
  `fetchedBytes` and the origin it fetched from; it now also accumulates
  `fetchActiveMs`, the time spent *inside* fetches, opened on the 0 → 1
  active-fetch transition and closed on 1 → 0 so concurrent fetches count the
  period once rather than once each.
- **Transfer time, not wall time**, and that is the whole design. Dividing real
  bytes by wall clock would charge a fast link for every idle stretch — paused
  playback, a full cache — and report it as slow. The regression pins it: 8 MB
  arriving in one second after two minutes of quiet is 8 MB/s, not 0.07.
- The page reports deltas between messages, so each message contributes only
  new bytes and the first establishes a baseline. `setDirectPlayTransferListener`
  is injected from `App.tsx` next to the existing HTTP recorder — playback has
  no business reaching into cluster bookkeeping — and both share the same
  prefix attribution, since an endpoint id is its normalized base URL.
- A counter reset (the worker reconfiguring a source) needs no special case:
  it makes both deltas negative, and non-positive is already the "nothing to
  report" condition. An explicit reset guard was written first, then deleted
  when no test could distinguish it.

Covers Direct Play — 453 of 748 titles here. HLS segments are fetched inside
hls.js and remain out of reach. Note this only ever produces evidence for the
node being streamed *from*; comparing alternates is the core-side latency
change, which is what actually prevents a repeat.

Verified: `tsc --noEmit` clean, 34 files / 209 tests, 5 of them new.

## A held segment is no longer read as a failing node

Server change landing (implemented, deploy sequenced behind this): a fragment
or `init.mp4` that exists in the plan but has not been produced yet answers
`500 segment_not_ready` — the node working at the production frontier. A broken
generation is `503 stream_failed`. Without this, every hold was node evidence:
`isHlsNetworkDegradation()` was `data.type === 'networkError'` with no regard
to `fatal` or status, so a held fragment reached `PlaybackCoordinator.degrade()`
and prepared a standby session on another node — and `@machafoundation/core`'s default is
against us, since a `'stream'` failure *is* endpoint evidence, so failing to
classify is what causes the failover.

- Discriminated on the **HTTP status**, not the JSON error code, because the
  code is unreachable: hls.js's XHR loader (the default) reports a bad status
  as `{ code: xhr.status, text: xhr.statusText }` with `data.response.data`
  undefined, so the `{error:{code}}` body never reaches the error event. It
  exists only behind `data.networkDetails`, which is loader-specific and
  breaks under `FetchLoader`. The server adopted a status split for this
  reason — the discriminator had to be a field every loader populates alike.
- `isHlsSegmentHold()` (new) is true only for a `networkError` carrying 500.
  `isHlsNetworkDegradation()` now excludes it, so a hold prepares no standby.

**The status assignment is deliberately counter-intuitive, and the reasoning
is in the constant's comment so nobody "corrects" it back.** The obvious
reading is 503 for a hold — it is literally "temporarily unavailable" — and it
was specified that way, built that way here, and reversed before deploy. The
two mistakes are not the same size. 503 is what every proxy, gateway and load
balancer emits when a service is genuinely down, and none of them will ever
emit `segment_not_ready`; a client taught that 503 means "hold, stay on this
node" reads a dead node as a healthy one and never fails over — silent, not
self-correcting, and worst precisely where an intermediary makes it most
likely. Reading an infrastructure 500 as a hold costs one pointless retry.
Given that asymmetry the recoverable fault is the one to take, so the node
speaks the counter-intuitive dialect and intermediaries keep the intuitive
one. Not hypothetical: haproxy is installed and running on the WAN-facing
node, one configuration change from fronting it.
- A *fatal* network failure that was only ever holds reports the new core kind
  `'not-ready'` rather than `'stream'`, so the coordinator neither prepares a
  standby nor fails over — a replacement node would begin its own generation
  from nothing, which is slower than the one already being produced. The
  viewer still gets a stated failure rather than an endless spinner.
- The kind literal is guarded by the compiler (`PlaybackFailureKind` is a
  union), so no test is needed to catch a typo there.

**Telling a hold from a broken generation, live, from client data alone.** Both
arrive as `fragLoadError`; the status separates them and so does the timing,
and the timing is the check that needs no server access:

- A **not-ready refusal** arrives as **500**. It answers *immediately* when the
  request is beyond the hold window, and after the server's `segment_timeout_ms`
  (6000 ms as deployed) when it was genuinely held and expired. So timing
  separates those two, but **only the status separates not-ready from broken** —
  an early guess that "a hold is always slow" was wrong, and the first live
  500s observed came back in ~98 ms.
- A **broken generation** answers immediately — sub-100 ms — and arrives as
  **503**.

Read it off the retry cadence: hls.js's `errorRetry` backoff is 1s, 2s, 4s, 8s,
8s, so the interval between successive `hls-error-nonfatal` entries is that
backoff *plus* the response time. On 2026-09-08 a live incident showed
intervals of 1033, 2100, 4100, 8103 and 8094 ms — response times of 33–103 ms,
so nothing was ever held, and the 503 was a genuinely dead generation (an
unavailable extent had killed the libav pipeline mid-title). A hold would have
shown intervals above 7000 ms. That arithmetic was available before the wrong
hypothesis was sent, and checking it would have prevented the whole exchange.

Verified: `tsc --noEmit` clean, 33 files / 204 tests. The behaviour test
("keeps a hold out of node-health evidence while every other network error
stays in") was confirmed to fail against the pre-fix predicate. A second test
pins the reversal itself — an intermediary 503 stays node evidence — since
that is the property the whole assignment exists to protect and the one a
well-meaning future edit would break.

### Two hls.js facts established on the way, both correcting a plan

Read out of `node_modules/hls.js/dist/hls.js` at 1.6.18, because the
documented default is not the effective one:

- **The governing fragment deadline is `fragLoadPolicy.default
  .maxTimeToFirstByteMs: 10000`, not `fragLoadingTimeOut: 20000`.** The latter
  is deprecated and inert — the migration block only converts it when a *user
  config* sets it, and we set neither. The server had chosen a 12 s hold to sit
  "under hls.js's 20 s timeout"; at 12 s the hold answers two seconds after the
  client has already aborted, and converts into a `timeoutRetry` storm at 0 ms
  delay that never receives the 503 at all — strictly worse than what it
  replaced. Server hold is now 8000 ms.
- **`Retry-After` is inert on the fragment path.** hls.js reads that header in
  exactly one place: the content-steering manifest loader, on 429.

Also worth keeping: the XHR loader retries a bad status *internally* before
surfacing anything, so with `errorRetry` at 6 attempts and backoff capped at
8 s (`2^n * 1000`), a hold needs ~31 s of backoff plus six refusals before a
`fragLoadError` reaches the adapter. An earlier claim of mine that the degrade
bug would "fire constantly" was wrong and was corrected to both sessions.

## A source that never delivers a byte is now bounded, and says which side went quiet

The `readyState 0` P0 (see `ACTIVE.md`) is still open on cause. This is the
half that needed no cause: whatever was wrong, the client's *response* was to
wait forever.

Every deadline in the playback stack covered a server *request* — session POST
and PATCH, endpoint deadlines, the API layer's 8s bound, the HLS standby
preflight. The only timer in the whole web player was the preflight fetch for a
*standby*. Once `video.src` was assigned nothing watched the element, because
every failure and degradation channel is driven by something the element
*emits*: a `MediaError`, an hls.js error, a read-ahead worker failure. An
element sitting silently at `HAVE_NOTHING` emits none of those. So this fault
shape walked straight past the entire cluster-failover apparatus that exists
precisely for "this node is not delivering bytes" — failover was never broken,
nothing ever told it anything had happened. An unbounded wait, which
`docs/principles-and-laws.md` forbids outright.

- `src/platform/MediaStartWatchdog.ts` (new). Triggers on **zero bytes ever**,
  never on "slow": a media element fires `progress` as data arrives, well
  before `readyState` leaves `HAVE_NOTHING`, so a merely bad link — and one
  node here is deliberately across a saturated WAN — cancels the watch on its
  first few bytes and is never judged.
- **Only visible time counts.** Chromium throttles media loading in a
  backgrounded or occluded tab; a tab not loading because nobody is looking at
  it is the browser working correctly, not a node failing. That is the exact
  confound that invalidated the earlier investigation of this bug, so it is
  encoded rather than remembered. It also stops the client burning every
  candidate node to reach a fatal error screen on a tab the viewer had simply
  switched away from.
- Reported as a `'stream'` `PlaybackSourceError`, which
  `isEndpointRetryablePlaybackFailure` accepts, so the coordinator fails over
  onto another node. Deliberately a failure and not a degradation: a
  degradation prepares a standby, which for Direct Play resolves to a silent
  swap *inside* the read-ahead worker, and swapping bytes underneath an element
  that has not asked for any changes nothing. Only a fresh `play()` re-runs the
  media load algorithm.
- Watches only where the element owns the transfer (direct, native HLS). With
  hls.js driving, the element is fed an open MediaSource and hls.js owns its
  own already-bounded error channel.
- **It records the distinction that cost an evening.** On firing,
  `source-start-starved` carries a `dispatch` field read from the read-ahead
  worker's own counters: `renderer-never-dispatched` (the browser never asked)
  versus `dispatched-node-sent-nothing` (the node never answered). Those have
  nothing in common but the symptom, and page Resource Timing cannot tell them
  apart — it records only completed transfers, and never sees a Service
  Worker's cross-origin fetches at all.

Verified: `tsc --noEmit` clean, 33 files / 201 tests (from 32 / 191). The main
regression was confirmed to fail against the pre-fix code, not assumed to.
Live against gbni-1 with `document.visibilityState` confirmed `visible`
throughout: **15 real Direct Play playbacks, zero watchdog fires, zero stalls**,
time-to-first-frame flat at 1.3–2.4s — the false-positive risk is the one that
mattered, since a misfiring watchdog would be worse than the bug. Backgrounding
a playing tab for 35s produced no failover, degradation or stall.

**Not live-proven: the visibility guard itself.** Every live playback got bytes
promptly, so the watchdog was always disarmed before the tab could be hidden;
exercising that path needs a source that accepts a connection and sends
nothing, which cannot be manufactured against a healthy node. It rests on unit
coverage ("does not count time while the page is hidden").

## A baseline of which titles exercise which playback instruction

`scripts/playback-baseline.mjs` runs the real `choosePlaybackInstruction` over
the real facts endpoint for every catalogue item, so the buckets are what this
client would genuinely ask for rather than what a reimplementation guesses.
Capabilities are an input (`--caps`), as is host policy (`--policy samsung`),
so the same library can be bucketed for Chrome, for the Samsung's narrower
profile, or for a hypothetical device.

Against gbni-1 with live Chrome 151 capabilities, 748 of 770 items probed:

| instruction | count | representative |
| --- | --- | --- |
| `direct` copy/copy | 453 | A Clockwork Orange `tmdb:movie:185` (mp4, h264, aac) |
| `remux` copy/copy | 173 | Aliens `tmdb:movie:679` (matroska, hevc, aac) |
| `transcode` video copy / audio transcode | 115 | Django Unchained `tmdb:movie:68718` (matroska, h264, dts) |
| `transcode` video transcode / audio copy | **1** | Full Metal Jacket `tmdb:movie:600` (matroska, hevc 10-bit, aac) |
| `transcode` transcode/transcode | 6 | Ratatouille `tmdb:movie:2062` (matroska, hevc 10-bit, eac3) |

All four copy/transcode permutations exist in the library, so every branch of
the chooser has a real title behind it. Two are worth naming: the
video-transcode/audio-copy branch has exactly **one** title in 748, reached via
`video-transfer-not-presentable` (an HDR transfer Chrome will not present), so
it is the only test case for that path and should not be lost. And Ratatouille,
the open Samsung P1, is transcode/transcode here too.

## Four playback faults found by measuring the browser rather than reading it

An evening of web-client work, in which every one of these was invisible from
the code and obvious from an instrumented browser. Recorded together because
the method is the transferable part.

**The mini player flashed on every play, and the previous fix could not have
worked.** Presentation is chosen by the route; visibility comes from the
runtime; they were landing in different renders, so the player mounted as the
mini bar and swapped to full. The earlier fix reordered the two calls, which
achieves nothing: React Router publishes location changes inside
`React.startTransition`, putting them in a lower-priority lane than an
ordinary `setState`, so the runtime's update commits first whichever is called
first. `AppRouter` now sets `useTransitions={false}`. Reproduced first as
render pairs — `[false,false] → [true,FALSE] → [true,true]` with transitions,
`[false,false] → [true,true]` without — and the regression test fails when the
prop is removed, which was checked rather than assumed.

**An episode resumed from Continue Watching had no next or previous.** It
arrives with no queue, because no season screen was open to build one. The
season is now fetched *after* playback starts — holding the picture for a
round trip to populate two buttons pays for them with the thing the viewer
asked for — and only the queue this client started is ever widened.

**A stream Chrome could not parse retried for ever, silently.** hls.js answers
an append against an ended MediaSource by rebuilding it and trying again; when
the stream is unparseable that reaches the same wall every time. Measured: the
same 2.4 MB segment refetched **58 times in 46 seconds**, behind an unchanging
spinner, indefinitely, against a node that had to serve every one of them.
"Non-fatal" is a claim about recoverability, and repetition with nothing
buffered is the evidence against it, so non-fatal media errors raised while
the element has buffered nothing are now bounded. Same URL after: three
segment requests, then a stated failure. Network errors keep their own path —
those recover by moving to another node, which this client can do.

**The Direct and Remux controls could not work at all.** Pressing either
returned a server error about a request the client had not made. Captured off
the wire: the client sent `{"preferences":{"mode":"direct"}}` and nothing
else; the server merged it over the `audio: transcode` stored at session
creation and refused the combination it had assembled. Since the chooser's
usual answer for this library is transcode-with-the-video-copied, every
session began with an override in place, and the failed update tore the
session down and returned the viewer to the browse screen. The client now
states the whole transform on an explicit mode press rather than the shorthand
for it. Verified against gbni-1: direct accepted and playing a Matroska whole,
remux accepted. The merge itself was ruled a server defect and is being fixed
there; the explicit form is right under either behaviour, which is why it
stays.

### The one that needed bytes

Silo S03E01 would not play in Chrome at all. `isTypeSupported` returned true
for every codec string in the file, so no capability probe could have
predicted it. Bisecting the served `init.mp4` against a fresh MediaSource:

| appended | result |
| --- | --- |
| muxed init, as served | `CHUNK_DEMUXER_ERROR_APPEND_FAILED` |
| video track alone (HEVC, `hvcC` untouched) | parses, source stays open |
| audio track alone | parse failure |

Not the multiplexing and not HEVC — the AAC. Its `esds` carried a 26-byte
AudioSpecificConfig with **channelConfiguration 0**, meaning the layout is in
a Program Config Element, with the PCE inline and libavcodec's comment field
(`Lavc61.19.101`) sitting in the middle of a decoder config. Chrome will not
parse that; a normal 5.1 AAC-LC config is two bytes with channelConfiguration
6. Cause, server-side: an encoder change that kept the source's channel layout
rather than forcing stereo — right in principle — where E-AC-3 decodes to
5.1(**side**), which AAC has no standard configuration for. Fixed in server
0.33.3 and verified here independently of the server's own test, by reading
what the muxer wrote rather than asking the encoder:

```
init bytes 3818            (was 3839)
esds DecoderSpecificInfo   11 b0 56 e5 00     (was 26 bytes)
decoded                    aot 2, freq_idx 3, channel_config 6
playback                   currentTime 44 -> 48, audio decoded bytes
                           2,129,430 -> 2,323,246, 1,149 video frames
```

Audio bytes climbing is the assertion worth making: not that the browser
accepted the file, but that it decoded it.

### Also in this pass

- The served container (`output.container`, server 0.33.1) is on the player's
  top line, absent rather than defaulted when the server names none — this is
  the only place a segment container the client asked for and did not get can
  show, and a default would read as an answer.
- Samsung option rows centre their labels against their controls instead of a
  hand-set padding calibrated for a grid row that does not exist on Chromium
  47; the note takes its own line; the status lines got back the spacing their
  inert `gap` was supposed to give them. Verified by rendering the generated
  `samsung-tizen3.css` and measuring the offset: 0.0 px on all three rows.
- The Android host no longer states a version of its own. `versionCode`,
  `versionName` and the staged APK filename all derive from `package.json`; a
  frozen `versionCode 801` had been shipping 0.10.7 code labelled 0.8.1, and
  Android compares only that number.

## Samsung Tizen 3: HLS playback fixed by MPEG-TS segments, nothing re-encoded

Three titles failed differently on the QE55Q6FAM and all three now play, fast,
with both streams copied. The fix is one policy line —
`preferSegmentContainer: 'mpegts'` — on the native player, with **no codec
exclusions**.

Measured on the set, per stream, inside fMP4 segments:

| stream | native player | hls.js / MediaSource |
| --- | --- | --- |
| h264, copied | plays | — |
| HEVC, copied | black screen, time never advances | — |
| E-AC-3, copied | ~0.2s of sound every 10–20s | rejected outright |
| AAC, transcoded | no sound at all | plays |

**Amended 2026-09-08: the last row is probably not an fMP4 fault at all.**
These measurements were taken on 2026-09-07 (client 0.10.7, `d03786a`); the
server's 0.33.3 AAC fix was verified here a release later, in 0.11.0. So the
AAC transcode measured on this set was produced by the server *while it was
still emitting* the `channelConfiguration 0` esds with an inline PCE (see
"The one that needed bytes" above). Those titles carry 5.1 E-AC-3, so the
transcode exercised is exactly the path 0.33.3 fixed, and silence is a
plausible outcome of it. Filed here originally as carriage; more likely a
codec defect that has since been fixed. Not yet re-tested — the set's only
endpoint is `gbni-1`, which needs the server build first.

The rest of the table stands, and the container finding survives on it: HEVC
and E-AC-3 are **copied**, so no encoder runs and no encoder defect can
explain them.

Note the first row too. The diagnosis was written up mid-evening as "every
stream delivered as fMP4 fails", and that was over-generalised from three data
points: **h264 in fMP4 plays here perfectly well**. On the amendment above it
narrows once more, to HEVC video and copied E-AC-3. Worth keeping visible,
because the over-broad version was recorded as established and passed to two
other sessions before it was corrected — and the AAC row is the same mistake
caught a second time, by an operator who asked why a server audio fix and a
client audio symptom were being treated as unrelated.

Consistent with the hardware either way: a 2017 Tizen 3 panel whose native HLS
player was built for MPEG-TS, while fMP4 carriage of HEVC and the Dolby codecs
is the newer arrangement in the HLS spec. The same streams direct-play and
play progressively without complaint.

**Do not chase this with codec exclusions.** Tried twice, once on each
delivery path, and both times it moved the failure instead of removing it:
`excludeAudioCodecs: ['eac3']` forces the AAC transcode, and AAC through the
native fMP4 path is silent — stuttering audio traded for none. A policy
override states a device truth, and stating one at the wrong level narrows the
choice into a worse branch which the chooser then faithfully defends. It is
not fooled, it is obeying, and it will keep obeying.

**hls.js was tried and eliminated.** It fails both HLS titles outright, since
MediaSource here rejects E-AC-3. The one arrangement that worked was hls.js
with E-AC-3 excluded, forcing an AAC transcode — functional, but re-encoding
audio *and* HEVC that need no re-encoding, on every title, to work around a
carriage fault.

Four dead fields in `@machafoundation/core` fell out of the investigation, each
declared, consumed, silently defaulted, and populated by nobody: `operations`,
`hlsAudioCodecs`, `hlsTs` (also unreachable — `segmentContainer()` returned
`fmp4` before ever reading it), and the chooser's illegal `remux` + `audio:
transcode` pairing, which four existing tests had encoded as expected
behaviour. Hosts now supply the first two: `hlsDeliveryProbe` narrows the
element's codec lists by what the delivery path will actually accept, rather
than assuming the two agree. Where an input is genuinely missing the
instruction now says so, in `assumed`, and the player panel renders it.

Also eliminated on the way: a real server fMP4 muxer fault (segment 0 carried
20.812s while declaring 10.427s — fixed in 0.32.19, but not the cause); the
`hvc1`/`hev1` sample-entry hypothesis (the init segment carries `hvc1`, no
`hev1`); transcode-slot contention (none running).

## Samsung Tizen 3: the compatibility layer had silently stopped working

Live UAT on the TV (`10.44.1.183`, Tizen 3 / Chromium 47) surfaced a cluster
of defects with one cause. `vite.config.ts`'s `samsungCssCompatibility`
rewrote `var()`, `:focus-visible` and 8-digit hex only in emitted `.css`
assets — and with `renderModernChunks: false` the legacy build emits none:
the whole stylesheet is inlined into the JS chunk. So **170 custom-property
references and every `:focus-visible` shipped raw to an engine that supports
neither**, and nobody noticed because it is invisible anywhere but a TV.

- Downlevelling moved to a `transform` hook, which runs per stylesheet before
  Vite decides where to put it. (Rewriting the minified chunk was tried first
  and abandoned: `legacyRgba`'s `#abcd` pattern would corrupt a private field
  or URL fragment, and the string literal does not parse the way the minified
  output suggests.)
- The reported symptom was "Play all is white on white": its only background
  came from `var(--accent-surface-strong)`, so the declaration was dropped and
  the button fell back to the UA default. Now ships `rgba(38,0,7,.76)`.
- **Chromium 47 has neither CSS Grid nor flex `gap`.** All 119 `gap`
  declarations are inert there and every grid collapses. Margin fallbacks
  added for the status grids, player button row, option groups, volume
  control, play actions and settings cards. The "focus border draws over its
  neighbour" report was the same bug: zero gap puts focusable controls edge to
  edge and a 1px outline lands on the next one.
- Music artwork was centred twice — negative margins in the legacy sheet plus
  the modern rule's `transform: translate(-50%, -50%)`, which still applied.
- `min()` is Chrome 79+, so the search input's width was dropped whole and it
  collapsed to its intrinsic size. Restated as full width for the TV.

## Escaping a focused text field on a D-pad

`useTvNavigation` blocked every command while a text input had focus, so the
search box could not be left with up/down — and with no pointer, Back was the
only way out, which exits the screen. `tvTextEditingOwnsCommand` now releases
up/down for single-line inputs while keeping the caret keys and Enter;
textarea, select and contenteditable keep everything, since they genuinely use
vertical keys. Mirrors the existing `tvRangeOwnsDirection` precedent.

## The client describes itself honestly to the server

The server needed to know what a device can actually decode, because a codec
list answers "which decoders exist", not "will this file play" — the Samsung
advertises `hevc` and cannot handle a Dolby Vision title, which is the whole
bug behind that title's broken direct play.

- `WebMediaCapabilities` now also detects `videoBitDepth` (Main 10, VP9
  profile 2, AV1 10-bit → 10; AV1/VP9 12-bit → 12; else 8), `hdrTransfers`
  and `dolbyVision` profile numbers.
- **HDR and Dolby Vision are claimed only with corroboration** — a deep
  decoder *and* a presentation path (`matchMedia('(video-dynamic-range:
  high)')`). A codec probe alone is not enough: a Dolby Vision fourCC embeds
  an HEVC profile, so an engine can answer true having evaluated only the
  base layer. Over-claiming is a black screen; under-claiming is a transcode
  nobody needed, and that is the failure to prefer.
- Surfaced on **Status → Client** (moved there from Settings) as a
  `DeviceCapabilities` card, because a TV that cannot be inspected has no
  other way to show what it believes about itself. That card is how the
  Samsung's real capability set was obtained at all: no `sdb shell`, no
  `dlog`, no inspector port, and console logging disabled on that build.
- Live-read from the TV: `tizen`; video h264, hevc, vp9; audio aac, opus,
  vorbis, ac3, eac3, mp3; containers mp4, webm, mp3, ogg; HLS fMP4 yes;
  10-bit; HDR and Dolby Vision not advertised.

## Playback sessions survived the app being suspended

The client sent its keepalive `DELETE` only on `pagehide`, which a Tizen app
never fires when the host suspends or replaces it — so a redeploy or a Home
press orphaned the server session. `usePlaybackRuntime` now also tears down on
`visibilitychange` → hidden, on platforms without pointer controls only (a
backgrounded browser tab is still legitimately playing). It cannot cover the
app being killed outright; the server reclaims an abandoned pipeline after 60s
and the session after 30 minutes, so the residual cost is about a minute of
`429` for the next viewer.

## Deploying to the TV stopped being a coin flip

`install-samsung.sh` hit two failures repeatedly. Installing over a *running*
app leaves it resumed rather than stopped, so `tizen run` reports
`resumed` / `Could not launch the null application` and foregrounds nothing —
the deploy looks successful while the TV shows the old screen. And the first
transfer intermittently fails with `Can not transfer package` while the device
is plainly reachable. The script now checks the launch output and retries, and
resets the sdb server (including the `TIME_WAIT` wait) and retries once on a
failed transfer.

Verified: `tsc --noEmit` clean on both projects; 166 tests pass; the Samsung
package built and deployed to `10.44.1.183` repeatedly through the day, with
each fix confirmed on the set by the operator.

## The client core moved to `@machafoundation/core`; this repo consumes it

The platform-independent half of this client — server API families, cluster
endpoint routing and health, playback resolution and coordination, persisted
state — now lives in `/Users/tom/devroot/macha-ts` as the zero-dependency
package `@machafoundation/core`, so the React Native app can share it. Extracted by a
separate session; this entry records **this** repo's side.

- `package.json` gains `"@machafoundation/core": "file:../macha-ts"`. The package
  publishes built `dist`, and npm does not run a linked dependency's build,
  so **`npm run build` in macha-ts is a prerequisite** for typechecking here.
- 64 files now import `@machafoundation/core`; ~90 modules and their tests were
  deleted from `src/`. Test count here drops from 451 to 146 (the balance,
  334 across 44 files, moved with the code and passes there).
- Four web-specific bindings stayed behind, deliberately — each is the point
  where a browser-only fact would otherwise have entered the package:
  - `state/client.ts` — builds `MachaClientConfiguration` from
    `import.meta.env.VITE_MACHA_SERVERS` and pins endpoints on the Samsung
    build. Same exported functions as before, so no call site changed.
  - `platform/traits.ts` — resolves `import.meta.env.MODE` to a
    `PlatformTarget` and applies it, keeping `buildPlatformTraits` a constant
    and `platformTraits(platform)` single-argument for the seven call sites.
  - `diagnostics/console.ts` — `window.machaDiagnostics` and the Clipboard
    `copy()`, which are browser affordances the core rightly refused.
  - `cluster/useEndpointHealthMonitor.ts` and `app/useMachaServices.ts` —
    React lifecycle bindings over the core's `EndpointHealthMonitor` class
    and `createMachaServices` factory.
- `main.tsx` calls `configureMachaHost({ origin: window.location.origin })`
  once before any service is constructed. Storage, clock, ids and
  `performance` auto-detect in a browser; the origin is what the API layer
  resolves relative artwork and stream URLs against on a same-origin
  deployment, and it now throws rather than silently yielding a relative path.
- `serverConnection` no longer dispatches `CustomEvent` on `window`; it
  publishes to a core event bus. `SERVER_UNREACHABLE_EVENT` /
  `SERVER_REACHABLE_EVENT` are still exported for anything still listening.

Verified: `npx tsc --noEmit` clean, `npm run build` succeeds (5.79s, 1,040 kB
bundle), 30 files / 146 tests pass. `src/` was backed up to the session
scratchpad before any deletion — much of this tree is uncommitted and some
files are untracked, so a bad delete would not have been recoverable.

**Since verified.** That caveat stood when this entry was written; it no
longer does. The arrangement has since run against the live cluster on the dev
server, in the packaged Samsung widget and in the Android WebView build,
including playback and mid-stream failover, across releases up to 0.12.2.

## Endpoint choice measures throughput, not just round-trip time

The registry ranked endpoints by probe latency and, failing that, by the
order they happened to be listed in `VITE_MACHA_SERVERS`. Both are proxies
for "which node should I read media from", and this cluster falsifies them
routinely: `gbni-1` is wired, `gbni-2` is behind a knowingly flaky wireless
hop, and `es-1` is across a WAN. A node one wireless hop away can answer a
probe promptly and still be the worst possible choice to stream from — and
after a failover, candidate order was literally the order someone typed the
`.env` line in.

- **`src/cluster/EndpointBandwidth.ts` (new).** Per-endpoint throughput in
  bytes per second, smoothed (0.35) across transfers the client was making
  anyway. Persisted to `localStorage` under `macha-client-bandwidth:<client>`
  so a reload does not start blind, but a restored estimate re-enters as a
  *single* sample and is dropped entirely after 6 hours — the link may be a
  different link by then. Writes are throttled to one per 5s (this runs on
  TVs) with the first sample always written and a `flush()` on teardown.
  Storage failures are swallowed: a full quota must never break a request.
- **Sampling is honest about what it measures.** Only transfers of at least
  32 KB count; below that the number is round-trip time and server handler
  cost wearing a throughput costume — exactly the mistake that made the
  server's own `peer_latency_ms` read a 35 KB commit as network distance.
  Timing wraps the *body read*, not the `fetch()`: a resolved fetch has
  received headers and not one byte of payload. Byte counts come from
  `Content-Length`; a chunked response simply contributes no sample.
- **One instrumentation point, and it removed duplication.** `readJsonBody()`
  in `httpCompat` replaced three copy-pasted `return await response.json() as
  T` success paths (catalogue, manage, acquisition). The recorder is
  installed by `App.tsx` via `setTransferRecorder()` rather than imported, so
  the HTTP layer keeps no dependency on cluster bookkeeping; attribution is
  by URL prefix, since an endpoint id *is* its normalized base URL.
- **Selection now uses both facts.** `evaluatePreferredSwap()` (was
  `evaluateLatencySwap()`) requires an advantage on one axis and no material
  regression on the other: it will not hand authority to a link that
  measurably cannot carry as much however promptly it pings, and it will move
  for a materially fatter pipe even when the round trip is no better.
  `candidates()` consults throughput ahead of configured order, so failover
  order stops being a typing artifact. Health still outranks both — a failing
  fast link sorts last.

Verified: `npx tsc --noEmit` clean; 70 files / 451 tests pass, including 9 new
`EndpointBandwidth` tests and 8 new registry tests covering ordering,
thin evidence, the health precedence, both swap directions and the refusal
cases. **Not yet live-verified** against the real cluster — the numbers that
motivated it are real (measured 2026-09-07), but no session has yet watched
this reorder a live failover. Worth doing during the pending playback UAT.

## Episode ancestry is produced by the API, not stitched on by callers

Found live 2026-09-06: a deep link to `/play/tmdb:episode:6468133` showed
"Playback failed — Episode playback hierarchy context is missing." for a
perfectly playable episode. `playbackContext` (series id/title, season
id/title/number) is presentational catalogue data — the wire item carries
only `parent_id`, and nothing in playback consumes it — but its invariant was
enforced in the wrong layer and produced in the wrong layer:

- `PlaybackRuntime.requestError()` refused to play an episode without it,
  because the runtime is the choke point on the way into Continue Watching,
  whose card renders series/season links from it. A rendering invariant
  policed by the session engine — hence the silent, nonsensical failure.
- `EpisodeRail` (a scroller) was where episodes got their ancestry attached,
  so every other producer lacked it: `details(episodeId)` (the deep-link and
  `/episodes/:id` paths) and pre-field persisted entries (the whole reason
  `continueWatchingMigration.ts` existed).

- [x] `MachaMediaApi` is now the sole producer via one private
  `episode(item, season, show)` builder: `details(seasonId)` fetches the show
  alongside the episode list (`Promise.all`), and a new `details(episodeId)`
  branch walks episode → season → show. `Episode.playbackContext` is now a
  required field, so the type carries the guarantee.
- [x] Deleted: the `EpisodeRail` map and its `series`/`season` props; the
  runtime's episode gate; the hand-rolled season→show walk in
  `continueWatchingMigration.ts` (now just re-reads the episode via
  `api.details`). `usePlaybackController`'s deep-link fallback needed no
  change at all. Net −75/+79 lines across 7 files, most of it tests.
- [x] Only the `season`/`episode` branches of `details()` changed; movie,
  track, album and artist mapping is byte-identical and their existing
  `MachaMediaApi.test.ts` cases pass unchanged. New test: "resolves series and
  season ancestry for an episode loaded directly, as a deep link does"; the
  season test now asserts the ancestry too. Full suite green (433 tests),
  `tsc --noEmit` clean.
- [x] Live UAT against the 3-node cluster, window foregrounded and
  `document.visibilityState` confirmed `visible` (see the P0 process note in
  `ACTIVE.md`), every case reaching `readyState 4` with time advancing:
  - Deep link `/play/tmdb:episode:6468133` plays; heading "The Golden Rule —
    Fallout S02E02", the series title coming from the resolved ancestry.
  - `/episodes/tmdb:episode:6468133` → Play plays (same heading).
  - Season screen `Alone › World Championship` renders its rail; playing from
    it gives "Worlds Collide: Part 1 — Alone S13E01".
  - After 35s of playback (past `MINIMUM_PROGRESS_MS`), Home shows the new
    Continue Watching card with both links: `Alone → /series/tmdb:tv:63726`
    and `World Championship · S13E01 → …/seasons/tmdb:season:63726:13`; the
    pre-existing Chernobyl card is intact; no console errors.
  - Control: movie deep link `tmdb:movie:607` plays Direct (H264, 1:37:56).
  - Music grids are empty on this cluster, so those paths rest on the
    unchanged unit tests.
- [x] **Found and fixed during that UAT — `SessionManager.fetch()` did not
  actually deliver an authenticated request.** Stripping `playbackContext`
  from a persisted entry to simulate legacy data, the repair failed on load
  with `a valid session bearer token is required`. Root cause was in the
  session layer, not the caller: `fetch()` sent a request tokenless if it
  fired before the cold-start mint landed, and on a 401 with a live token it
  kicked off a re-mint but *returned the 401 anyway* — the new session was
  never used for the request that needed it. `useSession` then pushed the
  burden onto callers ("every real request must wait for `ready`"), which
  is the same shape as the ancestry bug above: an invariant every call site
  must remember, and one forgot. (First instinct was to add one more
  `sessionReady` gate to the migration effect; reverted — wrong layer.)
  `SessionManager.fetch()` now owns the contract: a tokenless request awaits
  the in-flight bootstrap; a 401 on the token actually sent awaits the
  (coalesced) re-mint and retries once with the new token; a 401 whose token
  was already superseded retries with the current one without minting again
  (so a slow request can't clobber a good new session); a failed re-mint
  returns the original 401, no loop. Four contract tests in
  `SessionManager.test.ts` — hold-until-minted, retry-once, coalesce/no-
  clobber, fail-without-loop — the first three confirmed to fail against the
  old behaviour. Re-ran live with the session cache cleared (true cold
  mint) and no call-site gate: entry repaired on load, card rendered both
  links, no 401 in the console. Suite: 69 files / 436 tests, `tsc --noEmit`
  clean. Yesterday's call-site `sessionReady` gates (health monitor, the
  unmatched-count effect, `usePlaybackController`'s option and its
  reconstruction guard, plus that guard's test) were then removed as
  redundant; the only remaining consumer of `ready` is the splash-until-
  minted render gate in `App.tsx`, which is presentation, not correctness.

Not done, deliberately: the field is still called `playbackContext` (a
misnomer, but renaming touches persisted localStorage shapes), and
`SeasonScreen` still fetches `details(seriesId)` for a title and artwork
that `SeasonDetails` could now carry — a follow-on that would net fewer
requests than today.

## A failed seek no longer pins the scrubber at a position playback never reached

Found while analysing the flagged seek/option-change failover gap (see
`ACTIVE.md`), and separable from it: this half needed no design decision.

`seek()` pins its target optimistically — setting `intent.positionMs`,
`event.positionMs` and `seekIntentActive = true` before the generation PATCH
is even attempted — and while `seekIntentActive` is true, `onPlayerEvent`
deliberately ignores real player positions so transient attach events cannot
overwrite viewer intent. Nothing in `drainMutations()`'s failure path ever
unwound that. `seekIntentActive` only clears when the player reports reaching
the target, which never happens if the generation request failed, so:

- `PlayerScreen.tsx` renders the scrubber from `intent.positionMs`, leaving it
  frozen at a position playback never reached, for the rest of the session,
  while the stream plays on somewhere else.
- `PlaybackRuntime.ts` derives `startPositionMs` from the same field, so the
  wrong position propagated into resume/reactivation requests too.
- This fired for *any* failed seek PATCH, including a benign 4xx from a
  perfectly healthy node — it needed no cluster failure at all.

- [x] `PlaybackCoordinator` now tracks `lastObservedPositionMs` (the last
  position the player itself reported, recorded in `onPlayerEvent`
  independently of optimistic intent), and a failed mutation calls the new
  `rollbackUnfulfilledSeek()`: it clears `seekIntentActive` so position
  reporting follows the player again, and restores the last observed
  position. It deliberately does nothing when newer seek intent is already
  queued (`pendingMutation`/`debouncedSeekMutation`), since that supersedes
  the failed one anyway.
- [x] Regression test in `PlaybackCoordinator.test.ts` ("restores the observed
  position when a seek-driven generation replacement fails") asserts both
  halves: the position returns to the observed one, and subsequent player
  events are followed again rather than staying pinned. Confirmed to fail
  against the pre-fix code (scrubber stuck at the unreached target).
- [x] Full suite green (69 files / 432 tests), `tsc --noEmit` clean. The
  remaining failover-policy question is deliberately deferred — see
  `ACTIVE.md`.

## Phase 6 failover: audited automated coverage, fixed a real hung-session-POST bug

With no live cluster available, audited what the automated suite already
proves for the Phase 6 UAT scenarios listed as "not yet exercised" (HLS
failure, failure during session POST/manifest transfer/pause/seek/
option-change), to find genuine test gaps to close versus scenarios that
turned out not applicable or to be real, undesigned production gaps (the
latter were *not* implemented — see `TODO/ACTIVE.md`'s Phase 6 entry for
what's flagged for a design decision instead).

- [x] Found and fixed a real bug: `ClusterPlaybackResolver.resolve()` (the
  client's very first session-creation POST) omitted the `attemptTimeoutMs`
  argument its own sibling methods (`failover()`, `prepareAlternate()`)
  already pass — so a node that hung on the first POST (accepted the
  connection, never responded) would hang the client forever with nothing
  to notice or retry. Fixed by passing `this.generationAttemptTimeoutMs`
  like every other call site. Regression test added to
  `ClusterPlaybackResolver.test.ts` ("abandons a hung initial session
  POST..."), confirmed to fail (a real 5-second test timeout) against the
  pre-fix code, mirroring the existing hung-standby-POST test's pattern and
  timeout override.
- [x] Added a test proving the session-creation candidate/failover loop is
  genuinely mode-agnostic for HLS, not just implied by the Direct Play
  case: `ClusterNodeFailover.test.ts` ("creates the initial HLS generation
  on the surviving node after request-creation failure").
- [x] Confirmed `WebHlsPolicy.ts`'s error classification is provably
  detail-agnostic (branches only on `data.type`, never `data.details`), so
  a manifest-specific error is already exercised identically to the
  existing `fragLoadError` test — no real test gap there, so no redundant
  test added.
- [x] Confirmed "failure during pause" is inapplicable: pause/resume are
  purely local player calls with no resolver/network round trip at all.
- [x] Full suite green (69 files / 431 tests), `tsc --noEmit` clean.

## Endpoint registry now has memory across a reload

Runtime-discovered cluster membership (`discoverClusterEndpoints()`) lived
only in memory; a page reload reseeded purely from the single configured
bootstrap URL. If the client had already failed over away from that node
because it went down, a reload while it was still down had no way back in.

- [x] Added `getDiscoveredEndpoints()`/`setDiscoveredEndpoints()` to
  `src/state/client.ts`, mirroring the existing `getBootstrapEndpoints()`
  versioned-envelope pattern exactly, under their own key
  (`macha-discovered-endpoints-v1`) — kept deliberately separate from
  `macha-bootstrap-endpoints-v1` per `docs/server-api.md`'s explicit
  instruction that discovered candidates must never be persisted as user
  configuration. Bounded to 16 URLs, capped at write time. As part of
  generalizing the shared read/normalize/rewrite helper to work for either
  key, fixed a latent bug where it always rewrote a normalized value back
  into the bootstrap key regardless of which key it had actually read from
  (harmless before, since it only ever had the one caller) — regression
  test in `client.test.ts` confirmed this against the pre-fix behavior.
- [x] Added `persistConfirmedEndpoints()` to `useEndpointHealthMonitor.ts`,
  called once per health cycle: recomputes (never accumulates) the current
  set of `source: 'discovered'` endpoints with a recorded `lastSuccessAt`
  and writes it, so the persisted set always tracks what's *currently*
  confirmed rather than growing unbounded discovery history, and a no-op if
  unchanged from what's already stored.
- [x] `App.tsx` now seeds `EndpointRegistry` with the configured bootstrap
  endpoints followed by the persisted ones under `source: 'environment'`
  (previously-unused groundwork already reserved for exactly this) — the
  registry's own dedup keeps the bootstrap version on any conflict, and
  `'environment'` (like `'bootstrap'`) survives `applyAdvertisement()`'s
  replace-on-refresh, which only ever discards `'discovered'` entries. A
  stale environment endpoint from a cluster the user has since moved away
  from self-heals within one health cycle, since the persisted set is fully
  recomputed (not merged) from live state every cycle.
- [x] Regression tests in `client.test.ts` (persistence, bounding, clearing,
  the key-generic self-heal fix) and `useEndpointHealthMonitor.test.ts`
  (only confirmed-reachable discovered endpoints persist, never the
  bootstrap endpoint itself, and stale entries clear once no longer
  advertised) — confirmed to fail against pre-fix/no-op behavior.
- [x] Full suite green (69 files / 429 tests), `tsc --noEmit` clean.
  Live-verified against the real 3-node cluster: after one ~10s health
  cycle, `localStorage['macha-discovered-endpoints-v1']` correctly held the
  two non-bootstrap nodes; a full reload with that state present seeded and
  rendered the Status screen normally, no console errors.

## `fail()`'s reactive path no longer races an in-flight seek-driven generation replacement

`degrade()` was fixed 2026-09-05 (live A/V-desync report) to ignore playback
errors while a seek-driven generation replacement (`this.activeMutation?.reason
=== 'seek'`) is already in flight — a stream error from the server tearing
down the superseded generation looked identical to fresh degradation
evidence. `fail()`, the fatal-error path, was deliberately left unguarded at
the time: a bare copy of that short-circuit would risk silently dropping a
genuinely unrelated fatal error mid-seek, with neither recovery nor failure
UI — worse than the race it would fix.

- [x] `fail()` now defers instead of ignoring. When a fatal error arrives
  while `this.activeMutation?.reason === 'seek'` is in flight, it captures
  the currently-playing session and waits for that specific mutation to
  settle — a new `settled: Promise<void>` on `activeMutation`, resolved in
  `drainMutations()`'s existing `finally` right as the mutation's fate (its
  own success/abort/failure) is decided.
- [x] Once settled, it compares `sourceIdentity()` of the captured session
  against the current one: if the seek replaced the source, the error was
  about a generation already gone and is dropped as stale (same reasoning
  `degrade()` uses); otherwise it's handled exactly as if the guard were
  never there, via a `failNow()` extracted from the original `fail()` body
  (`recoverFromSourceFailure()` or `failTerminal()`).
- [x] Two new regression tests in `PlaybackCoordinator.test.ts`, mirroring
  the existing `degrade()` race test's shape (`deferred<PlaybackSession>()`
  to keep the seek's `resolver.update()` genuinely in flight): one proves a
  stream error is held and then dropped once the seek's replacement source
  lands; the other proves a genuinely unrelated fatal error still surfaces
  (via `recoverFromSourceFailure`/`failTerminal`) once the seek settles
  without changing the source (there, the seek's own update rejects). Both
  confirmed to fail against the pre-fix unguarded `fail()`.
- [x] Full suite green (69 files / 421 tests), `tsc --noEmit` clean. Plan
  doc (`TODO/2026-08-31-cluster-any-node-playback-failover.md`, Phase 5)
  updated with the follow-up fix.

## Bounded per-request timeout across the cluster status/catalogue/routing fetch layer

Every fetch in this layer previously had no timeout at all — the only
`AbortSignal`s in play were caller-supplied for unmount cancellation. Caught
live: a single already-known-good endpoint took 19.7s on one request,
serialized behind nothing and blocking unrelated work. Nothing in the failover
router (`ClusterEndpointRouter`) could kick in either, since a hung request
never rejects on its own.

- [x] Added `fetchWithTimeout()` and `DEFAULT_REQUEST_TIMEOUT_MS` (8s) to
  `src/api/httpCompat.ts` — the one module every low-level API class already
  imports. It composes a caller-supplied `init.signal` with its own
  timeout-driven `AbortController` by hand (no `AbortSignal.any`/
  `AbortSignal.timeout`: absent on browsers old enough to have a real
  `AbortController` but predate those statics — this is a TV app with its own
  `AbortControllerPolyfill.ts` for that exact gap). A genuine caller
  cancellation still surfaces as a plain `AbortError` (so
  `retryableEndpointFailure` keeps treating it as client intent, never
  endpoint health); a timeout throws a `MachaConnectionError` instead, since a
  request that never answers looks exactly like an endpoint that never
  answers and must retry/fail over the same way one already does.
- [x] Wired into every request path in the layer: `MachaClusterStatusApi`,
  `MachaAcquisitionApi`, `MachaManageApi`, `MachaServerApi`,
  `MachaCatalogueApi`'s private `fetch()` (covers `list`/`get`/`search`/
  `update`/`clearMetadata`/`putArtwork`/`status`, none of which had *any*
  timeout before — only `artwork()` did, via `ClusterCatalogueApi`'s own
  older 8s mechanism, left untouched), and `probeEndpoint` in
  `useEndpointHealthMonitor.ts` (a hung probe previously wedged the entire
  10s health-monitoring loop forever, defeating the mechanism the live
  incident was actually about). Playback/streaming byte-range transfers are
  explicitly out of scope — they already manage their own deadlines
  (`ClusterPlaybackResolver`'s `awaitWithEndpointDeadline`,
  `WebPlatform.ts`'s HLS preflight) with different, deliberate tradeoffs
  (e.g. not aborting a mutation mid-flight).
- [x] Fixed the 4 blanket `catch { throw serverUnreachable(); }` blocks
  (Status/Acquisition/Manage/Server) as a side effect of routing them through
  the shared helper — they previously would have swallowed a real caller
  cancellation into a misleading "unreachable" error too, matching
  `MachaCatalogueApi`'s pre-existing `error.name === 'AbortError'` guard.
- [x] Regression tests: `src/api/httpCompat.test.ts` (new) proves
  `fetchWithTimeout` resolves normally under the timeout, abandons a hung
  request at the deadline as a retryable `MachaConnectionError` (confirmed to
  hang/fail without the fix, via a temporarily neutered abort call), and
  forwards genuine caller cancellation as a plain `AbortError`. Updated two
  `useEndpointHealthMonitor.test.ts` tests and one `MachaCatalogueApi.test.ts`
  test whose assertions assumed no signal (or the exact same signal object)
  ever reached `fetch` — now legitimately false, since a bounded-timeout
  signal is always attached; the underlying invariants they were protecting
  (lifecycle cancellation never reaches the health probe; caller cancellation
  still reaches the real fetch call, just via a composed signal rather than
  the same object) still hold and are still asserted.
- [x] Full suite green (69 files / 419 tests) and `tsc --noEmit` clean.
  Live-verified against the real 3-node cluster: Home, Status, and Manage
  screens all load real data through the new path with no console errors and
  no unexpected network failures.

This is the completed-work ledger for the current session. An item belongs here
only after implementation and its stated verification are complete. Detailed
design notes and exact test results remain in the linked records.

## Anonymous session survives a reload: validate-then-mint, not mint-every-time

Following directly from the deep-link 401 fix below: every reload re-minted a
brand new anonymous session from scratch, a real server round trip creating a
new session record, even though the *previous* token was usually still
perfectly valid. That's a viewer-visible delay on every single reload for no
reason — a direct violation of Law 2, "Thou Shalt Not Make The Viewer Wait"
(`docs/principles-and-laws.md`). It also widened the exact race the deep-link
fix closes: the longer `sessionReady` takes to become true, the bigger the
window for something to fire an authenticated request too early.

- [x] `SessionManager` now persists `{token, expiresAtMs}` to `sessionStorage`
  (tab-scoped, gone with the tab — matching an anonymous session's own
  lifetime) on every successful mint, and `start()` tries a cached,
  unexpired token first via a new cheap validity check
  (`SessionAuth.validateAnonymousSessionAnyNode`, reusing the same
  lightweight `GET /api/v1/catalogue/status` the health monitor already
  probes) before ever minting fresh. A live server check — not just trusting
  the locally-recorded expiry — both proves the token still authenticates
  and doubles as an endpoint-reachability check, and correctly handles
  reconfiguring to a different server (the old token 401s against the new
  one, falling through to a fresh mint) with no extra bookkeeping needed.
  A rejection or an unreachable-during-validation failure both fall through
  to a normal fresh mint, which will hit the same nodes and fail the same
  way if the cluster is genuinely unreachable.
- [x] **Found and fixed a second, related bug while verifying this live**:
  `SessionManager.fetch()` reactively re-minted on *any* 401, including one
  from a request that fired before any token existed yet (nothing to
  reject). Depending on timing, a slow such request's 401 could arrive
  *after* a fast, successful cache validation had already adopted a good
  session — silently clobbering it with a wasteful fresh mint. Fixed by
  capturing whether a token existed *before* issuing the request and only
  reacting to 401 when it did; a tokenless 401 is never evidence the current
  session is bad, since there wasn't one to reject.
- [x] **Found and fixed a third bug this exposed**: `App.tsx`'s
  Manage-unmatched-count effect fired `manageApi.unmatched()` unconditionally
  on mount, before `sessionReady`, and its dependency array never included
  `sessionReady` — so an early 401 there would leave the badge silently and
  permanently stuck at 0, never actually retrying once the session became
  ready. Gated it on `sessionReady` and added it to the deps.
- [x] Added `src/api/SessionManager.test.ts` coverage: adopts a validated
  cached session without minting, mints and re-caches when validation
  rejects it, skips validation entirely for an already-expired cached entry,
  and — the regression for the second bug — does not re-mint when a slow
  request's tokenless 401 resolves after a token was already adopted.
  Confirmed that last one fails against the prior code (temporarily
  disabled the `hadToken` guard, reran, restored it) and passes with the fix.
- [x] Live-verified against the real cluster: the same cached token survived
  three consecutive hard reloads unchanged (no re-mint), and the original
  deep-link-into-`/play/:itemId` scenario still resumed playback cleanly
  with the cache-validation path active underneath.
- [x] Passed 416/416 tests and TypeScript typechecking.

## Deep-linked `/play/:itemId` reload could 401 before the session mint completed

Investigating the "readyState 0 forever" Direct Play P0 (see `ACTIVE.md`) live
via browser automation surfaced a real, unrelated bug: a hard reload (or any
fresh navigation) straight into `/play/:itemId` occasionally failed instantly
with "Macha playback request failed: a valid session bearer token is
required" — reproduced live and confirmed with a real user report of the same
failure mid-session.

Root cause: `App.tsx` blocks every other route behind a `!sessionReady`
Loading screen (added in the session/auth migration) specifically so no
route fires an authenticated request before the first session mint
completes. But `usePlaybackController`'s route-reconstruction effect — the
one that reconstructs an active player from `location.pathname` alone,
needed for exactly this kind of deep link — runs unconditionally as part of
that hook, which is called *before* `App.tsx`'s early return. It had no way
to see `sessionReady` at all, so it could fire `api.details()`/`runtime.play()`
immediately with no token yet minted, on the very first render.

- [x] Added an optional `sessionReady` option to `usePlaybackController`
  (default `true`, so existing callers/tests are unaffected) and gated the
  reconstruction effect on it, re-running once it flips true — this can never
  re-gate or interrupt something already playing, since the same effect
  already bails out immediately whenever `activePlayback` exists.
  `App.tsx` now passes its own `sessionReady` (from `useSession`) straight
  through — that value already folds in the `!connectionRequired` case.
- [x] Added a regression in `usePlaybackController.test.tsx` proving
  reconstruction is deferred while `sessionReady` is false and fires once it
  becomes true; confirmed it fails against the prior code (temporarily
  disabled the guard, reran, restored it) and passes with the fix.
- [x] Live-verified against the real cluster: a hard reload directly into
  `/play/tmdb:movie:8374` — the exact failing scenario — now resumes
  playback cleanly instead of 401ing.
- [x] Passed 411/411 tests and TypeScript typechecking.

## Platform UI traits, and no mini player on Samsung/Android

Codex's earlier "single core, multiple platform" work left `Platform` with
only playback-technical fields; every UI-behavior decision (D-pad nav,
hash routing, TV back handling, player control scheme) was re-derived ad
hoc from `platform.name`/`import.meta.env.MODE` at each call site, in three
different, inconsistent groupings. Fixed as a prerequisite before touching
any of that behavior:

- [x] `src/platform/platformTraits.ts` — five named traits
  (`usesDpadNavigation`, `usesHashRouting`, `receivesBackKeyEvents`,
  `usesRemoteMediaControls`, `hasPointerControls`), each documented with
  *why* it exists and which platforms currently share it (named after the
  decision, not collapsed just because two platforms agree on it today).
  Migrated every scattered check to read from it — `main.tsx` (router
  choice), `useTvNavigation.ts` (deleted the now-redundant private
  `tvMode()`), `DetailScreen.tsx`, `useMediaRouteBack.ts`, `App.tsx`'s
  `samsungBack`, and `PlayerScreen.tsx` (`samsungControls`/`webControls`,
  plus two in-file duplicates of the same `platform.name === 'web'` check
  found while in there). Left alone deliberately: `bootSplash.ts`,
  `state/client.ts`, the platform badge label, `main.tsx`'s
  diagnostics-config/fatal-handler block (infra/cosmetic, not
  UI-interaction behavior), and `detectPlatform()` itself (the canonical
  place `MODE` decides platform identity, not a scattered check to fix).
  Pure consolidation — every trait's value is identical to what it replaced.

The mini player bar doesn't work on a real TV remote (no pointer to reach a
small persistent control) — removed on Samsung and Android specifically:

- [x] `PlayerScreen.tsx`: the remote-back and Android-dev-keyboard-Escape
  paths now call `onStop()` (full close) instead of `onMinimize()`; the
  visible minimize/back button in the full chrome no longer renders outside
  `webControls`. Extracted the decision into a tested pure function,
  `playerBackAction(webControls)`, matching this file's existing
  `playerBufferedTimelineEnabled`-style testability pattern.
- [x] Android's hardware back button is intercepted **natively** before any
  JS runs (`platforms/android`'s `MainActivity.onBackPressed()` calls
  `WebView.goBack()` directly) — confirmed by reading the Java source, not
  assumed. A pure web-side fix would have been silently unreachable on a
  real device. Added a JS↔native hook: `MainActivity` now asks
  `window.__machaHandleBack()` first (via `evaluateJavascript`) and only
  falls back to `WebView.goBack()`/`finish()` if it's absent or returns
  false; `PlayerScreen.tsx` registers that hook to call `onStop()` while the
  full player is showing. Not device-tested — no Android hardware/emulator
  available here; the Java change is small and mechanically matches the
  existing `onBackPressed` shape, but treat it as unverified until run on a
  real device or emulator.
- [x] **Live-verified on Samsung** (`vite --mode samsung`, demo content):
  minimize button confirmed absent from the DOM; dispatching the Samsung
  remote "Return" key (`keyCode 10009`) from the full player now closes
  playback and returns to the previous screen, with no mini bar appearing.
- [x] Added `src/screens/PlayerScreen.test.ts` coverage for
  `playerBackAction`.

**The live Samsung check caught a second real, pre-existing bug**: closing
from the full player (not the mini bar) silently restarted the same title
from position 0 instead of closing. Root cause: `stop()`/`handleEnded()`
navigate away from `/play/:id` and asynchronously clear the runtime's active
request; if the runtime's phase reaches `idle` (request cleared) on a render
where the router hasn't yet committed the navigate-away, the
reconstruct-from-route effect sees "on the player route, no active
playback" — indistinguishable from a reload deep-linked into the player —
and restarts it. This existed before this session's changes (the explicit
close button also hits it) but was rarely exercised, since minimize (the
overwhelmingly common path) never clears the request and so never races.
Making back/close the normal path on TV made it fire on nearly every exit.

- [x] Fixed with a `suppressReconstructRef` in `usePlaybackController.ts`,
  set when `stop()`/`handleEnded()` navigate away from an active player
  route, cleared only once the route has actually left `/play/:id` —
  proving the intentional stop this was guarding actually completed, not
  just that some render happened to run.
- [x] Added `src/app/usePlaybackController.stopRace.test.tsx`: mocks
  `react-router-dom`'s `useNavigate`/`useLocation` to decouple "navigate()
  was called" from "the route changed" (a real `MemoryRouter` flushes both
  together in a synchronous test, hiding the exact race). Confirmed this
  test fails against the pre-fix code (reverted it and re-ran to check)
  before confirming it passes against the fix.
- [x] Passed 409/409 tests and TypeScript typechecking.

## Session/auth REST contract migration: a proper SessionManager, two real bugs caught live

The server session implemented a new anonymous-session auth subsystem
(`POST /api/v1/session` mint, `Authorization: Bearer` required on every other
route) in parallel with this client-side work. This landed in three passes,
each catching something the previous one missed.

**Pass 1 — the contract itself.** Every API client (`Macha*Api`/`Cluster*Api`,
plus the playback resolver) authenticates through an injected auth
dependency instead of a manually-entered token. Removed the legacy
`Macha-Viewer-Session` header and the whole `viewer_session_id`/
`PlaybackAdmissionContext` concept outright (this app only ever runs one
`PlaybackRuntime` per tab, so per-viewer multiplexing had nothing to
distinguish) and the `Idempotency-Key` header (now
`POST /api/v1/playback/sessions?idempotency_key=<...>`).

**Pass 2 — a live joint test against the server session's real instance
caught a real bug no unit test had**: within seconds, the client fired
thousands of `POST /api/v1/session` calls in a tight loop (all landing as
201s — the server was never at fault). Root cause: `setTimeout`'s delay is a
32-bit signed int (~24.8-day max); scheduling the proactive pre-expiry
refresh for the full remaining duration of this contract's ~30-day session
TTL silently overflowed to ~0ms, so the client re-minted immediately after
every "successful" mint, forever. Fixed by chunking the wait into re-checks
no longer than 24h, recomputing the real remaining time on each recheck.

**Pass 3 — booting a fresh client against the real cluster surfaced two more
real problems**, prompting a full architectural redo of the first pass
rather than another patch:
- Several requests fire at cold boot (concurrent catalogue loads, the
  health-monitor's own probe) before the session mint — itself an async
  network round trip — has completed. Those 401s reached the user as a raw,
  permanently-stuck error banner ("a valid session bearer token is
  required"): nothing re-triggered the failed screen once the token
  actually arrived.
- The auth/401 plumbing itself had spread across a dozen files: a
  `BearerTokenSource` union type threaded through every client's
  constructor, a `reportUnauthorized()` 401-check line copy-pasted into six
  leaf API classes plus the health monitor, and a global
  `window` `CustomEvent` used purely to get a 401 signal back to the one
  hook that could act on it.

Rebuilt as a proper `SessionManager` (`src/api/SessionManager.ts`): one
class owns minting, proactive refresh, and — because every API client now
authenticates by calling `sessionManager.fetch(url, init)` instead of
building its own headers — 401 detection and reactive re-mint too, all
internally, with no event bus needed. `sessionManager` is a genuine
app-lifetime singleton; `src/app/useSession.ts` is a thin React interface
onto it (configures it for current connection settings, subscribes to its
`ready` state) rather than a hook that owns or constructs a session, so
every API client and the health monitor share the exact same live instance.
`fixedBearerToken(token)` is the second, much simpler implementation of the
same `AuthenticatedFetch` interface — the Settings screen's manual override
and every test double, both by construction incapable of drifting from
what production code actually depends on.

App-level: added a `sessionReady` gate (`src/App.tsx`) that blocks the real
route tree and the health monitor's polling/discovery — not just the
manual-token-vs-auto-mint distinction — until the first mint attempt
settles, success or failure; a failure hands off to the existing
cluster-unreachable gate instead of hanging. Never gates mid-playback.

- [x] `src/api/SessionManager.ts` + `src/api/SessionManager.test.ts` (11
  tests, incl. the setTimeout-overflow regression, now against the class
  directly).
- [x] `src/app/useSession.ts` + `src/app/useSession.test.ts` (5 tests).
- [x] Every leaf/cluster API class, `useEndpointHealthMonitor.ts`,
  `useMachaServices.ts` migrated from `bearerToken?: BearerTokenSource` to
  `auth: AuthenticatedFetch`; deleted `SessionTokenStore.ts`,
  `useSessionAuth.ts`, `SESSION_UNAUTHORIZED_EVENT`/`reportUnauthorized()`.
- [x] Live-verified against the real cluster (`10.44.1.50`, plus whatever it
  advertises via cluster discovery): a single clean mint at boot, the
  stuck-error banner is gone, health-monitor polling of every known node —
  including newly-discovered ones — never fires unauthenticated.
- [x] Passed 406/406 tests and TypeScript typechecking.

**Known residual gap, accepted rather than chased further**: the peer's dev
instance had streaming/FFmpeg disabled, so the idempotency query parameter on
an actual `POST /api/v1/playback/sessions` call, and a real token
expiry/re-mint cycle (the TTL is ~30 days — impractical to wait out), were
each verified only by unit test with a mocked clock/fetch, not against a live
server. Both are low-risk and will be exercised incidentally the next time a
real playback UAT runs (tracked separately in `ACTIVE.md`).

## Poster artwork cache-smashing

Signed capability artwork URLs (`/api/v1/catalogue/artwork/<id>?exp=...&sig=...`)
are re-signed by the server on every catalogue re-fetch, even when the
underlying image hasn't changed and the previous signature hasn't actually
expired. Handing each fresh signature straight to `<img src>` makes every
re-fetch a brand-new browser HTTP-cache key, so revisiting a screen (e.g.
Home) re-downloaded and re-decoded every poster already on screen — the
server's `Cache-Control` never got a chance to do anything, since the cache
key itself was what churned.

- [x] `LazyArtwork`'s `CapabilityArtwork` (`src/components/LazyArtwork.tsx`)
  now maps artwork `id` -> the last URL that actually loaded successfully
  (module-level, survives a full unmount/remount from screen navigation). A
  same-id re-fetch with a merely-reissued signature is ignored in favor of
  the already-cached URL; a real failure (the cached copy genuinely expired
  or evaporated) still falls through to the fresh URL the caller just gave.
- [x] Added 4 tests: ignoring a re-signed URL for an already-loaded id,
  surviving a full remount, falling back to a fresh URL after a real
  failure, and a never-before-seen id loading from its own URL untouched by
  another id's cache entry.
- [x] Passed the existing `LazyArtwork.test.tsx` suite unchanged — none of
  those tests fire a real `onLoad`, so the new cache never activates for
  them, confirming no behavior change for anything already covered.

## Artwork capability URLs: client cutover, and a real bug caught in UAT

The server session landed signed artwork capability URLs (`url` field on every
artwork object in `/items`, `/items/{id}`, `/search`) and reported it back.
Implemented the client side of
[the original ask](2026-09-04-artwork-capability-urls.md):

- [x] Added `url?: string` to `ArtworkRef` (`types.ts`) and wire-type
  `CatalogueArtwork` (`api/CatalogueApi.ts`); threaded through
  `MachaMediaApi.mapArtwork`.
- [x] `LazyArtwork` now dispatches to a plain, hook-free `<img src loading>`
  when `artwork.url` is present. Deliberately kept the existing Blob-fetch/
  viewport-observer/decode-retry path (`useViewportArtworkUrl`,
  `artworkViewport.ts`, `MachaMediaApi`'s cache/dedup) as a fallback for
  artwork without a `url`, rather than deleting it as the original ask
  envisioned: this client's whole architecture assumes a mixed-version
  cluster, the server session's own build was "uncommitted, Tom pushes
  manually" at time of writing, and the fallback costs nothing (a single
  `artwork?.url` branch) versus real interop risk. Applied the same
  short-circuit to `useArtworkUrl` (hero/backdrop images) and
  `MetadataEditorScreen`'s `ArtworkPreview`.
- [x] Added tests: `mapArtwork` threading, `LazyArtwork` (4 cases: capability
  URL, eager capability URL, legacy fallback, no-artwork placeholder),
  `useArtworkUrl` (3 cases).

**UAT caught a real bug the tests above did not**: the user opened the app in
a real browser and reported artwork requests failing against
`localhost:5173` (the Vite dev server), not the actual Macha node. Root
cause: the server's signed `url` is a bare relative path
(`/api/v1/catalogue/artwork/<id>?exp=...&sig=...`), meaningful only relative
to whichever node issued it. Handing that straight to `<img src>` lets the
*browser* resolve it — against the current page's origin, never the API
node's — whereas the existing Blob-fetch fallback path was unaffected
because it resolves the node explicitly in JS
(`ClusterCatalogueApi`/`MachaCatalogueApi`), which is also why Continue
Watching kept working while other newly-converted surfaces didn't: it's the
exact same code, so once this client build reaches artwork with a `url`
field anywhere, it will hit this everywhere the fast path is taken, not just
in one screen.

- [x] Fixed at the correct layer, mirroring how `MachaPlaybackResolver`
  already absolutizes stream/subtitle URLs: `MachaCatalogueApi` (the
  single-node wire client) now resolves every artwork `url` against its own
  `baseUrl` in `list`/`get`/`search`/`update`/`putArtwork`, before the item
  ever reaches `ClusterCatalogueApi` or `MachaMediaApi`. Because
  `ClusterCatalogueApi` already constructs one `MachaCatalogueApi` per
  endpoint, this automatically resolves against whichever node actually
  served that specific response — no extra endpoint-provenance plumbing
  needed above this layer.
- [x] Added a regression that fails node A and lets node B serve the item,
  proving the artwork URL resolves against node B specifically (not node A,
  not left relative) — confirmed it fails against the prior code and passes
  with the fix. Passed 369/369 tests and TypeScript typechecking.
- [x] Re-verified live in the browser (2026-09-04) against the real connected
  cluster node `10.44.1.200:7438`: reloaded Home, Movies and TV Shows on the
  running dev server (`localhost:5173`), confirmed network requests for
  artwork resolve against the node's own origin (signed `exp`/`sig` query
  params intact) rather than `localhost:5173`, all posters decoded
  (`naturalWidth`/`naturalHeight` populated) and rendered, and no console
  errors — the fix holds cluster-wide, not just in Continue Watching.

## Artwork capability URLs: server ask sent

- [x] Sent [the drafted ask](2026-09-04-artwork-capability-urls.md) to the
  macha server session ("Macha Server Work"): embed short-lived signed artwork
  URLs in catalogue responses, matching the existing stream/subtitle
  capability-URL pattern, cacheable and backward compatible, so the client can
  drop its hand-rolled artwork cache/dedup/retry machinery in favour of a plain
  `<img loading="lazy">`. Awaiting a server-side response before any client
  work on this can start.

## Any-node failover plan: latency-based pre-emptive authority swap

- [x] Implemented the Phase 6 item in
  [the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md):
  "Record rolling API latency independently from reachability... define
  hysteresis, cool-down and minimum improvement thresholds before
  implementing this so authority cannot flap." Chose this over the plan's
  other remaining non-blocked option (a dual-decoder hidden-standby HLS
  player) after discussing tradeoffs: the TV platforms this plan targets
  typically have exactly one hardware decoder session, so a second concurrent
  `hls.js` pipeline risks silently degrading or failing outright, and the
  realistic audience for "safe to double-decode" is desktop Web, where the
  existing single-player fallback swap already avoids visible failure UI or
  state loss.
- [x] `EndpointRegistry` now tracks a bounded 5-sample rolling latency average
  per endpoint (`recordLatency`/`latencyMs`), fed from the existing 10-second
  health-probe cycle's own round-trip time — never from real request timing,
  so ordinary traffic variance can't influence routing. `evaluateLatencySwap`
  only moves `preferredId` when the fastest ready (non-cooling) alternate
  beats the current preferred endpoint by both an absolute floor (200ms) and
  a relative floor (40%) for three consecutive probe cycles running, and then
  will not swap again for 60 seconds — hysteresis, minimum improvement and
  cooldown, respectively, all named in the plan.
- [x] Found and fixed a bug in my own first implementation before it shipped:
  the swap cooldown compared against a `lastLatencySwapAt` initialized to
  `0`, which could false-block the very first swap whenever `now` was small
  (true in every test using the file's existing small-integer clock
  convention, and not something to rely on `Date.now()` epoch size to avoid
  in production either). Fixed with an explicit "never swapped yet" sentinel.
- [x] Added 18 `EndpointRegistry` tests (hysteresis, both improvement floors,
  streak-reset on a changing fastest candidate, cooldown-in-cooldown
  interaction, rolling-window bounds) and 2 `useEndpointHealthMonitor` tests
  proving the probe cycle records latency only for genuinely successful
  responses and logs a reported swap. Passed 358/358 tests (one unrelated,
  pre-existing wall-clock-timing test in `directPlayReadAhead.test.ts` flakes
  under full-suite parallel load but passes in isolation and on repeat runs)
  and TypeScript typechecking.

## Any-node failover plan: server asks sent

- [x] Sent the plan's "Later server work" requirements plus the Phase 6
  node-51 data-availability gap to the macha server session ("Macha Server
  Work"): durable node identity/endpoint advertisement, a cluster-replicated
  ephemeral session-existence record with transparent recreation, retry-safe
  playback-session creation across an ambiguous response (a real UAT timeout
  case), cluster-consistent auth/CORS/TLS per advertised endpoint, explicit
  immutable continuity evidence for Direct Play splicing, and the node-51
  `open media: Input/output error` extent-availability gap from the
  2026-09-01 UAT. Awaiting a server-side response before any of this can land;
  client-side work continues independently in the meantime.

## Any-node failover plan: HLS generations already fully node-local

- [x] Verified the Phase 5 item "Treat HLS playlists and segments as
  node-local generations. Do not assume independently created sessions have
  interchangeable segment URLs or boundaries" in
  [the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md)
  against actual source and checked it off with no code change. `WebPlatform.attachHls`
  destroys the prior `hls.js` instance and creates a fresh one per
  `sourceGeneration`, gates every hls.js event on that generation matching the
  current one, and always `loadSource()`s the new generation's own node-local
  manifest URL. `preflightWebHlsSource` fetches an alternate's manifest/media
  URLs independently via plain `fetch`, never touching the active `hls.js`
  instance. Nothing in the client ever mixes or reuses a segment/manifest URL
  across sessions.

## Any-node failover plan: client-owned PlaybackIntent survives node failover

- [x] Closed the remaining Phase 0 item in
  [the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md):
  "Introduce a client-owned PlaybackIntent snapshot containing all state
  required to recreate a generation on a different node." `PlaybackCoordinator`
  already tracked position (`snapshot.intent`) and pending representation
  changes (`snapshot.pendingPreferences`) internally, so no new public type was
  needed — but `prepareAlternate` and `recoverFromSourceFailure` each
  reconstructed failover preferences straight from the last *server-confirmed*
  session, one of them via a duplicated seven-field inline object literal.
- [x] Found and fixed a real gap this exposed: a representation change
  (mode/quality/audio/subtitle) already requested by the viewer but not yet
  confirmed by the failing node was silently dropped on failover — recovery
  recreated the generation with the stale server-echoed preferences instead.
- [x] Added `PlaybackCoordinator.currentPreferences()`, the one place that
  folds `pendingPreferences` over the last confirmed session, and pointed both
  `prepareAlternate` and `recoverFromSourceFailure` at it, removing the
  duplicate literal.
- [x] Added a regression that stalls a representation-change PATCH to the
  failing node and proves the not-yet-confirmed preference still reaches the
  replacement node; confirmed it fails against the prior code and passes with
  the fix. Passed 348/348 tests and TypeScript typechecking. No existing test
  was changed, only extended.

## Any-node failover plan: deterministic two-node fake APIs/players

- [x] Closed the last open Phase 0 item in
  [the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md):
  "Add deterministic two-node fake APIs/players and failure injection for
  request creation, manifest load, segment/range load, source preparation and
  teardown." Per-layer coverage already existed but was scattered and ad hoc
  (each test file hand-rolling its own `fetch` mock chain and wire-session
  builder); nothing exercised the real production stack end to end.
- [x] Added two shared, reusable test fixtures: `src/test/fakePlayer.ts` (a
  `Player` test double implementing every optional hook) and
  `src/test/fakeCluster.ts` (a multi-node fake Macha playback HTTP API wired
  to the real `EndpointRegistry`/`ClusterPlaybackResolver` behind a stubbed
  `fetch`, with a per-node FIFO queue for scripting session/error/network-
  failure/hang responses).
- [x] Added `src/playback/ClusterNodeFailover.test.ts`, the first test to
  drive the real `PlaybackCoordinator` + real `ClusterPlaybackResolver` +
  real `EndpointRegistry` together against two independently scripted fake
  nodes: request-creation failure recovery, live-stream failover with real
  DELETE teardown of the failed lease, and HLS standby preparation/promotion
  without a redundant second admission — proving the pieces actually wire
  together, not just each layer in isolation. Segment/range-load failover for
  Direct Play already had equally deterministic two-node coverage in
  `tests/directPlayReadAheadServiceWorker.test.ts`, untouched here.
- [x] Passed 347/347 tests and TypeScript typechecking. No existing test was
  modified.

## Any-node failover plan: reconciled against actual implementation

The [any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md)
had fallen behind the code — a lot of Phase 0-2 work was actually done during
the "codex-refactor" work but never checked off. Verified each unchecked
Phase 0-2 item against current source and tests and checked off the ones
genuinely satisfied:

- [x] Phase 0: "Characterize position, pause, preference and queue behaviour
  while a replacement is in flight" — `PlaybackCoordinator.test.ts`'s
  "transport invariants" describe block (e.g. "accepts play/pause intent
  immediately while server generation work is in flight", "keeps the old
  source running while a backwards HLS generation is prepared").
- [x] Phase 1: "Replace the single stored server URL with a versioned set of
  seed/API endpoints, migrating losslessly" — `src/state/client.ts`'s
  `StoredBootstrapEndpoints{version:1,urls[]}` with lossless migration from
  both the legacy single-URL key and an interim multi-endpoint key; tested in
  `client.test.ts`.
- [x] Phase 1: "Treat configured addresses as bootstrap API endpoints, not
  authoritative membership" — `normalizeConnectionEndpoints` rejects
  blank/same-origin entries; CORS is server-enforced per `docs/server-api.md`.
- [x] Phase 1: "Prefer a healthy sticky endpoint... avoid retry storms" —
  `EndpointRegistry.candidates()`'s sticky-preferred ordering plus the
  `FAILURE_COOLDOWN_MS` ladder (already reviewed/fixed this session via
  `recordProbeFailure`).
- [x] Phase 1: "Make Web CORS and Samsung package origin policy explicit" —
  `vite.config.ts`'s Samsung `config.xml` access-origin declaration; CORS
  itself documented as server-enforced.
- [x] Phase 2: "Do not silently replay mutating requests" — `ClusterEndpointRouter.mutation()`
  tries exactly one endpoint, never retries; tested in `ClusterCatalogueApi.test.ts`
  ("does not replay a mutation whose outcome is uncertain").
- [x] Phase 2: "Replace the global unreachable-means-Settings rule with cluster
  availability" — `reportClusterUnreachable()`/`reportClusterReachable()` are
  cluster-wide, driven by `useEndpointHealthMonitor`'s all-endpoint reachable
  count, not any single request; `shouldEnterConnectionGate` gates on that
  flag alone.

- [x] Phase 2: "Record node selection, attempt order, cooldown and recovery
  timing in the bounded diagnostics buffer without exposing credentials" —
  this was the one genuinely missing, unblocked item the reconciliation
  found: the whole cluster routing layer logged nothing at all, unlike
  playback. Added `createClientLogger('cluster.routing')` to
  `ClusterEndpointRouter`'s `route()`/`find()`/`mutation()` (attempt with
  order, success, per-endpoint failure with retryability, and exhaustion) and
  `createClientLogger('cluster.health')`'s `probe-cycle` summary to
  `probeKnownEndpoints`. Only endpoint ids/base URLs are logged, no
  credentials. Added regressions asserting the exact event sequence for a
  failover-then-succeed request and the reachable/known probe summary.

Left unchecked and confirmed correctly still open: durable node identity
reconciliation from server advertisement (blocked — nothing server-side to
advertise yet), the PlaybackIntent/preferences-snapshot consolidation (needs a
closer look at whether `PlaybackCoordinator` already retains preferences
internally before sizing the work), and the compatibility-path rationalization
(explicitly conditional on a cluster-wide capability guarantee the client
can't unilaterally declare).

## Native lazy-loaded artwork, without a hand-rolled scheduler

- [x] Replaced hand-rolled scroll/resize/rAF viewport-proximity polling
  (`src/hooks/artworkViewport.ts`) with the browser's native
  IntersectionObserver. The previous approach could permanently miss a card
  revealed by any layout change other than a real scroll/resize event (a row
  loading/collapsing above it, for example), leaving it stuck on the
  placeholder indefinitely.
- [x] Removed the custom four-slot `ArtworkRequestScheduler` concurrency
  limiter entirely (superseding the "shared four-transfer scheduler" bullet
  under "Self-healing clustered artwork loading" below). It duplicated the
  browser's own per-origin/HTTP-2 connection management, and its single
  shared mutable `active` counter was the most plausible source of a silent,
  cumulative "some posters just never load" report that persisted after the
  IntersectionObserver fix alone didn't fully resolve it.
- [x] Kept the artwork Blob cache and in-flight request dedup map in
  `MachaMediaApi` — both simple, per-key, stateless-across-requests, and not
  implicated.
- [x] Documented the deeper structural fix and drafted a server-side ask
  ([TODO/2026-09-04-artwork-capability-urls.md](2026-09-04-artwork-capability-urls.md))
  to let artwork ride short-lived signed URLs the way playback stream/subtitle
  URLs already do, which would let the client drop this machinery almost
  entirely in favour of a plain `<img loading="lazy">`.
- [x] Added IntersectionObserver-fake-backed regressions (`artworkViewport.test.ts`)
  proving one-shot fire-on-intersect, cleanup-before-intersect, and the
  no-IntersectionObserver (older Samsung Tizen) fallback. Passed 342/342
  tests and TypeScript typechecking. No TV deployment was attempted.
- [!] **Open caveat, not yet resolved**: `CHANGELOG.md`'s 0.7.4 entry records
  that this project already used IntersectionObserver once and *deliberately
  removed it* ("remove... reversible IntersectionObserver state") in favour
  of the scroll/resize approach just replaced here. No reason survives in git
  history (that era's commits are squashed rollups with empty bodies). Best
  guess is Samsung Tizen 3 lacked IntersectionObserver and the old
  implementation had no fallback for that — today's does
  (`typeof IntersectionObserver === 'undefined'` → eager-load) — but this is
  unverified. What *is* now established: artwork loads on the Samsung across
  many releases since, so whichever of the two paths that set takes, it does
  not throw. What remains unknown is which one — nobody has read the value on
  the device. Worth one line of a probe next time anything is measured there,
  rather than a task of its own.

## Playback/cluster correctness fixes from a "grad-level howler" review

- [x] `EndpointRegistry`: added `recordProbeFailure()` so a background health
  probe updates cooldown/health without ever clearing the endpoint currently
  preferred by real traffic — previously a single transient probe blip on the
  authoritative node could quietly and permanently surrender its authority,
  a plausible cause of intermittent "media doesn't start."
- [x] `WebHlsPolicy`/`WebPlatform`: removed hls.js's own `startPosition` seek,
  leaving the app-level initial-seek listener (which correctly maps through
  `mediaTimeline.toMediaTime`) as the sole owner of the resume seek —
  eliminating a double-seek race on every resumed/Continue-Watching playback
  that was a likely source of reported player jitter.
- [x] `usePlaybackController`: added a one-shot ref guard so the
  route-reconstruction effect can't re-issue `runtime.play()` for a
  navigation that `startPlayback`/`selectQueueIndex` already started in the
  same gesture, removing a real (if timing-dependent) risk of a duplicate
  server session negotiation.
- [x] `ClusterCatalogueApi.readArtwork` now routes through
  `ClusterEndpointRouter.find()` (extended with an `advisory` option to
  preserve "artwork success doesn't steal authority") instead of hand-rolling
  its own candidate loop — closing a facade gap where the same authority bug
  above could independently recur for artwork.
- [x] Added targeted regressions for the probe-failure/authority fix and
  verified the `usePlaybackController` fix by confirming its test fails
  without the guard and passes with it. Passed 332/332 tests (at the time)
  and TypeScript typechecking.

## Hook/effect test coverage, using the platform's own testing idiom

- [x] Added `@testing-library/react` + `jsdom` (matching this project's own
  `node >=20` floor, not the newer default), scoped to files that opt in via
  the per-file `// @vitest-environment jsdom` pragma so the rest of the suite
  stays on the fast dependency-light `node` environment.
- [x] Converted `AsyncIconButton`, `MediaPageTitle` and `StatusHeader`'s tests
  from hand-rolled `renderToStaticMarkup` + HTML-string matching to real
  `render`/`screen` queries.
- [x] Added real hook/effect coverage that didn't exist before: exported and
  tested `attachSpatialTvNavigation` (previously unreachable outside a
  Samsung/Android build mode, so completely untested — now covers
  focus-on-attach, geometry-based directional movement, Enter-to-activate,
  Back routing and cleanup), `usePollingTask`'s actual `useEffect` wiring
  (recreation on dependency change, cleanup on unmount, `enabled: false`),
  and a `usePlaybackController` regression test for the duplicate-`play()`
  race above.
- [x] Passed 344/344 tests and TypeScript typechecking at the time.

- [x] Restricted application-wide cluster-unreachable transitions to the
  dedicated all-endpoint health sweep; foreground API exhaustion remains local
  to the operation that observed it.
- [x] Deferred the Connection recovery gate while a persistent player owns
  playing or paused media, preventing route replacement from unmounting the
  player and releasing its source/cache.
- [x] Added a reachable transition so deferred recovery is discarded when any
  real request proves that the cluster returned before playback ends.
- [x] Added regressions for foreground-outage isolation and active-playback gate
  deferral; passed 330/330 tests, TypeScript typechecking and the local Web
  production build. No TV deployment was attempted.

## Pause-preserving playback acquisition

- [x] Made Pause freeze presentation without stopping managed HLS acquisition;
  hls.js continues filling to its existing bounded buffer ceiling.
- [x] Preserved in-flight Direct Play read-ahead ranges across Pause and allowed
  the worker to continue contiguous speculative reads to its bounded cache
  frontier.
- [x] Kept Stop, source replacement, seeking, genuine failure and higher-priority
  viewer demand as distinct operations that may still terminate or pre-empt
  speculative work.
- [x] Added a worker regression proving an active range survives Pause, further
  ranges are fetched while paused, and the result is served from memory.
- [x] Passed 328/328 tests, TypeScript typechecking and the local Web production
  build. No TV deployment was attempted.

## Cancellation isolation for endpoint health

- [x] Removed the health monitor's three-second abort and stopped attaching its
  lifecycle signal to `/api/v1/catalogue/status` HTTP requests.
- [x] Made an obsolete health monitor ignore its eventual result without
  cancelling the request or publishing false endpoint evidence.
- [x] Made connection-setup checks use a bounded local wait without aborting
  their status requests or describing a merely pending response as an outage.
- [x] Classified `AbortError` as local caller intent rather than a retryable
  endpoint failure, preventing cancellation from demoting authority, trying
  unrelated nodes, or opening the global connection gate.
- [x] Changed playback-admission deadlines to abandon only the local wait while
  leaving the underlying POST independent and observed.
- [x] Added cancellation-isolation and non-cancelling health/admission/setup
  regressions; passed 327/327 tests and TypeScript typechecking. No TV
  deployment was attempted.

## Logical-viewer playback admission

- [x] Made the application-scoped persistent `PlaybackRuntime` own one opaque
  logical-viewer identity and passed it through initial playback, retries,
  representation recovery, standby preparation and node failover.
- [x] Added `Macha-Viewer-Session` to every playback-session POST while keeping
  session PATCH/DELETE addressed by the admitted session ID.
- [x] Preserved operation-scoped idempotency: each distinct admission gets a
  new `Idempotency-Key`, and all endpoint retries of that admission retain the
  same key and body.
- [x] Added regressions for the wire header, runtime identity persistence,
  standby/failover propagation, retry-key reuse and distinct-operation keys.
- [x] Passed 324/324 tests, TypeScript typechecking, and local Web, Samsung and
  Android Web production builds. No TV deployment was attempted.

## Self-healing clustered artwork loading

- [x] Replaced unbounded browser-owned poster fan-out with a shared
  four-transfer scheduler; foreground detail/player artwork passes queued grid
  work and duplicate demand coalesces by immutable artwork ID. **Superseded
  2026-09-04**: the scheduler itself was removed (see "Native lazy-loaded
  artwork, without a hand-rolled scheduler" above) as a likely source of a
  silent request-starvation bug; duplicate-demand coalescing is retained via
  `MachaMediaApi`'s in-flight request map.
- [x] Added an eight-second artwork-only node deadline that remains locally
  effective on legacy fetch implementations, plus alternate-node lookup for
  node-local `404` and retryable failures.
- [x] Kept artwork placement separate from API authority: a healthy local miss
  does not condemn or displace the current node, while an actual timeout remains
  endpoint-health evidence.
- [x] Removed permanent blank states after exhausted network or decode retries.
  Failed mounted cards cool down for one minute and re-arm through the
  near-viewport gate, with explicit bounded diagnostics and no UI error spray.
- [x] Passed 322/322 tests, TypeScript typechecking, and local Web, Samsung and
  Android Web production builds. No TV deployment was attempted.

## Debounced uncached seeking and seek-bar focus

- [x] Kept cached seeks immediate while delaying only generation-requiring
  seeks until 300 ms after the last slider or repeated skip transition.
- [x] Coalesced rapid movement into the final position and cancelled an unsent
  generation request when the user returned to locally cached coverage.
- [x] Cancelled an obsolete in-flight seek as soon as newer viewer input arrives,
  then applied the moving debounce to the replacement request. Cancellation is
  locally non-blocking even on legacy TV fetch implementations that ignore the
  signal, and stale cancellation errors never reach the viewer.
- [x] Propagated cancellation through the cluster and HTTP playback layers
  without marking the session node unhealthy or logging an intentional abort
  as a failed API request.
- [x] Corrected TV range ownership: Left/Right adjust playback position, while
  Up/Down re-enter spatial focus navigation instead of changing the range.
- [x] Added timing, request-count, cache-cancellation and range-direction
  regressions; passed 317/317 tests, TypeScript typechecking and a local Web
  production build. No TV deployment was attempted.

## Reliable in-playback representation switching

- [x] Removed the exact-position activation condition that repeatedly
  renegotiated Auto/Direct/Remux/Transcode generations whenever healthy
  playback advanced during the server request.
- [x] Catch up inside the returned transformed generation using its local
  offset, while retaining a new server generation only for a genuine move
  behind its available start.
- [x] Exposed pending playback preferences through coordinator state so mode,
  quality, audio and subtitle pills respond immediately and reconcile to the
  accepted server session or revert after failure.
- [x] Added a regression proving a mode switch with three seconds of concurrent
  playback makes one server request and activates at the correct local offset.
- [x] Passed 311/311 tests, TypeScript typechecking and local Web, Samsung and
  Android builds. No TV deployment was attempted.

## Premature media-element completion recovery

- [x] Distinguished a truncated source-generation `ended` event from genuine
  item completion using the authoritative session duration.
- [x] Kept the player open and routed a premature end through normal
  alternate-node stream recovery from the last observed position.
- [x] Added regressions for mid-item truncation and genuine completion within
  the five-second duration tolerance.

## Fixed Samsung client redeployment

- [x] Passed all 314 client tests and TypeScript typechecking, then produced a
  fresh legacy Chromium 47-compatible signed Samsung widget.
- [x] Installed `macha00001.Macha` on the Samsung TV at
  `10.44.1.183:26101` and received successful platform install and launch
  confirmation. Interactive catalogue, navigation and playback UAT remains
  active.

## Deployable Android TV package

- [x] Replaced the Android design-only packaging stub with a buildable Android
  TV application that hosts the shared client in a full-screen WebView.
- [x] Added Android-mode hash routing, TV D-pad navigation, WebView media
  capability reporting, LAN HTTP access, TV launcher metadata and the known
  four-node bootstrap set without introducing module lazy loading.
- [x] Produced the debug-signed `Macha-Android-TV-0.8.1-debug.apk`, verified its
  package/launcher manifest and packaged JS/CSS assets, and recorded SHA-256
  `03a3dcb7a38309751a1fdd46efbf2871d01483e7f2fc7f56d044fe4bc2087ff9`.
- [x] Passed 314/314 tests, TypeScript typechecking, the Android Web build,
  Android resource/Java compilation and APK assembly.
- [x] Connected to the ES-1 Android TV at `10.34.1.115`, installed the package,
  and diagnosed its first on-device launch failure as a vendor-specific absent
  decor view during early immersive-mode setup.
- [x] Deferred immersive setup until after content attachment, rebuilt and
  reinstalled the package, then verified process `media.macha.client` remained
  alive and `MainActivity` was the visible, resumed fullscreen activity.

## Asynchronous node identity reset acceptance

- [x] Accepted both queued `202 Accepted` and legacy `200 OK` node identity
  reset responses without treating `metadata_persisted: false` as failure.
- [x] Removed the accepted retired node ID from operational status immediately,
  retained that filter across the one prompt reconciliation refresh, and did
  not add reset-specific polling.
- [x] Kept identity authoritative: a replacement node with a different ID but
  the same host remains visible.
- [x] Added retired direct-node status support and queued/pending audit details.
- [x] Passed 313/313 tests, TypeScript typechecking, modern Web and
  Samsung/Tizen production builds, and `git diff --check`.

## Explicit API endpoints and unified navigation surfaces

- [x] Removed the obsolete same-origin API concept from connection input,
  persistence migration, bootstrap construction and discovered advertisements.
  Blank lines and `/` can no longer make the health monitor probe the Web/Vite
  origin.
- [x] Removed stale Vite-proxy guidance and documented direct CORS API access.
- [x] Made the main and secondary navigation containers consume the exact same
  background/transparency and blur tokens, including the legacy Samsung CSS
  transformation.
- [x] Passed 309/309 tests, TypeScript typechecking, modern Web and
  Samsung/Tizen production builds, and `git diff --check`.

## Legacy Samsung cancellation compatibility

- [x] Added an eager `AbortController`/`AbortSignal` compatibility layer for
  Chromium 47 before React mounts, without replacing native implementations.
- [x] Preserved the cancellation mechanics used by async page loading, endpoint
  probing, artwork, playback and request cleanup: abort state/reason, listeners,
  one-shot listeners, removal and `throwIfAborted`.
- [x] Passed 306/306 tests, TypeScript typechecking, modern Web and
  Samsung/Tizen production builds, and `git diff --check`.
- [x] Kept the corrected build local as requested; deployment and on-device UAT
  remain explicitly active work.

## TV D-pad navigation rollback

- [x] Removed the row/group focus algorithm, route focus-memory layer and their
  dedicated implementation after on-device UAT found navigation materially
  worse than the prior behaviour.
- [x] Restored the earlier geometry-based spatial scoring and DOM-order
  fallback for both Samsung and Android while retaining native editor/caret and
  playback-range key ownership.
- [x] Passed 308/308 remaining tests and TypeScript typechecking, then built,
  installed and launched the rollback on Samsung `10.44.1.183` and ES-1 Android
  TV `10.34.1.115`.
- [x] Confirmed the ES-1 Macha process remained alive and `MainActivity` was the
  visible, resumed fullscreen activity after replacement.

## Catalogue refresh and Samsung transport controls

- [x] Added the shared fixed-size refresh control to every server-backed media
  catalogue page, including search and nested details. Refresh retains route
  context and the last usable data, with failures reported inline.
- [x] Registered Samsung transport keys and mapped Play, Pause, Play/Pause,
  Previous, Next and Stop across modern key names and legacy Tizen key codes.
- [x] Re-enabled the focusable Samsung playback slider. Repeated D-pad
  Left/Right presses preview bounded ten-second steps, key release commits the
  seek, and Back cancels an uncommitted adjustment before leaving the player.
- [x] Passed 297/297 tests, TypeScript typechecking, modern Web and
  Samsung/Tizen production builds, and `git diff --check`.

## Behaviour-preserving refactor and artwork reliability

- [x] Corrected the pre-existing management API URL expectation failure and
  consolidated shared HTTP request mechanics without changing domain errors.
- [x] Decomposed application orchestration, playback presentation, persistence,
  polling, diagnostics, HLS policy, subtitle selection and styles into focused
  units while preserving current behaviour.
- [x] Added characterization and regression coverage around high-risk route,
  queue, runtime, polling, HLS, subtitle and artwork mechanics.
- [x] Retained one eagerly loaded application bundle with no `React.lazy`,
  dynamic module imports, route splitting or deferred feature chunks.
- [x] Consolidated and preloaded the canonical logo while retaining viewport
  lazy loading for ordinary catalogue artwork.
- [x] Hardened intermittent poster loading with longer bounded transient
  retries, invalid-response rejection, cache eviction and bounded browser
  decode recovery.
- [x] Passed 189/189 tests, TypeScript typechecking, modern and Samsung/Tizen
  production builds, and `git diff --check`.

Evidence: [refactor and artwork reliability record](2026-08-31-refactor-and-artwork-reliability.md)

## Profile-informed local playback preparation

- [x] Unified immutable catalogue profiles and session-derived source facts as
  one normalized client-side technical profile.
- [x] Made detail-page profile arrival preconstruct and wire the application-
  scoped media element and start the shared platform-capability probe.
- [x] Cached platform capability detection across playback generations and made
  every successful session response complete the same local preparation path.
- [x] Preserved immediate session negotiation when profile data is pending,
  missing or still in flight; source-specific work still waits only for the
  authoritative negotiated URL.
- [x] Added subscriber-aware profile cancellation with a two-request abandoned
  corpus-building tail; overflow aborts oldest-first without poisoning endpoint
  health, while successful tail results still populate the immutable cache.
- [x] Passed 278/278 tests, TypeScript typechecking, modern Web and Samsung/Tizen
  production builds, and `git diff --check`.

## Manage selection, dialogs and filesystem navigation

- [x] Made Unmatched refresh bypass browser caches and expose its active state.
- [x] Added compact unmatched rows with independent review state, multi-select
  checkboxes, bulk retry and confirmed bulk deletion with partial-failure
  reporting.
- [x] Kept unmatched metadata left-aligned at responsive widths, added full-list
  select-all and bounded 20-item paging.
- [x] Added a reusable fixed-size asynchronous icon button; refresh controls now
  disable and replace their icon with a spinner for the full request lifetime.
- [x] Replaced every browser confirmation dialog with a reusable, focus-managed
  application modal, including the Status identity-association reset.
- [x] Moved folder creation into a modal and enabled confirmed file or folder
  deletion through the existing MachaDFS path API.
- [x] Added linked path breadcrumbs and icon controls for up, refresh and open.
- [x] Tightened the main and secondary navigation stack without changing their
  shared visual treatment.
- [x] Passed 283/283 tests, TypeScript typechecking, modern Web and Samsung/Tizen
  production builds, and `git diff --check`.

## Application-level connection gate

- [x] Centered asynchronous icon contents reliably in both modern and legacy
  Samsung layouts.
- [x] Classified all-node transport exhaustion separately from reachable-node
  API/HTTP errors and reduced its UI copy to one concise message per outage.
- [x] Routed transport exhaustion to `/manage/settings/connection` and stopped
  mounting ordinary API-consuming screens while the gate is active, without
  unmounting an existing player.
- [x] Added locked first-run Welcome setup when no endpoints are configured;
  proposed endpoints and credentials are checked before persistence and the
  application cannot be entered until at least one endpoint responds.
- [x] Passed 289/289 tests, TypeScript typechecking, modern Web and Samsung/Tizen
  production builds, and `git diff --check`.

## Consistent Status refresh controls

- [x] Added the shared fixed-size refresh icon to Overview, Client,
  Connectivity, Nodes and individual node-detail headers, including loading and
  error states.
- [x] Retained each page's appropriate refresh mechanics: cluster reloads,
  explicit client endpoint probes, and connectivity probes followed by current
  status.
- [x] Removed the separate `Check connectivity` text action; Connectivity and
  node detail now expose that operation through their standard refresh icon.
- [x] Passed 290/290 tests, TypeScript typechecking, modern Web and Samsung/Tizen
  production builds, and `git diff --check`.

## Playback admission endpoint exhaustion

- [x] Made node-local HTTP 5xx responses retryable for safe cluster reads and
  idempotent playback generation creation while preserving single-attempt
  management mutations.
- [x] Added regression coverage for active node A failing, node B returning a
  media-open 500, and node C admitting the identical replacement request with
  the same idempotency key.
- [x] Passed 277/277 tests, TypeScript typechecking, modern Web and Samsung/Tizen
  production builds, and `git diff --check`.

## Consistent section navigation

- [x] Restyled the Music secondary navigation to match the main navigation and
  reused the same shell-level component for Status and Manage.
- [x] Added routed Status sections for Overview, Client, Connectivity and Nodes;
  each route renders only its own content, while Client remains purely local and
  does not wait for cluster status.
- [x] Moved Unmatched, Files and Settings out of Manage's pill tabs and into the
  shared secondary navigation row, preserving management availability rules and
  TV focusability.
- [x] Passed 278/278 tests, TypeScript typechecking, modern Web and Samsung/Tizen
  production builds, and `git diff --check`.
