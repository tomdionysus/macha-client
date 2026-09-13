# Active tasks and concepts to explore

Last updated: 2026-09-13

This is the working backlog for the current session. Add new work here. When an
item is implemented and its stated verification is complete, remove it from
this file and add a dated entry with evidence to `COMPLETED.md`.

The existing documents in this directory remain the detailed plans,
checkpoints, and verification records. This file is only the current index.

Scope: this file (and this repo) is macha-client only — the UI/playback
client. Server-side backlogs (e.g. `macha`'s own `TODO/ACTIVE.md`) are a
different repo's concern and are not tracked or duplicated here, even when a
client bug and a server bug are related.

**The test cluster is deliberately not uniform.** `gbni-1` (`10.44.1.50`) is
wired, `gbni-2` (`10.44.1.51`) is on **wireless** (a knowingly flaky link),
and `es-1` (`10.34.1.50`) is a remote site across the internet. This is the
point — the client is developed in the conditions it must actually survive.
So: never read a cross-node measurement as if the nodes were equivalent, and
never call a slow or stalled result on `gbni-2`/`es-1` a client bug until the
same test has been run against wired `gbni-1`.

Equally, do not reach for the topology to explain every odd number. On
2026-09-07 the server's `peer_latency_ms` looked badly asymmetric
(gbni-1→gbni-2 114 ms against gbni-2→gbni-1 4 ms) and the tidy explanation —
every path *toward* the wireless node slow, wifi power-save buffering inbound
frames — was wrong. The metric was sampling every control call, counting
payload and handler time as network distance. Sampling heartbeat pings only,
the same pair measured 2 ms and 5 ms and es-1→gbni-2 went from 207 ms to
62 ms. Check how a metric is sampled before explaining its shape with the
wiring.

**Where this stands, 2026-09-13.** 0.14.0 shipped Matroska direct play, the
login wall for registered-users-only deployments, role-gated navigation with
`view_status`, and the move of session role policy into
`@machafoundation/core`. `COMPLETED.md` has the detail and the measurements.

**Read this first if you are picking this up cold.** The artwork P0 below is
the oldest open item and the one with the clearest user impact — Tom raised
image caching as a P0 in its own right on 2026-09-13 and it has not been
started; it is the next thing to do. Everything under "shipped unseen" needs
Tom present: a television, or a login this assistant will not perform.

`@machafoundation/core` is a `file:../macha-ts` link in this repo as of
2026-09-13, not a published version — core's working tree is what this client
compiles against, so a rebuild there lands here immediately. Address that
session as `Macha NPM Core`.

Priority reflects active-breakage/user-impact, not effort: P0 is a live or
recently-live correctness problem in playback itself; P1 is important,
scoped, and actionable now; P2 is real but either blocked on something
outside this repo or needs groundwork before it can be started safely.

## P0 — 40% of artwork is unreachable when one of three nodes is down

**Not this repo's fix.** Raised with the server session 2026-09-13 and noted
here only because it presents as a client bug and will be re-diagnosed
otherwise. Do not spend client time on it; re-measure and confirm it has gone.

With `ramaroja` unreachable, two posters were blank on Home. Both artwork
objects answer **404 from `inverbeg` and from `macnessa`** while a control
poster that renders answers 200 from both — so the bytes are on the node that
is down, and no client failover can help.

The nodes' own `catalogue/status` says why: of 1618 artwork objects,
`inverbeg` holds 516 locally (32%) and **`macnessa` holds 0**. With
replication 2 across three nodes each should hold roughly 1079. A sample of 24
movie artwork objects split 14 on both reachable nodes, **0 on exactly one**,
10 on neither — and that empty middle bucket is the tell: nothing is placed on
a pair containing the down node plus a reachable one.

One thing the client cannot distinguish from outside, flagged to the server:
a 404 may mean "I do not hold this" or "I do not hold it and could not read it
from its DHT owner either". Those are different bugs with different fixes.

**To re-check:** `GET /api/v1/catalogue/status` on each reachable node and
compare `local_artwork_objects` against `artwork_objects`.

**Re-checked 2026-09-13 — not fixed.** `gbni-1` (server 0.38.0) reports
`local_artwork_objects: 0` against `artwork_objects: 1618`. Same shape as the
original finding, now on a different node, so the replication fault is not
node-specific and has not gone. Only `gbni-1` was reachable at the time
(`gbni-2` and `es-1` both down), so the three-node comparison could not be
repeated — but a node holding none of 1618 objects is the fault by itself.
Still the server's to fix; re-check again when the cluster is whole.

## P0 — Artwork caching: posters reload from scratch and the viewer waits

Raised by Tom 2026-09-13 as a P0 in its own right, and **not started**. His
words: images "load slowly, and when 'cached' they're just less slow. Changing
anything or waiting for a minute or two, and they all load from scratch again.
It's crap." The governing rule is [[never make the user wait]] — a poster the
viewer has already seen should never be fetched twice.

**The framing he set, which is the useful part:** *media posters are long-term
cache objects*. They are content-addressed and immutable — artwork is served by
id, any node serves the same bytes, and an artwork capability URL is a cluster
credential whose signature covers the id and expiry but never the host. Nothing
about a poster changes. So anything that re-fetches one is wrong, not slow.

His questions, which want answering before anything is built:

- What strategies are available beyond whatever is happening now? The Service
  Worker already exists in this repo for Direct Play byte-range read-ahead
  (`public/macha-direct-play-sw.js`) and is a candidate, but it is refused on
  Tizen — a widget served from `file://` cannot register one — so whatever is
  chosen has to degrade on the set rather than depend on it. Cache Storage,
  IndexedDB and plain HTTP caching are all on the table.
- **Does this need server involvement?** Probably the crux. Immutable artwork
  wants long-lived `Cache-Control: immutable` and a stable URL, and a *signed*
  URL with an expiry is the opposite of a stable cache key — the signature
  changes, so the cache misses, which may be the whole of the reported
  behaviour. Measure that before designing around it.

**Do not start by writing a cache.** Start by measuring what actually happens
to one poster across a reload and across a minute: which request goes out, what
the response headers say, whether the URL differed from last time, and where
the time goes. Tom's "changing anything and they all load from scratch" is a
symptom with several possible causes and they need separating first.

Related but distinct: the artwork *replication* P0 above is a server-side
availability fault, not a caching one. Do not conflate them.

## P2 — Do not work around the anonymous account's missing password

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

## P2 — One small account-screen fault Tom found

Both raised 2026-09-13, neither investigated yet.

- [ ] The **Discard** button on edit user is styled wrongly (`UsersScreen`).
- [x] The **anonymous user has no password and one cannot be set** — answered
      by the server session: deliberate, and a security fix. See the P2 above.

## P1 — The session dies with the tab, which suited anonymous and does not suit accounts

The token is cached in the host's *ephemeral* storage — `sessionStorage` on
web — which core documents as matching an anonymous session's own lifetime.
That was right when every session was anonymous. Now that people have
accounts, a new tab means signed out, and tokens are 30 days with no sliding
renewal, so the storage choice is the only thing throwing the session away.

Needs a decision rather than a patch: persist the token (and accept a bearer
token at rest in `localStorage`), or keep it ephemeral and make signing in
cheap. Note the same choice faces the React Native clients, where "ephemeral"
means the process rather than a tab, and core's docstring says a host wanting
survival must pass persistent storage **explicitly** rather than inherit it.

## P1 — Drop the `/users/me` fallback once every node names the session user

`useCurrentSession` fetches the session, and when it carries no `username`
falls back to `GET /api/v1/users/me` purely to learn a name. The 0.37.x nodes
named no user at all; 0.38.0 added `user_id`; `username` arrived 2026-09-13.

- [ ] Confirm every node in the cluster reports `username` on
      `GET /api/v1/session`, then delete the fallback and its round trip.
      Keep it until then — a mixed-version cluster is normal here.

**2026-09-13: one node of three confirmed.** `gbni-1` on server 0.38.0
returns `username` alongside `user_id` on both the mint and
`GET /api/v1/session`. `gbni-2` and `es-1` were down and remain unasked, so
the fallback stays. Check those two and this becomes a deletion.

## P2 — Should `root` keep `manage_users` permanently?

Tom's call, open since 2026-09-12. Today root is protected from rename and
deletion but its roles are editable, so the last-manager check guarantees
*a* holder exists without guaranteeing it is reachable: if the only
`manage_users` account has a lost password and root no longer holds the role,
the install has no way back. The server session agreed with the reasoning and
put it to Tom rather than deciding it.

Nothing to build either way — the UI renders from the per-field `mutable`
block, so it is already correct whichever he chooses.

## P2 — Repo conventions not yet applied here

Tom set these 2026-09-13 and asked every session be told; this repo predates
them.

- Work happens on a long-lived **`develop`**; releases are tags on `main`.
  This repo's working branch is currently named `0.14.0`, which is the thing
  the convention exists to prevent — branch `0.13.0` already collided with tag
  `0.13.0` and had to be renamed.
- The remote still carries branches `0.13.0` (redundant with its tag) and
  `0.14.0`.

**Do not push or delete remote branches without Tom asking for that
specifically.** A general go-ahead is not approval; this was reinforced after
a push that had only been approved in general terms.

## P1 — What Tizen 3 actually provides, and one build behind

Measured on the set 2026-09-10, not inferred: a separate signed widget
carrying this app's own `polyfills-legacy` chunk, installed alongside Macha,
run, and uninstalled. UA `Tizen 3.0 / AppleWebKit 538.1`. Prompted by
`@machafoundation/core`'s new `types/platform-neutral.d.ts`, which states the platform
surface core is allowed to assume — a gate that proves core does not
*reference* anything outside the list, and cannot prove a host *provides* it.

**`AbortController` does not exist on Chromium 47 at all**, and the legacy
polyfill chunk does not supply one (core-js has none). It works here only
because `src/platform/AbortControllerPolyfill.ts` installs one from
`main.tsx:25` before anything else runs. So core's declared surface is met on
this platform by a **consumer-supplied shim**, not by the host. That shim is
load-bearing for every bounded request in the app: delete it, or let anything
run before it, and `fetchWithTimeout` throws on its first call.

**Two real gaps, both silent:**

- **`RequestInit.cache` is not merely unsupported — the property does not
  exist.** `'cache' in new Request(url, {cache:'no-store'})` is `false`, so
  `no-store` evaporates with no fallback. A cached `/api/v1/catalogue/status`
  would let a dead node answer 200 and stay top of the endpoint ranking.
  Fixed in core 0.7.0, which appends `?_=<ms>` to the probe URL — the only
  mechanism all three hosts honour, and the only one that also defeats an
  intermediary cache on a WAN path like es-1.
- **`keepalive` is absent**, so the teardown `DELETE` does not survive
  navigation on this set. Best-effort session close is lost there and nothing
  else.

**`{ once: true }` is ignored by Tizen's native `addEventListener`** — the
options-object probe returns `false` and a `once` listener on `window` fires
twice. It does not bite core, but only because the one signal core uses
`once` on is our own `LegacyAbortSignal`, which honours the flag itself. It is
correct here by accident of the shim, not because the host obeys.

**Present and behaving**, verified against a live 401 rather than a
constructed object: `fetch` (native), `Response.url` populated,
`ok`/`status`/`statusText`/`headers`, and `json()`/`text()`/`blob()`;
`Headers` with `get`/`set`/`forEach` (which does iterate, lower-casing names);
`new Response(body, {status, statusText, headers})`; native `URL` with
`origin`; `Blob` size/type; `DOMException` constructible as `(message, name)`;
`crypto.getRandomValues`. `crypto.randomUUID` is absent.

**Not measured, and worth knowing before relying on it:** whether Chromium 47
honours `init.signal` at all. It almost certainly does not — `signal`
postdates this engine — which would mean `fetchWithTimeout` still rejects on
time (the race is in JS) while the underlying request runs to completion. The
probe's abort test never ran, because it was gated on a native
`AbortController` that turned out not to exist.

- [ ] **Deploy a post-0.7.0 build to the Samsung.** The wgt currently on the
      set was built at 00:53 and `c8b1bb8` landed at 01:09; the shipped bundle
      has zero occurrences of the cache-busted probe URL. The one platform
      where `no-store` vanishes without a fallback is the one still missing
      the fix. Awaiting Tom — an unrequested action on that television is what
      broke it in the first place.
- [ ] **Re-verify failover on the Samsung while there.** That set has never
      run the 0.6.3 container fix and the 7 s stall budget together, and that
      combination is the one nobody has seen work.

**If anyone repeats the probe:** installing and then uninstalling a second
widget left `macha00001.Macha` installed but unlaunchable ("Could not launch
the null application", three attempts, with the app still in `applist`). A
reinstall of the wgt fixed it. Budget a redeploy as part of the exercise
rather than discovering it afterwards.

## P1 — 0.14.0 shipped unseen on both televisions

Everything here is built, tested, and verified on the desk against gbni-1.
None of it has been looked at on a set. `COMPLETED.md` has what was built and
how it was measured; this is only what is left to confirm.

- [ ] **Android TV is the exposed host for Matroska.** It runs plain
      `WebPlatform` with no `neverDirect`, so if its WebView probes Matroska
      true it will direct play `.mkv` on the set. The only host where the
      container change can alter playback with no policy backstop — check it
      before the next Android build goes out.
- [ ] **Samsung: confirm, but the risk is nil.** `neverDirect: true` already
      forbids handing that set a whole file, so a Matroska claim changes only
      a reason string, not what is served. Worth logging what Chromium 47
      answers to the probe's impossible-codec guard, as a fact about the probe.
- [ ] **The login wall on a remote.** New markup on the screen a TV viewer now
      meets first, and focus is where this client has had trouble before.
      D-pad must reach both fields and the button — and the escape link to
      Settings → Connection must take focus visibly, because on a television
      it is the only way out and there is no address bar behind it.
- [ ] **The account control on a remote.** The identity is the trigger now, a
      wider target than the `⋯` it replaced, and its focus ring had to be
      restored explicitly against the base rule's specificity.
- [ ] **Signing in at all.** The post-login redirect and the refusal wording
      are unit-tested but have never run against a real account, because
      entering a password is off-limits to this assistant. One attempt by Tom
      settles both — as it does the Users screen, which has still never run
      against an account holding `manage_users`.

## P1 — The MPEG-TS preference is asserted, not gated

Samsung HLS playback is fixed (see COMPLETED.md). The reporting half of this
is now closed: server 0.33.1 states `output.container`, `@machafoundation/core` maps it,
and the player's top line shows the container actually served.

- [ ] **The preference is still not gated on a fact from the node serving
  it.** `copy_into_mpegts` exists on `operations` as of 0.33.1, and the
  chooser asks about whichever carriage the instruction names — but the facts
  are fetched from one node and the instruction may be performed by another.
  A cluster is not uniform in what its builds can do, and nothing checks that
  the node which answers can emit what the node which was asked said it could.

## P0 — Direct Play sometimes never starts: `<video>` element stuck at readyState 0 forever

**Top priority — actively breaks playback, found live tonight (2026-09-05).**
Environment: macOS Chrome 152.0.7977.77, dev server (`localhost:5173`), 3-node
cluster, title "The Boondock Saints" (`tmdb:movie:8374`), Direct Play mode
(mp4, video+audio `copy`), streamed from node `gbni-1` (`10.44.1.50:7438`).
Reproduced repeatedly across many separate attempts this session; NOT
reproduced on the very first attempt of the evening (see the pattern note
below — this may matter).

**Symptom:** after a normal, successful session-create (`session-created`
logs fine, `PlaybackSession`/`PlaybackOptions` all look correct), the
`<video>` element never starts receiving data. `video.readyState` stays `0`
(`HAVE_NOTHING`), `video.networkState` stays `2` (`NETWORK_LOADING`),
`video.buffered` stays empty, `video.error` stays `null` — forever (watched
up to ~4 minutes with zero change, no recovery, no error, no timeout). Only
one `media-stalled` DOM event ever fires (~3.2s after `loadstart`, every
single time); nothing after that.

**What's been ruled out, with live evidence:**
- **Not the server.** While a session was live and stuck, a server-side
  session on the `macha` (server) repo checked `gbni-1` directly: all
  process threads idle/parked on normal things, 0 active/queued extent
  work, 0 pending RPC bytes, every TCP connection on port 7438 healthy
  (bytes_sent == bytes_acked, no stale Recv-Q/Send-Q), journalctl clean for
  the whole window. Nothing server-side is waiting on this stream at all.
- **Not a slow/wedged connection either.** With the video element still
  stuck, a plain `fetch()` (with the same `Range` header) issued from the
  *same page, at that exact moment* to the *exact same URL* the video is
  stuck loading returns instantly (single-digit ms, correct `206`/
  `Content-Range`, correct bytes) — repeatable every single time this was
  tried, both against the read-ahead proxy URL and the raw cross-origin
  node URL. So the network path, CORS, and the node are all fine *for a
  fresh request* at the same instant the video's own request is dead.
- **Not the read-ahead Service Worker
  (`public/macha-direct-play-sw.js`).** Temporarily instrumented the SW's
  `fetch` handler (`handleProxy`) and its outbound `fetch()` call to
  `postMessage` the page the instant either one runs; confirmed the
  instrumentation itself works (a manual `fetch()` to the same proxy URL
  triggered it immediately). Reproduced the hang with the instrumentation
  live: **zero messages, ever** — the SW's fetch handler is never entered
  for the video element's own request. (Instrumentation has been fully
  removed; `git diff` on that file is clean.)
  - Also bypassed the SW entirely (unregistered it, blocked
    re-registration, pointed `video.src` straight at the raw
    cross-origin node URL) — identical hang. So it isn't the proxy layer
    either.
- **Not the redundant `video.load()` I initially blamed and fixed.**
  `WebPlatform.ts`'s reused-`<video>`-element reset used to do
  `video.pause(); video.removeAttribute('src'); video.load();`
  immediately before reassigning a new `src` in the same synchronous
  tick — a real, provable double-invocation of the media element load
  algorithm (see the regression test in `WebPlatform.test.ts`, which fails
  on the old code and passes on the fix). **This fix is real, safe, and
  kept** (removing genuine redundant work is correct regardless), but
  retesting live after shipping it reproduced the identical hang — so it
  was not the actual cause of tonight's bug. Flagging this clearly so a
  fresh session doesn't waste time re-deriving it, or wrongly trust that
  it's "the fix."

**Net effect:** every layer that can be instrumented from JS or from the
server says "no request ever arrived here." That was read as "this must be
an unfixable Chromium media-engine bug" — the user (rightly) doubts that
conclusion. Logging this instead of asserting it, so a fresh investigation
can either confirm it properly or find what was missed.

**Reinvestigated 2026-09-05, later the same day — found the actual
confound, "Chromium engine bug" conclusion retracted.** Reproducing live via
browser automation (this project's Claude-in-Chrome tooling) hit the exact
symptom above instantly, on the very first `play()` in a brand-new tab, with
two more independently-created `<video>` elements pointed at the identical
stuck URL *also* hanging at readyState 0 in the same tab — and
`performance.getEntriesByType('resource')` showed **zero entries** for the
URL on any of the three elements, meaning Chromium's renderer never
dispatched the request at the network layer at all (not queued, not
stalled — never attempted). That pointed away from connection exhaustion and
toward something suppressing the media pipeline itself. Checking
`document.visibilityState` mid-hang found it stuck at `"hidden"` **while
`document.hasFocus()` reported `true`** — the automated Chrome window was not
actually composited on-screen (confirmed with the user: it was occluded).
Screenshots still rendered throughout because the automation's screenshot
capture forces a render via CDP regardless of page visibility, masking the
occlusion completely from the tooling used to observe the bug.

Once the user brought the real window to the foreground and kept it focused,
the identical title/environment (`gbni-1`, Direct Play, same movie) played
cleanly through 5 back-to-back play/stop cycles in the same tab — readyState
4 every time, no hang, no error, one cycle run continuously past 280s. This
means the specific "zero bytes ever requested" symptom is fully consistent
with ordinary, well-documented Chromium background/occluded-tab throttling
of media resource loading, not an engine bug — and it's now the leading
explanation for the original conclusion too, since that investigation also
leaned on this same automation tooling (a manual `fetch()` from "the page,"
unregistering the SW, reading `video` state) to probe the hang, which would
have silently occluded the tab the same way. **Caveat, not fully closed:**
the original bug was witnessed directly by the user actively watching for up
to 4 minutes, not through automation, so tab occlusion alone doesn't
explain a human-witnessed hang unless something else (a second focused
window, e.g. DevTools undocked to another display) occluded the video tab
without the user noticing. Only 5 cycles were stress-tested today, not the
"dozens across an evening" from the original report, so the per-origin
connection-exhaustion lead below is weakened but not eliminated — it just
needs a real multi-attempt session with visibility explicitly confirmed
before trusting any future "stuck" observation.

**Process note for future investigation of any "stuck"/"never loads" symptom
via browser automation:** always check `document.visibilityState` (not just
`document.hasFocus()`) before trusting the observation, and keep the actual
window foregrounded for the duration of the test. This session's tooling
will happily keep taking convincing screenshots of a tab Chromium itself has
backgrounded.

**Leads NOT yet tried — most promising first:**
- **Per-origin connection exhaustion, accumulated across the evening's many
  repeated play attempts in the same long-lived Chrome process.** Chrome
  caps concurrent connections per origin (historically ~6 for HTTP/1.1;
  this node is plain `http://`, not `https://`). The *only* successful
  attempt tonight was the very first one of the session, before dozens of
  subsequent play()/reload cycles in the same browser profile; every
  attempt after that hung. If earlier aborted/superseded video sources,
  service-worker prefetch fetches, or health-probe connections to
  `10.44.1.50:7438` aren't fully closing, later requests to that same
  origin could sit queued behind a maxed-out connection pool — which would
  look *exactly* like this (readyState 0 forever, no error, a fresh
  `fetch()` from a **different** connection slot still succeeding). Not
  fully re-tested: only 5 quick play/stop cycles were run in the 2026-09-05
  reinvestigation above (all clean, visible tab) — dozens across a real
  evening session, matching the original report, still hasn't been
  reproduced cleanly. Note: `chrome://net-internals` cannot be reached via
  this project's browser-automation tooling at all (Chrome extensions are
  hard-blocked from navigating/scripting `chrome://` pages) — that check
  needs the user to open it manually, not automation.
- **Tried 2026-09-05: a brand-new `<video>` element per `play()` instead of
  reusing one.** Result was a wash, not a confirmation — under the tab
  occlusion confound above, two independently-created fresh elements hung
  identically to the original reused one; once the tab was genuinely
  visible, the existing reused-element code played cleanly across 5 cycles.
  So element reuse is now a weaker suspect than it looked: fresh and reused
  elements behaved identically in both the broken and healthy conditions.
  Not fully closed either way — no long-running (dozens-of-cycles) session
  has compared fresh-vs-reused elements side by side yet.
- **Never opened the real Chrome DevTools Network panel** (as opposed to
  the Resource Timing API / this session's network-request tool, both of
  which only ever record *completed* transfers and so cannot distinguish
  "never sent" from "sent, still pending" — this was a real blind spot in
  tonight's investigation, not a settled fact). The Network panel shows
  pending/stalled requests live, including Chrome's own stall reason
  (queueing, stalled, DNS, etc.), which would immediately confirm or kill
  the connection-exhaustion theory above.
- Not tried: reproducing with `video.crossOrigin` unset entirely (only
  ever tested with it left at `'anonymous'`, inherited from the pooled
  element).
- Not tried: a genuinely fresh, unbounded wait (>4 minutes) to see if it
  *ever* self-clears without intervention, versus truly hanging forever.

Do not re-do the ruled-out checks above without new evidence prompting it —
the point of this entry is to skip straight to the untested leads.

**2026-09-08: the symptom is now bounded, and did not reproduce.** The client
no longer waits forever on a source that never delivers — see the start
watchdog in `COMPLETED.md`, which fails the generation over to another node
and records whether the *browser* never dispatched or the *node* never
answered. That does not close this entry; it closes the unbounded wait.

Reproduction attempt, `document.visibilityState` confirmed `visible`
throughout (dev server, Chrome 151, gbni-1, The Boondock Saints, Direct Play,
DevTools docked in-window so it could not occlude): **15 consecutive clean
playbacks** — 12 of them play→stop→play inside one long-lived page, which is
the condition the connection-exhaustion lead requires. Zero hangs, zero
stalls, zero watchdog fires, time-to-first-frame flat at 1.3–2.4s with **no
upward trend**. With the 5 clean cycles of 2026-09-05 that is 20 confirmed-
visible attempts without a failure, against a failure history taken entirely
under unconfirmed (and probably occluded) conditions.

That weakens per-origin connection exhaustion considerably but does not kill
it: a flat first-frame time is what a healthy pool looks like, and the
original report spanned an evening with far more concurrent activity.

- **Connection exhaustion cannot be measured from JS — stop trying.**
  Confirmed this session: cross-origin Resource Timing to the node is opaque
  (no `Timing-Allow-Origin`, so `requestStart`/`connectStart` are zeroed), and
  the media bytes travel through the Service Worker, whose cross-origin
  fetches never appear in page Resource Timing at all. 63 requests to gbni-1
  were recorded with no usable timing on any of them. The DevTools Network
  panel really is the only route, and it is only informative *during* a hang —
  so it needs a reproduction first, not a watch.
- The next genuinely new evidence will most likely arrive on its own, from
  `source-start-starved`'s `dispatch` field, the next time a real viewer hits
  this. That is now a better instrument than another scripted evening.

## P0 — Any-node client and seamless playback failover

Detailed plan, phase-by-phase status, and dated live-verification evidence:
[the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md).
Phases 0–5 are implemented and live-verified against a real 3-node cluster
(repeated `systemctl stop`/`start` against real nodes, not synthetic
failures). Remaining work, in priority order:

- [ ] **Measure playback under live import load (requested 2026-09-07 by the
  Macha server session; no deadline, the import runs for days).** Needs a
  genuinely foregrounded Chrome window — see the occlusion confound in the
  P0 above; numbers from an occluded tab are worthless. Measure both a
  locally-written film (`/UAT/final/gbni-1/Jurassic.Park.1993...mp4`) and a
  remote-written one (`/UAT/final/es-1/Idiocracy 2006 ... BONE.mkv`, the one
  that matters — the es-1 WAN is saturated by the import, so this measures
  whether viewer traffic is prioritised over bulk import traffic). For each:
  (a) time to first frame, (b) 60 s of playback, stall-free or not, (c) a
  seek to the middle of the file and how long until it plays again. Expect
  the remote film to be worse; the useful answer is *how much*. Report
  numbers back to that session. See also the >90 s mid-file segment stall
  they measured server-side, under the hard-reactivation item below.
- [ ] **Finish Phase 6 UAT.** Direct Play range-transfer failure is verified
  (silent mid-stream swap, no video reload, confirmed live with zero
  measured stall). Not yet *live-exercised*: HLS failure, and failure
  specifically during session POST and manifest transfer.
  **Audited 2026-09-06** (automated-coverage check only, no live cluster
  available that session) for what each of these already proves or doesn't
  at the unit/integration level, ahead of the still-needed live UAT:
  - Session POST failure: well covered for Direct Play
    (`ClusterPlaybackResolver.test.ts`, `ClusterNodeFailover.test.ts`); added
    an equivalent HLS-mode (`remux`) test proving the candidate loop is
    genuinely mode-agnostic, not just implied.
  - Found and fixed a real bug while auditing this, unrelated to live UAT:
    `ClusterPlaybackResolver.resolve()` (the *initial* session POST) called
    `create()` without `attemptTimeoutMs` — unlike `failover()`/
    `prepareAlternate()`, which both pass it. A node that hung (accepted the
    connection, never responded) on the very first POST would hang playback
    forever with no failover, no error, nothing queued behind it to notice.
    Fixed: `resolve()` now passes `this.generationAttemptTimeoutMs` like its
    siblings. Regression test in `ClusterPlaybackResolver.test.ts`
    ("abandons a hung initial session POST...") confirmed to fail (real
    5-second timeout) against the pre-fix code.
  - HLS failure (mid-stream): already has full-stack coverage
    (`ClusterNodeFailover.test.ts`, "prepares an HLS standby..."), but the
    trigger is synthetic (`player.degrade()`/`.fail()` calls), not a real
    hls.js manifest/segment failure flowing through `WebPlayer`. Checked
    `WebHlsPolicy.ts`'s error classification specifically: it branches only
    on `data.type` (`NETWORK_ERROR`/`MEDIA_ERROR`), never on `data.details`
    — so a manifest-load error is already provably classified identically
    to the already-tested `fragLoadError` case; no test gap there. Proving
    a *real* hls.js manifest fetch failure end-to-end would need a heavier
    fixture (real `hls.js` against jsdom) — not attempted; the existing
    synthetic-trigger integration test plus the type-based policy unit
    tests are judged adequate until/unless that's shown insufficient.
  - Pause: confirmed not applicable. `PlaybackCoordinator.setPaused()` is
    purely local (`player.pause()`/`.resume()`) — no resolver call exists,
    so there is nothing server-side that could fail. Removed from this list.
  - **Seek and option-change: NOT just untested — a real, undesigned gap.**
    `PlaybackCoordinator.drainMutations()`'s catch block (handling every
    seek/representation/subtitle PATCH failure from `resolver.update()`)
    only does `patchSnapshot({ notice: ... })`; it never calls `this.fail()`.
    Failover-on-error only exists on the *player's* failure/degradation
    channel, not on a failed PATCH itself. So today, a seek or option-change
    that fails because the owning node just died gets a client-side notice
    and otherwise silently does nothing — no retry, no failover, no
    recreation on another node — until/unless the player *also* independently
    notices the stream died. **Deferred deliberately (2026-09-06): revisit
    with the live cluster**, since judging the real UX cost needs to be seen
    rather than reasoned about. Analysis done so far, so it need not be
    re-derived:
    - Severity is lower while *playing* — the dead node kills the stream too,
      so the player's own failure channel eventually triggers failover
      anyway; the cost is latency plus a confusing "my seek did nothing".
      While *paused* it is a genuine dead end: nothing is loading, so no
      player error will ever arrive, and the seek is simply lost.
    - The naive implementation is actively dangerous. `ClusterPlaybackResolver
      .update()` wraps every failure via `endpointFailure()`, and
      `retryableEndpointFailure()` returns true for *any* `MachaEndpointError`
      — so gating on the wrapper treats a 400/422 "server rejected this
      request" as node-loss evidence, and would burn through every candidate
      node before landing on a fatal error screen. Strictly worse than the
      current notice.
    - A correct discrimination does exist: the raw error survives as
      `MachaEndpointError.cause` with its HTTP status intact, and
      `retryableEndpointFailure(cause)` classifies correctly (TypeError/5xx/
      429 → true; 400/404/422 → false). The open design question is layering:
      `PlaybackCoordinator` is deliberately cluster-agnostic and does not
      import the cluster error types, so this needs either a small
      classification hook on the `PlaybackResolver` interface or the resolver
      tagging the error — plus a decision on how it interacts with the
      fail()/seek-race deferral (see `COMPLETED.md`, 2026-09-06).
    - **Fixed separately, no design decision needed:** the same failure path
      used to leave `seek()`'s optimistic target pinned forever (see
      `COMPLETED.md`). That was the user-visible half of this gap and is done;
      what remains here is purely the failover-policy question.
  Also still open (needs the live cluster, not addressable by more unit
  tests): prove the client never navigates away, loses its queue/
  preferences, creates an unbounded retry/session loop, or waits on
  old-node cleanup during any of the above.
- [ ] **Blocked on the server, no client action available:** a node that
  becomes the failover target must actually be able to read the extent it's
  handed — the 2026-09-01 UAT hit a real `open media: Input/output error`
  on the alternate node. Sent to the server session 2026-09-04; awaiting a
  response. Client-side failover correctness can't fully prove out until
  this is fixed, since a "successful" failover to a node that can't read
  the data isn't actually successful.
- [ ] **Root-cause the hard-reactivation seek failure.** A full session
  reactivation (reload) at a non-zero position can fail instantly
  (`NotSupportedError`, zero bytes ever requested) even though the
  underlying byte range is confirmed valid and fully readable (verified via
  direct `curl` range requests against the exact node and offset). Leading
  hypothesis: an MP4/MKV container cannot begin decode from an arbitrary
  byte offset without a keyframe-aligned, container-aware start, and the
  hard-reactivation path may be attempting exactly that. This blocks the
  remaining Phase 6 boundaries above (pause/seek/option-change all force a
  real reactivation).
  **A candidate raised and then disproved, 2026-09-08 — recorded so nobody
  re-raises it.** Transformed playlists are served as
  `#EXT-X-PLAYLIST-TYPE:EVENT` with no `#EXT-X-ENDLIST` (verified off the wire
  on 0.36.0, remux and transcode alike), so `video.duration` and
  `video.seekable` only ever reach the generated frontier — Clerks' element
  read 8.05 s for a 92-minute film. That was reported as the cause of this
  entry and **it is not**. Two live checks killed it:
  - The scrubber does not use `video.duration`. `PlaybackCoordinator` prefers
    `session.durationMs` (`durationMs: session?.durationMs || next.durationMs`),
    and the UI for that same Clerks session correctly showed **1:31:46** with
    the scrubber max at 5,506,272 ms.
  - A seek past the frontier works. Driven with real key input on a live
    transcode buffered to 426 s with the frontier at 462 s: presses inside
    coverage logged `seek-local`, presses beyond it logged
    `seek-needs-generation`, coalesced into **one** `session-update` PATCH, and
    `generation-update-ready` → `source-activate` had it playing again at
    10:38 after 7,275 ms.
  So the client already implements the server's stated contract (timeline from
  the session, `PATCH seek_ms` for anything past the frontier), and the
  EVENT playlist is a deliberate 0.32.14 fix for the 98 s black screen this
  project itself measured — proposing a VOD list was proposing to revert it.
  Also disproved on the way: `localSeekCoverage()` does **not** over-report for
  transformed playback; it returns buffered ranges, which is honest.
  Still open and genuinely unexplained: the `levelLoadError` below.
  **Possible server-side component, 2026-09-07 — do not assume this is
  purely a client bug before checking.** The Macha server session probing
  `/api/v1/playback/sessions` on gbni-2 during the live import measured
  transcode-mode segments generating at ~0.7 MB/s and **a mid-file segment
  request that did not return within 90 s**, for both a locally-written and
  a remote-written film. That is the same shape as this symptom (a seek to a
  non-zero position that never produces bytes) arriving from the other side
  of the wire, so the container/keyframe hypothesis above is no longer the
  only candidate. Their probe was transcode mode; whether the real player's
  direct/remux path (HEVC-capable client) hits the same wall is exactly what
  the import-load playback UAT (first bullet of this section) should settle.
  Measure that before spending more time on the client-side hypothesis.
- [ ] **Phase 3 compatibility-path rationalisation** — explicitly deferred,
  not actionable yet: blocked on a minimum-supported-node-capability
  guarantee (immutable media profiles) that does not exist yet.

## P1 — Surface server self-healing state (server 0.30.0–0.32.0)

Requested 2026-09-06 by the Macha server session across three messages
(disciplines 2–4 of its self-healing programme), rolling out gbni-1 →
gbni-2 → es-1. Three related pieces of server state the client cannot show
at all today; they share one prerequisite (the client does not read
`diagnostics` from `/api/v1/status` anywhere yet), so do that once and hang
all three off it rather than three times.

Docs: `docs/management.md` "Parked publications" / "Metadata conflicts",
`docs/configuration.md` "Retry budgets and parking", `docs/metadata.md`
"What a snapshot carries, and what leaves it".

### Prerequisite — model `diagnostics` in `ClusterStatusApi`

- [ ] Add `diagnostics.filesystem` and `diagnostics.metadata` to the
  `/api/v1/status` model and surface them on `StatusScreen`. Every field is
  optional: a mixed-version cluster will have nodes below 0.30.0, and the
  counters arrived across three separate server versions.
  - `filesystem` (0.30.0): `parked_publications` (standing count — warn
    badge when > 0, linking to the list), `publication_retries_backed_off`
    (cumulative, informational).
  - `filesystem` (0.31.0), all cumulative and informational — non-zero means
    "read the WARN lines from the last boot", not an outage:
    `journal_recovery_skipped_frames`,
    `journal_recovery_quarantined_bytes`, `recovery_dropped_operations`,
    `publications_abandoned`.
  - `filesystem` (0.32.6): `mountpoint_immutable` (bool — the host
    directory under the mount is immutable; expected `true` on every node
    after that deploy) and `mountpoint_stray_entries` (int — files found on
    the host disk *under* the mount path at startup; expected `0`).
    **`mountpoint_stray_entries > 0` gets a red badge and makes the node
    unhealthy in whatever health summary we show**, not merely a counter:
    those files are hidden by the mount and are not in Macha at all. This
    exists because an rsync starting 25 s after a daemon restart, before the
    mount came up, wrote 52 GB into es-1's host root disk (finding #7 of the
    import). Show both next to `parked_publications` in the node view.
  - `rpc_transport` (0.32.7, not deployed yet): `peer_latency_ms` — node id
    to smoothed control round trip in ms, the measure commits use to pick
    the nearest replica.
  - `metadata` (0.32.7, not deployed yet): `mutations`,
    `mutation_retention_ms_total`, `mutation_retention_ms_max`,
    `mutation_publish_ms_total`, `mutation_publish_ms_max`. Show retention
    and publish *averages* (total ÷ `mutations`) next to the max, not the
    raw totals — a running total is unreadable on its own.
  - `metadata` (0.32.0): `conflicts` (standing total — badge when > 0,
    linking to the list), `namespace_conflicts`, `catalogue_conflicts`,
    `tombstones` (retirement tombstones in the snapshot), and the
    process-lifetime counters `conflicts_superseded`, `conflicts_resolved`.
    Label those last two **"since process start"** — they reset on every
    restart, so a `0` is indistinguishable from "never ran" (confirmed with
    the server session 2026-09-07; a persisted cluster-wide total is coming
    in a later API change, at which point this label can go).

Two presentation rules the server session asked for specifically, both
derived from a real fault found during the 2026-09-07 import UAT below:

- **Publication progress is `completed` vs `started`, and flat is a
  warning.** `data_publications_started` rising while
  `data_publications_completed` stays flat for minutes *and* spool bytes are
  not falling is a stall, not slow progress. That exact pattern (114 started
  / 0 completed on gbni-1) turned out to be every publication thread parked
  behind a one-op-per-commit namespace queue. Worth a warning, not just a
  number.
- **`retained_memory.owners.publication` is the saturation signal on a
  small node.** On gbni-1 (4 GB) it sitting near ~500 MB means the importer
  is saturating retained memory and writes are being held back — 0.32.1
  makes them wait rather than fail, so nothing else surfaces it. Watch
  `shed_requests`, `cancelled_waits` and the `waits` counters alongside it.

### Parked publications (0.30.0, commit `bb3697c`)

A FUSE
write whose publication keeps failing transiently is now retried with
per-inode exponential backoff and then *parked*: the bytes stay in the
spool/journal and it leaves the loader queue so everything else keeps
publishing, but an operator must retry or abandon it. Parked data is
invisible until someone reads the server docs.

Wire contract (existing authenticated `/api/v1/manage` prefix):
- `GET /api/v1/manage/filesystem/parked-publications` →
  `{ parked: [{ inode: u64, path, error_code: int, error_message, attempts:
  u64, failing_for_ms, parked_for_ms, pending_bytes }] }`; empty array when
  nothing is parked.
- `POST .../parked-publications/{inode}/retry` — resets the retry budget and
  re-queues. 204 / 404 (not parked) / 400 (non-integer inode) / 405.
- `POST .../parked-publications/{inode}/abandon` — **destructive**, discards
  the unpublished generation from the spool. Same status codes. Must sit
  behind an explicit confirmation step.
- Existing `namespace_blocked_op` can now carry `error_code` `EAGAIN` /
  "retry budget exhausted" — that keeps retrying at ceiling backoff, so
  present it as "stuck, still retrying", not a hard failure.

- [ ] Add the three management calls to `ManageApi`/`MachaManageApi` (+
  `ClusterManageApi` passthrough) and a parked-publications view. Reuse the
  unmatched-files pattern rather than duplicating it: `IngestScreen` already
  does list → per-row retry → destructive delete against
  `/api/v1/manage/unmatched`, which is the same shape.

### Metadata conflicts (0.32.0)

Two concurrent writers publishing duplicate media paths left 116 standing
conflicts in the production namespace that nobody could see. 0.32.0 prunes
the ones a later write already decided and exposes the rest.

- `GET /api/v1/manage/metadata/conflicts` → `{ generation: u64, conflicts:
  [{ id: sha256 hex, kind: "namespace_entry" | "catalogue_root", key (path,
  or `"catalogue_root"`), left_head: hex, right_head: hex, base, left,
  right }] }`. For `namespace_entry`, `base`/`left`/`right` are
  `{ type: "file" | "directory", size: u64, mtime_ns: u64, version: u64,
  extents: u64 }` or `null` (absent on that side); for `catalogue_root`
  they are object-id strings or `null`. `503 metadata_unavailable` while the
  node has no snapshot yet — a normal transient state, not an error screen.
- `POST /api/v1/manage/metadata/conflicts/{id}/resolve?choice=left|right|base`
  — installs that alternative and drops the conflict in one metadata commit.
  204 / `409 not_standing` (superseded by a later write, or already
  resolved) / `400 bad_choice` / 405.

- [ ] Conflict list + side-by-side resolution view: show both alternatives
  (size / mtime / extent count) before the operator picks, and label `base`
  as "restore the common-ancestor value". A `409 not_standing` is expected
  in normal use (the server resolved it first) — refresh the list and say
  so, don't present it as a failure.
- [ ] Verify live once each version is deployed (gbni-1 first).

## P1 — An https deployment against http nodes breaks Direct Play entirely

Not observed, derived from the mechanism 2026-09-09, and recorded because it
is invisible in development and total in production.

The read-ahead worker gates on `window.isSecureContext`. Today the dev client
is `http://localhost:5173`: localhost *is* a secure context, so the worker
registers — and the page is not https, so the worker fetching
`http://10.44.1.50:7438` is not mixed content and goes through. Both halves
happen to line up.

Serve the same build over **https** against **http** nodes and they come
apart. The worker still registers, but every fetch it makes is now active
mixed content from a secure context and is blocked by the browser. And this
does not merely cost the seamless failover: `directPlayReadAheadUrl()` has
already put the proxy URL in `video.src`, so the element is pointed at a
worker that can no longer fetch anything. **Direct Play breaks outright**, on
453 of 748 titles, with no code change and nothing in the logs to explain it.

- [ ] Decide the behaviour deliberately rather than discovering it. The cheap
      guard is to treat "page is https and the node is http" as read-ahead
      being unavailable — the same fall-back-to-the-native-URL path that
      already exists when no Service Worker is present, which is correct and
      already tested. Losing read-ahead there is a real cost; breaking Direct
      Play is not a cost, it is an outage.
- [ ] The real fix is TLS on the nodes, which is already in motion — haproxy
      is installed on es-1 for TLS offload, and the server replaced
      `api_host`/`api_port` with a scheme-carrying `api_endpoint` partly for
      this reason. Until then the guard above is what keeps an https
      deployment working at all.
- [ ] Same constraint governs whether the seamless path could ever work in an
      Android WebView: it needs a secure origin *and* https nodes, so it is
      blocked on the same thing.

## P0 — A ready standby is discarded 33 s before it is used

Measured live 2026-09-08, web client, remux/HLS generation on gbni-2, node
stopped mid-playback:

```
397973  source-degraded (fragLoadError)
398240  alternate-ready -> gbni-1          <- rescue ready 267 ms in
428241  alternate-recovery-window-expired  <- thrown away, unused
461395  source-terminal-failure
461548  source-failover-ready -> gbni-1    <- the same work, done again
```

**63.6 s of black screen where the replacement was ready in 267 ms.**

Two budgets chosen independently, each defensible, whose product is a rescue
that always goes stale. `ALTERNATE_RECOVERY_WINDOW_MS` holds a standby for
**30 s**. hls.js's `errorRetry` is 6 attempts backing off 1/2/4/8/8/8 —
about 31 s — and `managedHlsErrorAction` permits one `restart-network` per
generation, which resets that budget, so the primary cannot go fatal for
~63 s. `recoverFromSourceFailure` only runs on fatal. The window therefore
expires before anything can ask for it, every time.

A longer window is the wrong fix: it would make the rescue survive, but the
viewer still waits for the fatal. Once an alternate is ready *and* the primary
is still producing degradation evidence, there is nothing left to wait for —
retrying a node already replaced is the whole 63 seconds.

`promoteReadyAlternate` landed in `@machafoundation/core` 0.6.1 and answers that.

- [ ] **Re-measure. This is the only thing left in this entry.** The bar is
      set by the path that works: the silent Direct Play swap failed over in
      **17 ms** on the same cluster and title, uninterrupted
      (`alternate-promoted-silently`). Nobody has watched the managed-HLS path
      since the fix, so the 63.6 s figure above is still the last measurement
      taken.

**The Samsung half of this entry is closed** — the cluster-exhaustion symptom
that shared this section turned out to be a different defect entirely
(failover asked for the wrong segment container) and is now in `COMPLETED.md`
under *"Samsung failover plays: a replacement asks for the carriage its
generation was created with"*, together with the two wrong theories it
produced and the first-fragment gate that was built to test one of them.

## P1 — Android TV plays 5.1 titles without downmixing them

**Superseded 2026-09-10, and the heading was the symptom.** Tom: *"The 2 min
gap was observation noise."* Nothing about this fault is time-dependent.
**Stereo titles play correctly. Every 5.1 title plays with a broken downmix,
from the first second, permanently.** Everything from "Reported 2026-09-09"
down to the next heading was written to explain a fade that never happened.
It is kept rather than deleted because the audio-focus reasoning in it is
sound and the shell change it produced is correct citizenship on its own
merits — but none of it explains this fault, and the D-pad discriminator it
proposes now has no symptom to discriminate. Do not run it.

**What the measurement actually says.** `dumpsys media.audio_flinger` shows
our app's track carrying `Chn mask 8000003F` on a stereo output. That is
`AUDIO_CHANNEL_INDEX_MASK_6`: the `2 << 30` prefix marks an *index*
representation, which numbers six channels without saying where any of them
sits. AudioFlinger's downmixer folds *positional* masks; an index mask has no
positions to fold, so the centre channel — the dialogue — is not mixed into
the stereo pair.

**The server is innocent, and this was checked rather than assumed.** The
init segment's AAC `AudioSpecificConfig` is `11b056e500` —
`channelConfiguration=6`, which *is* positional 5.1. The server states the
layout correctly and the client loses it afterwards.

**Why the transcode happens at all.** The set carries
`OMX.realtek.audio.dolby.eac3.decoder`, but Chromium ships no AC-3/E-AC-3
decoder, so an E-AC-3 source can never take the direct path in a WebView
however capable the hardware is. It is forced to AAC 5.1, and Chromium's
decode path then presents the result to AudioFlinger index-masked. This also
explains why Direct Play is unaffected: nothing re-presents the channels.

- [ ] **Decision, Tom's, not taken.** Server-side stereo transcode was
      proposed and rejected. What remains: a native player host on Android
      (~2–4 days; `Platform` is 5 members, `Player` ~12, and presentation
      coupling is a single `player-host` div plus `runtime.attach(host)` —
      the risk is compositing a transparent WebView over a SurfaceView), or a
      channel-count preference negotiated like every other transform, which
      touches all three repos. No client work should start on either without
      that decision.

---

Reported 2026-09-09: the Android TV app plays, and then the **sound** stops
roughly two minutes in, on all titles, with video continuing. Not yet observed
here — the set is at 10.34.1.115 and adb on :5555 is unreachable from the LAN
— so what follows is from the shell's source, not from a capture.

**The Android shell requests audio focus nowhere.** `grep` for
`requestAudioFocus`, `AudioManager`, `keepScreenOn`, `FLAG_KEEP_SCREEN_ON` and
`WAKE_LOCK` across `platforms/android` returns nothing outside build output.
`MainActivity` is a bare `Activity` holding a `WebView`. On Android TV an app
that never holds focus is at the mercy of anything that asks for it — the
Leanback launcher's background previews, a system sound, a screensaver warming
up — and when focus is taken the platform silences this app and nothing here
ever asks for it back. Video keeps decoding because video is not focus-managed.
That is the reported symptom exactly: sound gone, permanent, picture fine.

**"All titles" is the load-bearing detail.** Different titles carry different
audio codecs, so a decoder fault would not strike all of them at the same
two-minute mark. A wall-clock system event would. Equally it rules out the
client: nothing on the native path has a two-minute characteristic, and the
same code plays whole films on the Samsung.

**Kept because the work was right regardless of the cause, 2026-09-09, on
Tom's steer.** `MainActivity` now adds `FLAG_KEEP_SCREEN_ON` and holds
`AUDIOFOCUS_GAIN` for as long as it is in front, yielding on loss by pausing
the page's media rather than playing over whoever took it. Focus is
per-activity, not per-generation, because there is no bridge to hold it
per-generation with — `BridgeContract.kt` is a design stub and nothing in the
page can call in. Deployed and running on the set since 2026-09-09.

**Correction, from the RN session: focus on Android is cooperative.** The
system does not hard-mute an app that ignores `AUDIOFOCUS_LOSS`; it expects
that app to stop, and the only automatic enforcement is ducking. So "the shell
requests focus nowhere" does not explain permanent silence, and the mechanism
my hypothesis rested on does not hold.

**What does produce quiet-but-playing, found in expo-video's
`AudioFocusManager.kt`:** on `AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK` it runs
`player.volume /= 2f`, and restores `userVolume` only on an explicit
`AUDIOFOCUS_GAIN` callback. A *relative* operation where an absolute one was
meant: ducks compound (two is a quarter, seven is about one percent) and a
`GAIN` that never arrives never restores. Picture running, sound gone, nothing
paused, no recovery, with nothing actually broken. That is the shape to look
for in Chromium's WebView media session, which handles focus internally.

**The two-requesters risk I raised was unfounded, and the reason matters more
than the risk did.** Android WebView **does not request audio focus at all**
for HTML5 media — Chromium issue 429192, filed 2014, still described as
current in 2024–2025 write-ups of WebView-wrapped media apps. So there is no
second requester to displace, and requesting focus in the embedding activity
is the standard pattern rather than a conflict. The change stands as written.

**But the same fact makes focus an unlikely cause of the silence.** WebView
ignores focus in *both* directions: it does not request it, so it is not
listening for its loss either, and an app that holds no focus is not what the
system's automatic ducking acts on. Nothing outside can silence it by taking
focus. The two-minute silence therefore needs a different explanation, and the
shell change is correct citizenship rather than a fix.

Note it does add a pause path that did not exist: the activity now holds focus
and pauses the page's media on loss, which is the only way this app can yield
the audio device at all. It has since run on the set without anyone reporting a
spurious pause, but nobody has deliberately provoked a focus loss to test it.


## P1 — One open question on the 7 s stall budget

Raised 2026-09-09 by `@machafoundation/core`'s owner after 0.12.2 shortened the budget
from 15 s. **Question 2 is answered — core 0.7.0 took the watchdogs (see
below). Question 1 is still open, still not a defect, and still Tom's.**

The budget is now **7 s**, not the 5 s this section was written against: Tom
set 5 s, observed it was too short in practice, and settled on 7 s. Core's
guard test pins the *relationship* rather than the number — `> 6_000` because
it must outlast the server's hold, `<= 10_000` because it is still what a
viewer stares at a frozen frame for — so the reasoning below survives the
change of value.

**1. The budget sits under the server's own hold.** `streaming.segment_timeout`
is **6000 ms** (`config.hpp:433`): a node asked for a fragment it has not
produced holds the request for up to six seconds before answering `500
segment_not_ready`. The stall watchdog restarts on *either* position or buffer
advance, so an ordinary hold is invisible while anything is buffered ahead —
the picture keeps moving. The exposure is the frontier case only: the playhead
has caught up, nothing is buffered ahead, and the node is legitimately still
producing. Then nothing advances for the length of the hold and a 5 s budget
expires inside it.

That is the below-realtime transcode again, and the argument is genuinely
two-sided: a node at its frontier *is* making the viewer wait, which is why
the budget was shortened; but the replacement starts its own generation from
nothing, so moving off a node that was seconds from delivering can cost more
than staying. Now that failover actually works (0.6.3), this is no longer
theoretical — it will move. Worth measuring before changing: what it costs to
be moved off a producing node, against what it costs to wait.

**Constraint on both, from Tom 2026-09-09: none of this may change the
seamless Web failover.** The bar is measured and named — the silent Direct
Play swap promoted in **17 ms**, uninterrupted, with zero measured stall
(`alternate-promoted-silently`). That path is byte-level: the read-ahead
worker swaps the source underneath an element that never reloads. A
coordinator-level detector feeding `degrade()` is a *second* degradation
source on the one platform that already has one, and `degrade()` promotes a
stored alternate on second evidence — which activates a session and reloads
the element. Turning a 17 ms invisible swap into a visible reload would be a
regression that no test currently catches. Measure before and after, on the
same cluster and title.

**2. Stall detection may belong in `@machafoundation/core`, not here. — Done, core
0.7.0.** `MediaStartWatchdog`/`MediaStallWatchdog` now live in core with the
environment injected as the first constructor argument and
`note(positionMs, bufferedEndMs?)` taking buffering as *optional*, because
`expo-video` publishes a position and nothing trustworthy about buffered
ranges and a fabricated zero would read as evidence about the node. This
client keeps only `src/platform/mediaWatchdogEnvironment.ts`, which is the
whole of the DOM in that mechanism. Each host wires the watchdogs itself;
they are deliberately not wired into `PlaybackCoordinator`. The original
argument, kept because it is the reason the move was right:

`prepareAlternate`
is reachable only from `degrade()`, and `degrade()` only from the player's
optional `subscribeDegradation`. Samsung has no such channel — native HLS, and
`neverDirect` — so no standby is ever prepared there, silently, with nothing
reporting the absence. RN is the same: `expo-video` reports `PlayerError
{ message }` with no status or code.

Core's argument, and it is a good one: `player.subscribe` is **required** and
every event already carries `positionMs`, `paused`, `buffering` and `ended`, so
the coordinator can derive "the picture has stopped" unaided on every platform.
The signal it cannot get for itself — an error code, an HTTP status — is the
one it demands from the adapter; the one it can derive, it does not. The result
is that the platforms with the least introspection get the least recovery.
Moving `MediaStartWatchdog`/`MediaStallWatchdog` into the coordinator would
give every platform a standby, with `degrade()`'s existing guards unchanged.
The bound would have to be stated against `segment_timeout_ms` rather than
picked separately — see the question above.

## P1 — `levelLoadError` evicts a healthy node, with no server error behind it

Observed twice on 2026-09-08, unprompted, on **wired gbni-1** during a Clerks
transcode. Full sequence the first time:

```
10020  source-degraded          Web HLS network degradation (levelLoadError)
13057  hls-error-fatal          bounded network recovery starts
16102  source-terminal-failure  failed after bounded recovery (levelLoadError)
16107  source-failover-start    → promoted to es-1 (the WAN node)
```

The client's own behaviour is correct given the evidence it had. What is not
explained is the evidence.

- **The server returned no errors.** The Macha server session grepped gbni-1's
  journal for the whole day: zero `not_ready` (404), zero `stream_failed`
  (503); every `media.m3u8` request was answered, and it can see this session's
  playlist growing normally to 53 segments. Independently confirmed here by
  hooking XHR/fetch in the page: **every playlist poll captured returned 200.**
- **A timeout was proposed and disproved — do not re-raise it.** The first
  degradation fired at 10,020 ms against hls.js's default `levelLoadingTimeOut`
  of 10,000 ms, which looked conclusive. It is not: hls.js reports a expired
  deadline as `levelLoadTimeOut` and a genuine load failure as
  `levelLoadError`, two distinct `ErrorDetails` values (confirmed in the
  installed `hls.js/dist/hls.d.ts`, lines 1117–1118). Our log says
  **`levelLoadError`**, so the deadline did not expire. The 10 s coincidence is
  unexplained and may just be hls.js's internal retry schedule.
- So: an error that produced no HTTP status on either side. Most likely a
  transport-level failure that never became a response — a reset or a dropped
  connection — which neither the server's journal nor a captured `load` event
  would record.
- [ ] Capture the failing poll at the moment it fires. The XHR+fetch hook
  records `error`/`timeout`/`abort` as well as `load`, so an armed hook should
  catch it; it simply has not coincided with a failure yet. Log
  `data.details` and `data.response` from the hls.js error alongside it.
- [ ] Separately, weigh whether a `levelLoadError` should carry the same
  node-health weight as a segment failure at all. Since 0.32.14 the playlist is
  an EVENT list polled for the life of the session, so this evidence arrives
  hundreds of times per session where a VOD playlist produced it once. The
  server session has recorded the same trade-off on their side and neither
  wants to decide it unilaterally. `@machafoundation/core`'s owner asked for a timeline
  from any failover off a node that was demonstrably fine — the one above is
  exactly that, and should be sent.

## P1 — The endpoint registry routes media to a node it has never measured

Found 2026-09-08 while chasing "the video is very choppy". The client had
settled on **gbni-2 — the deliberately flaky wireless node — for playback**,
and its own persisted throughput table explains why:

```
macha-client-bandwidth:<client>
  http://10.44.1.50:7438   3,312,869 B/s   (gbni-1, 2 samples)
  http://10.34.1.50:7438     315,489 B/s   (es-1,   1 sample)
  http://10.44.1.51:7438   — no entry at all —   (gbni-2)
```

`EndpointBandwidth` is fed from `readJsonBody()` in `httpCompat`, so it only
ever samples catalogue/manage/acquisition **JSON** transfers of ≥32 KB. Media
never feeds it: byte-range streaming and HLS segments go nowhere near that
path. gbni-2 arrives by runtime discovery and mostly serves media, so it
accumulates no sample — and `candidates()`, which consults throughput ahead of
configured order, has nothing to deprioritise it with. The node that carries
the most bytes is the one we measure least.

Measured cost, raw byte reads of a direct-play source, three different titles:

| node | read rate |
| --- | --- |
| gbni-1 (wired) | 3.31 MB/s (client's own estimate) |
| gbni-2 (wireless) | **0.31–0.58 MB/s** across Inglourious, Aliens and Jurassic Park |

Identical across titles, so it is the node and not extent placement. And it is
enough to explain the transcode throughput results directly: Inglourious
Basterds is 21.1 GB over 153 min, so realtime needs ~2.3 MB/s of source reads.
On gbni-2 that ceiling is ~0.55 MB/s, and the title measured **0.46×
realtime** there — while the same title on the same day reached 1.00× when it
landed on gbni-1. The "sub-realtime transcode" investigation was largely
measuring our own endpoint choice.

**The deeper half: only the node we already use can ever be measured.** Three
mechanisms compose into that, and each is individually reasonable:

1. `readJsonBody()` is the *only* feed into the recorder, so just the
   catalogue/manage/acquisition JSON paths sample anything at all.
2. `ClusterEndpointRouter` sends real work to the **preferred** endpoint. So
   those samples only ever accrue for one node.
3. The health monitor does contact every known endpoint every ~10 s — but with
   `GET /api/v1/catalogue/status`, a tiny body, far under the 32 KB floor. It
   calls `fetchWithTimeout` directly and never touches `readJsonBody`, so it
   cannot sample even in principle.

So the client talks to every node in the cluster six times a minute and learns
nothing about any of them except the one it is already using. And
`compareThroughput` needs *both* sides to have evidence, so the moment
authority moves the comparison goes silent exactly when it is needed to move
it back. `THROUGHPUT_MIN_SAMPLES = 2` also leaves es-1 unmeasured on 1 sample.
There is no good reason for the client not to hold two or more samples for
every node; the machinery to get them is already running on a bounded cadence.

**Do not fabricate traffic to measure the link — estimate better instead.** A
throughput probe against every node is speculative work competing with viewer
traffic, which `docs/principles-and-laws.md` forbids outright, and it is
self-defeating on the wireless node where the probe consumes the capacity it
is measuring. Restricting it to endpoints lacking evidence does not save it: a
cold client lacks evidence for all of them.

**The signal is already arriving.** `/api/v1/status` — which the client
already fetches — carries per-node telemetry for *every* node, and nothing in
endpoint selection reads any of it. Measured 2026-09-08 while the client was
routing playback to the worst node:

| node | `runtime.load1` | `runtime.process_cpu_percent` | freshness |
| --- | --- | --- | --- |
| gbni-1 (wired) | 1.01 | **25.2%** | live |
| gbni-2 (wireless) | 1.18 | **62.0%** | live |
| es-1 (WAN) | 2.67 | **104.5%** | live |

Load alone would have kept authority on gbni-1, for free. Also present and
unread: `storage.available` and free/used bytes, `cache` pressure (all three
nodes report the 4 GiB cache entirely full — `free_bytes: 0`), `phase`, `state`,
`live_age_ms`, `telemetry_freshness`, and `diagnostics.rpc_transport
.peer_latency_ms`.

**The one thing that telemetry cannot see is the link.** CPU and load describe
a node's capacity to *serve*; they say nothing about the path between this
client and it. gbni-2 is a healthy, lightly-loaded node behind a bad wireless
hop — no server-side metric would ever reveal that, and a naive
least-loaded estimator would be blind to exactly the case that caused this
entry. Client-measured latency is the complement: it is the only signal we
hold about the *path*, and we already collect it for every node.

**Owned by the `@machafoundation/core` session as of 2026-09-08** — cluster routing is
their half of the boundary, and the change is theirs to make. Asked for:
capacity captured off the existing status fetch, ranking given more than one
axis, and an interface this client can read back (per-endpoint latency,
throughput with sample count, reported load, and **which axis actually
decided**). That last is the lesson of the day: the client could not say why
it was on gbni-2, so the answer had to be reverse-engineered from a
localStorage table and a comparator read.

Client-side work that remains here:

Real media throughput already feeds `EndpointBandwidth` (2026-09-08, see
`COMPLETED.md`) — Direct Play only, 453 of 748 titles; HLS segments are
fetched inside hls.js and remain out of reach. What remains:

- [ ] Surface it on **Status → Nodes** — per endpoint, latency, throughput
      estimate with sample count, reported load, and the deciding axis.
      Endpoint selection is currently the least legible thing in the client,
      and that screen exists precisely to make the cluster legible. Shares the
      `/api/v1/status` `diagnostics` prerequisite with the self-healing item
      below; do that modelling once.
- [ ] **Show `cpu_cores` per node on Status → Nodes** once the server sends it
      (asked of macha-a4 2026-09-08; blocked until then). Without it `load1`
      and `process_cpu_percent` are unreadable on a screen as well as
      uncomparable in code — 2.67 and 104.5% mean nothing to an operator who
      cannot see the machine size, and this cluster is deliberately non-uniform
      hardware. Show the raw figure beside the normalised one rather than
      replacing it: the raw value is what the node reported, and the
      normalisation is ours.

**Everything ranks. Operator's decision, 2026-09-08: "It's all ranking."**
One estimator, every signal an axis in it — capacity, latency, throughput.
A capacity *gate* was floated and rejected; do not re-propose it.

Two things ranking has to get right, both solvable with patterns the registry
already has:

- **Damping.** Capacity moves in response to our own routing — send work, CPU
  rises, work leaves, CPU falls — so the capacity axis needs a minimum relative
  difference before it changes any decision, the way throughput already has
  `THROUGHPUT_MIN_RELATIVE_DIFFERENCE`. The swap cooldown and the
  consecutive-cycle streak in `evaluatePreferredSwap` are the other half of
  that vocabulary and apply unchanged.
- **Normalisation.** `load1: 2.67` is saturated on two cores and comfortable on
  eight, and `process_cpu_percent: 104.5` exceeds 100 because cores are not
  divided out. Asked macha-a4 for `cpu_cores` on 2026-09-08 — a constant, cheap
  to add. Until it lands, normalise capacity by something stated rather than
  comparing raw values across a cluster that is deliberately non-uniform
  hardware.

Design notes handed over with it:

- [ ] **Build one estimator from the three free signals, and rank on it.**
      Server-reported *capacity* (`load1`, `process_cpu_percent`,
      `storage.available`, cache pressure, `phase`/`state`) says whether a node
      can serve; client-measured *latency* says whether the path to it is any
      good; opportunistically sampled *throughput* refines both where real
      bytes happened to flow. None of the three costs a byte more than the
      client already spends. Weight capacity and latency so that neither a
      busy-but-close node nor an idle-but-distant one wins on one axis alone —
      the failure here was ranking on a single axis that happened to abstain.
- [ ] **`candidates()` must actually read them.** Today its sort is readiness →
      preferred → `retryAt` → `consecutiveFailures` → throughput →
      `left.order - right.order`, so when throughput abstains it falls to the
      order the endpoints were typed into `.env`, and no telemetry or latency
      is consulted at any point. Note latency is already recorded for every
      endpoint (5-sample rolling, from the 10 s probe cycle) and is used *only*
      in `evaluatePreferredSwap`, never in candidate ordering.
- [ ] **Model `/api/v1/status` node telemetry into the registry.** This shares
      the prerequisite with the "Surface server self-healing state" item below,
      which also needs `diagnostics` read for the first time — do it once.
- [ ] **Sample the transfers already happening**, as refinement rather than
      foundation: HLS segments and byte ranges are megabytes attributed to
      whichever node served them, and artwork Blobs route *advisory* across
      alternates, so they are the natural evidence for nodes not currently
      preferred. `setTransferRecorder` is already injected, so this is call
      sites rather than new machinery.
- [ ] `return 0` for unmeasured throughput stops being load-bearing once
      ranking has other axes, which is the right outcome — no clever answer to
      "what does unmeasured mean" is needed, because it is no longer the only
      question being asked.
- [ ] Re-run the transcode throughput table pinned per node afterwards. Every
      figure sent to the server session on 2026-09-08 conflates node choice
      with encoder speed, and the corrections are already with them.

## P1 — Status calls a node's RPC socket its "Endpoint"

`StatusScreen` renders `node.host:node.port` under the label **Endpoint**
(line 510), and falls back to `node.host` as the node's display name (line 56).
That is the node's internal **RPC bind address**, not its HTTP API — core's own
comment in `discoverClusterEndpoints` says so explicitly, and refuses to build
a URL from it for exactly that reason: "using it here would guess at a port
that is frequently wrong".

On this cluster it looks plausible and is wrong: RPC is `:7437`, the API is
`:7438`. So the Status screen tells an operator the node lives one port away
from where anything can actually reach it — a number that reads as an address
and is not one.

- [ ] Relabel, or better, show the real thing. The server is replacing
      `api_host`/`api_port` with a single `api_endpoint` URL (raised with
      macha-a4 2026-09-08, may carry a scheme and a path so a node behind a
      proxy is expressible). That is the first value this field could honestly
      display. Hold the change until the shape lands rather than relabelling
      twice — but do not leave "Endpoint" pointing at the RPC socket
      indefinitely on the strength of that.
- [ ] Not a display concern, and worth confirming before the server's cut:
      `resetNodeIdentityAssociation(nodeId, host, port, reason)` is a
      **mutation** keyed on host and port, fed from `node.host`/`node.port`.
      If `host`/`port` survive as the RPC address, nothing changes. If they are
      tidied away alongside the `api_`-prefixed pair, identity reset loses its
      arguments and fails silently. Confirmed by the `@machafoundation/core` session
      2026-09-08: `port` is optional through `ManageApi`, `MachaManageApi` and
      `ClusterManageApi` alike, so a payload that stopped carrying it would
      neither fail to compile nor throw here — it would send a **destructive
      identity reset with the port missing**, against whatever the server makes
      of that. Everything else in this wire change fails closed; this is the
      one path that does not, which is why it was raised with macha-a4 as an
      explicit ask rather than left as an assumption.

This client reads no `api_host`/`api_port` anywhere (verified 2026-09-08), so
the server's replacement of those two is safe here; discovery is core's alone.

## P1 — Music playlist refactors onto the RN client's store

Tom's decision, relayed 2026-09-08: the React Native client's playlist store is
being abstracted into `@machafoundation/core` and this client refactors onto it. Theirs is
a collection of **named** playlists (create/rename/delete, versioned and
validated at file and playlist level, `getSnapshot`/`subscribe` for
`useSyncExternalStore`); core's current `MusicPlaylistStore` is a single unnamed
array. Both use the same `MusicPlaylistEntry` shape, which is what let two
sessions compare entries, agree, and miss that the *stores* differ entirely —
had the port gone ahead, a viewer with five named playlists would have got one
and lost the rest on first write.

**Settled with the RN session, 2026-09-08.** Core's single-list
`MusicPlaylistStore` is **deleted**, not renamed — a collection subsumes it,
and a degenerate one-list store sitting beside a collection store is the kind
of thing that survives for years because nobody wants to decide. `replace` does
**not** come into the collection API: its existence is an artefact of there
being exactly one list, and "discard every playlist and substitute this album"
has no legitimate caller. `create(name, items)` covers the honest version.

- **No migration needed here: there is no live data.** `localStorage` in the
  running client has never written `macha.musicPlaylist.v1.*`, consistent with
  the music library being empty on this cluster. Treat the web client as
  greenfield. The port will adopt any single unnamed list it finds under a
  default name anyway, so a TV install holding one is covered.
- [ ] **`playAlbumAll` must stop calling `playlistStore.replace(tracks)` and
  set the queue instead.** Pressing "play all" on an album currently *discards
  the whole playlist* and substitutes that album — defensible when there is one
  unnamed scratch list, data loss with a friendly label once playlists are
  named. It is queue behaviour writing to the wrong store: `PlaybackQueueStore`
  is already the queue, and `playNext`/`playLater` correctly use it.
- [ ] **Build the UI for named playlists, in this client's existing idiom.**
  Named playlists are useless without a way to make and pick one, and the
  refactor is the moment to add it rather than shipping a store with no surface.
  Use what is already here rather than inventing: `Modal`/`ConfirmModal` for
  create, rename and the destructive delete — `docs/architecture.md` forbids
  browser `alert`/`confirm`/`prompt` outright, and every destructive action in
  Manage and Status already goes through the shared focus-managed modal;
  `AsyncIconButton` for anything with a request behind it, so the control
  disables and swaps to a spinner for the whole lifetime; and the `MusicNav`
  secondary row is the established place for switching within the Music
  section, styled and focused like the primary nav. Every control needs
  `data-tv-focusable="true"` — this screen is reachable on both televisions,
  where there is no pointer to fall back on.
- [ ] Move `useMusicController` from `useState` reassigned by every mutation to
  a real subscription. Today exactly one component owns the list, so nothing
  else can observe it and two consumers would silently diverge. Note the RN
  session's scar when doing it: subscribing to a revision counter and then
  calling `list()` freezes, because the memo is keyed on a store whose identity
  never changes — the snapshot must *be* the value the caller renders.
  **Note this may be decided above us:** core currently has two subscription
  idioms — the coordinator and runtime return stable snapshots, the four state
  stores do not — and the `@machafoundation/core` session has put the question of fixing
  all four to Tom, citing this controller as the live evidence. Wait for that
  answer rather than fixing the playlist store alone.

## P1 — Seek acceleration is Samsung-only and should work everywhere

`PlayerScreen`'s scrubber `onKeyDown` returns immediately unless
`samsungControls`, so `accelerateSeek`/`seekAcceleration.ts` — the
hold-to-travel-further behaviour — never runs on web or Android. Web gets
`webSeekDeltaForKey`, a flat ±10 s per press.

Confirmed live 2026-09-08 rather than read: moving ~200 s through a film on
web took **20 discrete ArrowRight presses**, each a separate 10 s step. On a
long title that is unusable, and it is the same remote-shaped interaction on
Android, which has a D-pad and no acceleration either.

- [ ] Make the accelerating hold the shared behaviour for every platform with
  key-driven seeking, not a Samsung special case. The existing pieces are
  already platform-independent — `accelerateSeek` is a pure function with its
  own tests, and the commit-on-release/one-request-per-hold property is the
  part worth preserving everywhere.
- [ ] Keep pointer dragging on web working exactly as it does now; this is
  about the keyboard/D-pad path only.

## P1 — Session create can be refused outright (429), by design

Observed live 2026-09-07 while measuring transcode latency: `POST
/api/v1/playback/sessions` answered `429` on gbni-2 while an earlier session
of the same client was still open, and `201` immediately after that session
was `DELETE`d. Confirmed with the server session as **admission control by
design — handle it as a hard limit, not a queue.**

- [ ] Do not retry a `429` from session create on a timer, and do not fail
  over to another node for it (a second node would refuse it too, and the
  candidate loop would burn every endpoint before surfacing anything). Treat
  it as "too many streams open", say so, and make sure the client is not the
  one leaking: a session that outlives its player is what turns this into a
  user-visible dead end.

**Auth sessions have their own cap and it is not the same one.**
`session.max_sessions` defaults to 4096 per node and minting at the cap
answers 429 `too_many_sessions`, which lands on real logins. It exists because
a re-mint loop filled it in production once. The practical rule that came out
of designing around it: never use `POST /api/v1/session` as a liveness probe —
it has a side effect, and a viewer pressing a button repeatedly during an
outage is the same loop with a person driving it.

## P1 — Android TV: what is still unverified on the set

**The set itself is no longer unverified** — see `COMPLETED.md`. Launch,
catalogue browsing, D-pad navigation and playback were all confirmed on the
TCL on 2026-09-09. This entry is now only what that session did *not*
exercise, and each item says why it matters rather than merely that it is
untried.

- [ ] **The bounded HLS recovery has never run there.** Until 2026-09-09 that
      target forced native HLS, so the managed path — and every degradation
      signal, standby and recovery that depends on it — was unreachable by
      construction. It is now the default there and has not been exercised
      once. The link is a WAN hop, so the failure it protects against is both
      likelier and slower to arrive than on the bench.
- [ ] **The management and metadata screens have never been opened on it.**
      Playback, browsing and navigation were used; Manage, Ingest and the
      metadata editor were not.
- [ ] **The hardware back button's native bridge has never fired on real
      hardware.** The mini-player-removal work (see `COMPLETED.md`) added a
      JS↔native hook: `MainActivity.onBackPressed()` calls
      `window.__machaHandleBack()` via `evaluateJavascript` before falling
      back to `WebView.goBack()`/`finish()`. It was verified by reading the
      native source and reasoning through the call sequence, and the JS half
      was live-verified on Samsung (same `onStop()` code path);
      `AndroidWebPlatform`'s dev-in-browser Escape/Backspace path works. The
      `evaluateJavascript` call itself has never been observed. Confirm on the
      device that pressing back while the full player is showing closes
      playback and returns to the previous screen — no silent
      mini-player-via-WebView-history-pop, no restart-from-zero — and that
      back navigation on every other screen is completely unaffected, since
      the hook is absent outside the player and `MainActivity` should fall
      through to its original behaviour there.

## P2 — TV spatial navigation redesign

Deliberately not urgent: a previous incremental attempt (row/group focus
replacement) made things worse. Needs proper groundwork before another
attempt, not a faster one.

- [ ] Rethink Samsung and Android D-pad focus navigation from first principles;
  the current geometry scorer remains unintuitive. Do not make another
  incremental scoring adjustment without first defining and reviewing
  expected focus paths for the primary navigation, secondary navigation,
  media grids/rails, detail actions, management forms/modals and the player.
- [ ] Build a route-by-route focus-path fixture suite from those expectations,
  including uneven card layouts, overlays, scrolling, modal containment,
  remembered/default focus, text inputs and the seek bar. Validate the
  proposed model on both Samsung and Android hardware before adopting it
  globally.

## P2 — Catalogue dates

Blocked on the server; no client action is available until the wire contract
exists.

- [ ] Add a full optional release or air date to the Macha catalogue wire model
  and persist it from metadata providers. For TMDB, populate movie
  `release_date`, series `first_air_date`, season `air_date` and episode
  `air_date`. (Server-side; tracked here only because the client is waiting
  on it.)
- [ ] Update the client wire mapping after the server contract exists. The
  client already has an optional `releaseDate` field and displays a neutral
  placeholder until the server supplies it; do not introduce a provisional
  wire field beforehand.

## P2 — Native platform players

Real, substantial feature work with no active bugs behind it — sequence
after the P0/P1 items above, not before.

- [ ] Implement an Android Media3 platform host against the existing player
  boundary while preserving `PlaybackRuntime` ownership and state-machine
  semantics.
- [ ] Implement a Samsung Tizen AVPlay platform host against the same boundary.
  Until then, retain the shared HTML5/Web player and conservative Tizen 3
  capability profile used by the current Samsung package.
