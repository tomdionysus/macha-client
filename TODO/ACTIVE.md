# Active tasks and concepts to explore

Last updated: 2026-09-23, rationalised after the reap run closed the pause P0. Read
[2026-09-23-evening-handover.md](2026-09-23-evening-handover.md) first, for
what is running, what is in flight with core, today's rulings and the method
that cost time; where this file and a dated
document in this directory disagree, this file is current and the dated
document is the record of its day.

This is the working backlog. Add new work here. When an item is implemented and
its stated verification is complete, remove it from this file and add a dated
entry with evidence to `COMPLETED.md`. The dated documents in this directory
remain the detailed plans and verification records; this file is the index.

Scope: this repo is macha-client only — the UI/playback client. Server-side
backlogs (`macha`'s own `TODO/ACTIVE.md`) and core's are different repos'
concerns and are not duplicated here, even when a client bug and a server bug
are related. Core is addressed as the `Macha NPM Core` session.

## Start here

**Where the repo is, 2026-09-23.** `main` is **0.18.0** (`ce74408`, tagged,
pushed), resolving `@machafoundation/core` `^0.18.0` from the registry.
`develop` is **22 commits ahead of `origin/develop`**, unpushed, linked to
core's tree (`file:../macha-ts`, core at `23583aa`). Suite **492 tests**,
typecheck clean (it had gone red on 2026-09-23 without the suite noticing; fixed in `2dea242`). Everything since 0.18.0 is on `develop` only, and most of it
needs **core past its published 0.18.0**: `moveTo` with a lead, the move
fixes, the produced-source wait. A release needs core published first, and
both are Tom's.

**What the nodes serve:** the 0.18.0 bundle `index-CKNh5Q9D.js`, deployed
2026-09-21, confirmed working in a foregrounded tab on 2026-09-23 (deploy
section). **The cluster:** three nodes on server **0.53**, `session_idle`
30 min, `transcode_entitlement_idle` 5 min, per-account cap 32. **This
machine sits at the fi-1 site**: fi-1 is its LAN, gbni-1 and es-1 are across
the WAN from here, whatever their own wiring. Read every cross-node number
by destination.

**What 2026-09-23 did** (records in `COMPLETED.md`, three dated entries at
the top):

- Closed the **pause P0**: a 34.7 min pause recovered in place on the same
  node, no failure screen, no stall.
- Finished the **node-move P1**: identity hook deleted, `moveTo` wired, moves
  led by this viewer's measured start cost (seamless where the unled move
  froze 15 s), fragment bytes feeding core's throughput record, failure
  screen on `playbackFailureDetail`.
- Built the **start recorder** for the `readyState` 0 P0.
- Redesigned the **Import page** (compact sortable list, a page per torrent).
- Removed the **zero-byte probe** from native HLS; core waits on the
  session's own production instead.
- Put the version under the README's title, checked by a test.

**Next, in order:**

1. **The handover P0 for unled switches** — a mode switch or a first move
   still races a join it loses on a slow link and freezes ~15 s. Needs a
   lead for a node never measured; core has asked the server what it can
   state.
2. **The seek P0** — the relocate path is verified live (2026-09-23) and the
   freeze recorder is wired and seen live; what is left is the reading from a
   real freeze, which the recorder now takes unaided.
3. **The `readyState` 0 P0** — the recorder is in place; what is left is the
   consequence (a generation that never produced a byte condemning its node)
   and reading the next occurrence.

**What needs Tom, and nothing else does:** a television (the Samsung items,
including the native-HLS produced-source wait, unit-tested only); a look at
the Import page under an account with `importer`; any push, merge to `main`,
deploy or core publish; demoting or re-ranking a P0.

**Two business P0s outrank the rest:** slow artwork (new, 2026-09-24), and
scope-ratio titles playing small in a black window. The bars are burnt into the source and
the fix is an ingest/server one. [Evidence](2026-09-16-video-fit-mode.md).

**The P0s, as they stand.** The scope title (the server's). A player at
`readyState` 0 (instrumented, no mechanism yet). Seek misbehaviour. A
handover with no lead. Failover from an https page onto an http node
(core's). Each demotion below carries its reason; demoting is not
dismissing.

## How the test cluster behaves, and how to read it

**The cluster is deliberately not uniform.** `gbni-1` (`10.44.1.50`) is wired,
`gbni-2` (`10.44.1.51`) is on **wireless** (a knowingly flaky link), and `es-1`
(`10.34.1.50`) is a remote site across the internet. This is the point — the
client is developed in the conditions it must survive. So never read a
cross-node measurement as if the nodes were equivalent, and never call a slow
or stalled result on `gbni-2`/`es-1` a client bug until the same test has run
against wired `gbni-1`.

The public names are `macnessa`, `inverbeg` and `ramaroja` (`.macha.network`),
which is what the client is configured with and what measurements will name.
They are fast, slow and middling respectively in most artwork measurements
taken on 2026-09-13 — macnessa answered a 95 KB poster in 46 ms where inverbeg
took 7.9 s — but that ordering is a measurement, not a property; re-measure
rather than assuming it.

**Equally, do not reach for the topology to explain every odd number.** On
2026-09-07 the server's `peer_latency_ms` looked badly asymmetric
(gbni-1→gbni-2 114 ms against gbni-2→gbni-1 4 ms) and the tidy explanation —
every path *toward* the wireless node slow, wifi power-save buffering inbound
frames — was wrong. The metric was sampling every control call, counting
payload and handler time as network distance. Sampling heartbeat pings only,
the same pair measured 2 ms and 5 ms and es-1→gbni-2 went from 207 ms to
62 ms. **Check how a metric is sampled before explaining its shape with the
wiring.**

A second instance of the same lesson, 2026-09-13: core reported from the
server's source that an artwork capability's `exp` was `unix_ms() + ttl` with
millisecond granularity and explicitly unbucketed. Measured against the
deployed cluster it was pinned to a UTC day boundary and identical across 418
refs and across 2.6 hours. Neither was lying; the deployed build was two
releases ahead of the source being read. **Measure against the deployed
cluster, not against the server's source.**

**Facts worth not rediscovering**, collected 2026-09-21:

- **Nodes and zones.** `corvus-fi-1` = `10.35.1.50`, EEST, advertises
  nothing ("behind CGNAT", `inbound_capable: false`). `corvus-es-1` =
  `10.34.1.50`, CEST, advertises `ramaroja.macha.network`. `corvus-gbni-1` =
  `10.44.1.50`, BST, advertises `macnessa.macha.network`. This machine runs
  EEST, which matches fi-1 and is an hour ahead of es-1 — that mismatch put
  every timestamp in one report an hour out. Quote UTC in anything written
  beside a journal.
- **Caps**, read off each node's deployed `/etc/macha/macha.yaml` and now
  also stated per node on `/api/v1/status` under `playback`:
  `streaming.max_sessions` 64, `max_sessions_per_account` 32,
  `max_video_transcodes` **1**, `max_audio_transcodes` 4. The
  8-against-32 contradiction lives in the compiled defaults
  (`config.hpp:502` / `:540`) and bites only a node that sets neither; every
  node here sets both.
- **Three different 429s**, matched on the code and not the status:
  `account_session_limit` (this account on *this node*), `resource_limit`
  (the node-wide session limit and both transcode limits), and
  `too_many_sessions` / `try_later` on `/api/v1/session` (the auth store and
  password rate limiting, a different subsystem). The P1 on 429s below says
  what core does with each.
- **The orphan theory is dead.** An abandoned session for the same media on
  the same node does not cause `playback_pipeline_start_failed`: es-1 built
  the second session while the first was still present and served it.
- **This client cannot decode AC-3 in fMP4 at all.**
  `MediaSource.isTypeSupported('audio/mp4; codecs="ac-3"')` is `false` here,
  and `"ec-3"` likewise; a copy of that audio can never play, which is why a
  mode press now asks for a transcode of it. Why an AC-3 *copy* stalls on the
  node is the server's open question and is not recorded here.
- **A node reclaims a session that never streamed at 120 s**
  (`session reclaimed without ever being streamed idle_ms=120000`), which is
  the consequence chain under the `readyState` 0 P0.

## Testing against the cluster

There is a permanent test account, `webclient`, with `media_viewer` and
`view_status` only — deliberately not `manage_users`, both because a standing
account that can rewrite accounts is a hazard and because an account holding
everything cannot detect a role-gating fault. Credentials are in `.env.local`
(gitignored). Ask Tom to add a role when a task needs one rather than making
that account omnipotent.

`POST /api/v1/session` takes a **nested** envelope,
`{"credentials":{"username":...,"password":...}}`. A flat body does not fail —
it returns 201 with an *anonymous* session holding `roles: []`, which then 403s
on the catalogue and looks like a broken account. Revoke any probe session you
do not keep: the cap is 4096 per node and a re-mint loop has filled it before.

To drive the browser client without typing a password into the login form, mint
with `curl` and inject `{token, expiresAtMs, username, roles}` into
`localStorage` under `macha.session.v1`. Note that a fabricated
`expires_unix_ms` is only a client-side hint — the server's own lifetime
governs whether the token is accepted.

## Deploying the client to a node

The server serves the built client itself: `web.root` in `/etc/macha/macha.yaml`,
which on all three nodes is **`/etc/macha/web`** (not `/var/lib/macha/web`, which
the server docs use as their example and which does not exist there). `npm run
build` then rsync `dist/` into it. Files are owned `1000:50`; the index is served
`no-cache` so a deploy is visible on the next load without a restart.

```
ssh root@10.35.1.50   # corvus-fi-1
ssh root@10.34.1.50   # corvus-es-1
ssh root@10.44.1.50   # corvus-gbni-1, public name macnessa.macha.network
tar -czf /etc/macha/web.bak-$(date +%Y%m%d-%H%M%S).tar.gz -C /etc/macha web
rsync -a --omit-dir-times --chown=1000:50 dist/ root@<node>:/etc/macha/web/
```

**Deploy additively — no `--delete`.** The hashed assets of the previous build
stay, so a session still running it does not 404 on a lazily-loaded chunk. The
`hls` chunk is the one that matters: it is fetched on first playback, not at
boot, so pruning it under a watching viewer breaks playback rather than the
page. Prune deliberately, later, not as part of the deploy.

Assets are gzipped by the server on demand (593 KB of JS goes out as 172 KB).
There are no precompressed `.gz` siblings in `dist/`, which the server would
prefer; generating them is a build change nobody has asked for yet.

**0.18.0 is deployed to all three nodes, 2026-09-21 22:53 UTC, on Tom's
instruction.** Bundle `index-CKNh5Q9D.js`, 633,692 bytes, `shasum`
`eff197072a8e`, `dist` hash `091ae1eaef6d` — built from `main` at `ce74408`
(tag `0.18.0`) against `@machafoundation/core` **0.18.0 from the registry**,
which is what makes it the first deployed artefact not built against a linked
tree. Backups first on all three at
`/etc/macha/web.bak-20260921-225245.tar.gz`; rsync additive, no `--delete`,
24 files and 1,800,061 bytes to each node, written `1000:50` (verified
numerically with `stat`, not by name — the nodes happen to *name* uid 1000
`tom` and gid 50 `staff`, which reads like a mistake and is not one).

**Verified served rather than copied:** each node answers
`index-CKNh5Q9D.js` on `http://127.0.0.1:7438/` with the bundle `200` at the
full 633,692 bytes, and the CSS and Service Worker `200`; `ramaroja` and
`macnessa` both serve it too, gzipped to 183,296 bytes. The previous bundle's
assets are all still in place, and **both bundles reference the same lazy
`hls-Bt6kO1A0.js` chunk**, so a viewer still running the old page is not
broken by the swap — which is the thing the additive rule exists to protect,
and it is worth checking rather than assuming on each deploy.

**Booted once, and the browser check then hit its own confound.** The console
shows `boot-start`, `platform-detected` and `react-mounted` at 29 ms with the
read-ahead worker registered at 96 ms and no exception, so the artefact runs.
After that the tab logged nothing for **101 seconds**, then `route-exhausted`
and `same-origin-absent`, and the renderer stopped answering CDP entirely.
That is a frozen background tab rather than a finding: measured independently
with `curl`, all five hosts answer `/api/v1/health` with
`{"service":"macha","status":"ok","version":"0.48.2"}` as `application/json`,
which is exactly what `confirmMachaEndpoint` requires, and that probe aborts
at 1.5 s against a tab whose timers had stopped.

**Foregrounded check done 2026-09-23 14:30-14:33 UTC, and it closes the
deploy.** `macnessa` in a Chrome tab with `document.visibilityState` read as
`visible` and `hasFocus()` true (the first read after navigation said
`hidden`; the window had to be activated with AppleScript before any of it
counted). The already-signed-in client mounted at 21 ms, routed three
attempts to `route-success` inside 700 ms, and every `probe-cycle` from
14:30:56 to 14:33:28 reported `reachable 3, known 3, decidedBy sticky`,
captured by wrapping `console.debug` in the page since the extension shows
the payloads as `Object`. `useNodeIdentity` ran at mount and at 60 s
intervals, so the cycles at 14:31:55 and 14:32:55 fell between probes that
counted three on both sides: **no endpoint dropped**. The persisted discovered
list (`ramaroja`, `10.35.1.50:7438`) was unchanged too. It is the
configuration where the drop could not happen — same-origin plus two
discovered, all three nodes in the status snapshot — so it clears the deploy
rather than exonerating the hook, which is deleted regardless (P1 below).

**All three nodes now serve the develop build with the hot-linked core,
deployed 2026-09-21 14:37 on Tom's instruction ("they are NOT production").**
Bundle `index-NDVfpduh.js`, 624,128 bytes, `shasum` `be3dc9c3367a` — identical
on `fi-1`, `es-1` and `gbni-1` and to the local artefact — built from
`develop` against linked core `648474d`, **not** from `main`, so this is
ahead of released 0.17.3 (`index-CnpOpAES.js`) rather than being it. It is the
first bundle in front of a viewer that carries the 410 mapping. Backups taken
first on all three at `/etc/macha/web.bak-20260921-143750.tar.gz`; rsync was
additive, no `--delete`, so the 0.17.2 assets are still there. Verified
served, not just copied: each node answers `index-NDVfpduh.js` on
`http://127.0.0.1:7438/` with the bundle and CSS both `200`, and
`ramaroja.macha.network` and `macnessa.macha.network` both serve it too.

**Previously, all three nodes ran the same build as of 2026-09-20.** `3476e34` (0.17.2,
bundle `index-BGrNH6KR.js`) is on `fi-1`, `es-1` and `gbni-1`, deployed on Tom's
instruction with backups at `/etc/macha/web.bak-20260920-220338.tar.gz` on the
first two (`gbni-1` had no web root to back up). The earlier hashed bundles are still in place on all of them. So is
the front: `ramaroja` and `macnessa` both serve `index-BGrNH6KR.js`.

**`gbni-1` had never served the client, and turning it on cost a restart.** It
had no `web:` block at all, so `/` answered `401` — the request fell past an
unmounted static handler to the API. There is no reload path for it: the server
session read the source and `Service::web_` is built once in the `Service`
constructor (`src/service.cpp:101`) and never reassigned, while
`reload_config()` covers logging, the local node, the scanner, hydration,
ingest, torrent and streaming limits and not `web`. **A `SIGHUP` will accept the
new block, log a success line, and still not serve anything** — so do not read
that line as a deploy. The block was appended at the end of `macha.yaml` (backup
`macha.yaml.bak-20260920-201332-web`) and the service restarted: API listening,
ingest, torrent, the FUSE mount and both peer connections back inside 5 s,
metadata `writable 3/3`.

**`gbni-1` is `macnessa.macha.network`.** It was on server 0.43.0 when the
client landed on it and the cluster was three minor versions apart for about an
hour; the server session then took all three to **0.47.0**, and `fi-1`, `es-1`,
`gbni-1`, `ramaroja` and `macnessa` then reported 0.47.0 (all three are on **0.48.2** at the time of writing) and
served `index-BGrNH6KR.js` until the 2026-09-21 deploy above. The skew is closed and was never exercised — no title was
played from `gbni-1` in that window. Its `api.advertised_endpoint` of
`https://macnessa.macha.network` is correct and must be left alone: blanking it
would advertise a bare `http` LAN address to the cluster, which an https client
cannot reach.

**A server upgrade does not take the web root with it.** The install tarball
writes only `/usr`, so `/etc/macha/web` survives, and all three nodes served
this bundle again after the 0.47.0 restart — verified, not assumed. A client
deploy and a server upgrade are independent.

**The API's convention is that a missing field means the node cannot say** —
not zero, and not a default. `stream.look_ahead_ms` is `null` for direct play,
`stream.production` (0.47.0) is absent entirely for it, and the seek pair is
absent on a node that never promised the invariant. One branch on "absent"
covers old nodes, direct play and a pipeline that has not started reading yet;
a default silently invents a fact the node declined to state. Core reached the
same convention independently. `stream.production` is core's surface, not this
client's, for the reason recorded against the encoder rate in
`2026-09-20-transcode-handover-live-run.md`: two clients deriving it separately
would disagree about the same generation.

## Core is linked during development, and npm is what `main` resolves against

**Read `package.json` rather than this paragraph** — this section has been
wrong about the resolution three times, which is the failure mode the rest of
it is about. As this is written, `main` has `@machafoundation/core` as
`^0.18.0` and installs a real directory from the registry; `develop` has
`file:../macha-ts` and a symlink to core's working tree, which is at
`a3b40ca` (core's own `0.18.0` commit) and therefore the same code the
registry holds, for now. The registry's `latest` is **0.18.0**.

**The two branches differ in `package.json` and `package-lock.json` by
design**, so a merge between them touches those files every time. Going to
`main`: switch to the published version, drop the lockfile's `"link": true`
entry *and* the `../macha-ts` entry, `npm install`, run the gate. Coming back
to `develop`: switch to `file:../macha-ts` and `npm install`, which restores
both lockfile entries on its own.

**Tom's ruling, 2026-09-20 and again 2026-09-21.** A direct link to core's
tree during development is **fine** — *"we're nowhere near ready to publish
npm"* and *"they should hotlink for now so we can actually test this works"*.
The projects have to work together, and making core spend a version number on
every verify-fix-verify turn is not how that happens. An earlier version of
this section said a link was a fault to be fixed; that is withdrawn and was
never the rule, only a badly compressed version of the gate below.

**What is not negotiable is the gate before `main`.** `main` has people
looking at it and must work from a clone and an `npm install`. A link is a
development instrument and must never be what a release resolves against;
0.17.2 nearly shipped a tag nobody could install from, and the commit was
amended back before it mattered. Concretely, before any merge to `main`:

1. `package.json` back to a published `^x.y.z`, and `npm install` — not a
   lockfile edit.
2. `test -L node_modules/@machafoundation/core` must fail. It is the only
   check that cannot lie; `npm install` reuses an existing link rather than
   fetching the tarball, and a version string agrees while a stale link is
   still in place — the local tree was also 0.11.1 once, so
   `require(...).version` said 0.11.1 with the symlink still there and the
   suite passed.
3. `rm -rf node_modules/.vite`, then `npm run typecheck` and `npm test`
   green **against the registry copy**, not against the tree the link
   pointed at. The README states the version under its title (`_vx.y.z_`);
   a version bump that leaves it behind fails `src/readmeVersion.test.ts`.
4. Then merge and push — Tom's action, on his request.

**The gate was run for 0.18.0 and it caught something**, which is the
argument for step 2 rather than a formality. Deleting
`node_modules/@machafoundation/core` and running `npm install` was not enough:
`package-lock.json` carried a `"link": true` entry resolved at `../macha-ts`,
so npm recreated the symlink, and the version check agreed with it because
core's linked tree had reached 0.18.0 too. `test -L` was the only thing that
failed. Removing the two lockfile entries — `../macha-ts` and
`node_modules/@machafoundation/core` — and reinstalling produced a real
directory with a registry `resolved` URL and an integrity hash. **Check the
lockfile for `"link": true`, not only the symlink**, and the symbols in the
published tarball rather than in the tree beside it.

**Identify a linked core by SHA and `dist` hash, never by its version.** A
link resolves the *working tree*, not a commit, so the identity of what this
client compiled against is three things: core's SHA, whether its tree was
dirty, and a hash taken from inside `dist`. Core's `npm run dist:hash` is the
one command — three sessions once produced three correct hashes of one
artefact by hashing it three ways, and none was comparable to the others.
Core has taken the mirror rule: do not leave the tree dirty while anyone is
linked, and a commit that does not touch `src` leaves `dist` alone. When a
bundle matters, read the markers in the minified bytes as well (the 410
mapping, the refused-standby event, the standby windows); a version number
reports none of them.

**`vite dev` does not notice that a linked core changed.** The production
build resolves the link fresh every time, but the dev server pre-bundles
`@machafoundation/core` into `node_modules/.vite/deps` and keeps serving that
copy: the first live test of `prefer()` failed with `endpointRegistry.prefer
is not a function` against a tree where the method plainly existed, while the
built bundle was fine at the same moment. **`npm run dev -- --force`** after
core moves, or delete `node_modules/.vite`. The same trap, one layer down:
npm's local metadata cache can answer `ETARGET` for a version that is on the
registry; `--prefer-online` or `npm cache clean --force`.

**Typecheck with `npm run typecheck`, not `npx tsc --noEmit`.** The script
runs `tsconfig.app.json` and `tsconfig.node.json`; the bare command runs
`tsconfig.json`, and on 2026-09-21 the bare one passed for hours while the
real gate had an unused import and a test calling a function with the wrong
argument type. The build, not the typecheck, is the gate for a bundle.

**When core needs eyes on something unreleased and a link is not wanted**, it
can publish a prerelease under a dist-tag (`npm publish --tag next`) and this
client installs `@machafoundation/core@next` — same install path, `latest`
unmoved. That is the alternative to a link, not the rule.

**[[built is not released]] still applies, differently.** With a link, core's
last *build* is what you compile against, and `dist` can lag `src` (the
handover document records `dist` built three minutes after a commit). Without
one, core's last *publish* is, and a change on core's `develop` or a git tag
is invisible here until it reaches the registry. Either way, read the thing
you resolve, not the thing you were told.

## What hls.js does with a fragment the node refuses

Read from `node_modules/hls.js/dist/hls.js` at **1.6.18**, the pinned version,
on 2026-09-20 — for core's decision on whether `segment_not_ready` stays a
`500`, and because this file previously carried one line of it and the rest
lived in nobody's head.

- **`retryForHttpStatus()` refuses 4xx, status `0` (CORS) and `undefined`,
  and retries everything else.** `shouldRetry()` is
  `retryCount < maxNumRetry && (retryForHttpStatus(status) || isTimeout)`,
  with a `retryConfig.shouldRetry` hook that receives the computed answer as
  a fifth argument and may reverse it.
- **Default fragment retries are 6, exponential, capped at 8 s.**
  `fragLoadPolicy.default.errorRetry` is
  `{maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000}` and the delay
  is `min(2^n * 1000, 8000)` — 1, 2, 4, 8, 8, 8, about **31 s** of retrying.
  `timeoutRetry` is 4 with no delay; the policy also carries
  `maxTimeToFirstByteMs: 10000` and `maxLoadTimeMs: 120000`.
  **This client overrides none of it** — `webHlsBufferConfig()` sets buffer
  knobs only.
- **The retry count is shared across renditions.** The value passed to
  `shouldRetry` for a fragment is `hls.levels.reduce((acc, l) => acc + l.fragmentError, 0)`,
  not a per-fragment count, so unrelated fragment failures spend the same
  budget.
- **hls.js has no node exclusion, unless the manifest asks for one.**
  `PATHWAY_PENALTY_DURATION_MS = 300000` exists — the same 300 s media3 uses
  — but it lives in `ContentSteeringController`, is keyed on
  `penalizedPathways[pathwayId]`, and only fires when the error action carries
  `ErrorActionFlags.MoveAllAlternatesMatchingHost` **and the manifest declares
  content steering**. Ours do not. Without it, exhausted retries become a
  level switch, or an unresolved `SendAlternateToPenaltyBox` that sets
  `fatal` and calls `hls.stopLoad()`. Nothing remembers the host; the decision
  lands on this client, which is why `WebHlsPolicy.ts` exists.

**The contrast that matters, from the RN session's read of
`media3-exoplayer-1.9.0.aar`:** media3's `DefaultLoadErrorHandlingPolicy` never
gives up on a *status* — 404, 425 and 500 all retry — but
`isEligibleForFallback` covers `403, 404, 410, 416, 500, 503` and fallback
**excludes that location for 300 s**. So a `500` meaning "ask again" is free on
hls.js and asks media3 to blacklist the node for five minutes. The mirror
image: `425` is a 4xx, so on hls.js it is **silently fatal by default** and
every client would have to ship a `shouldRetry` hook to see a hold at all.
Both remedies are client work. The asymmetry is that a missing hls.js hook
fails visibly on the first hold, while the media3 policy override is already in
RN's tree.

**Whatever core decides, the argument in `WebHlsPolicy.ts` for `500` over
`503` is not about retry policy and has to be answered rather than stepped
around:** 503 is what every proxy emits when a service is genuinely down, so a
client taught that 503 means "hold, stay on this node" reads a dead node as
healthy and never fails over. haproxy is in front of es-1.

## What the catalogue costs a client that advertises AAC alone over HLS

**Two titles out of 1010.** Measured 2026-09-20 with
`scripts/playback-baseline.mjs`, which runs the real chooser over the real
facts endpoint for every catalogue item, against the live cluster as
`webclient` — so the buckets are what a client would genuinely ask for rather
than what a reimplementation guesses. Run twice with the same library and two
capability sets differing only in `hlsAudioCodecs`: AAC alone against AAC plus
`eac3`/`ac3`.

**Widening would not reach them.** The 16 titles that end up audio-transcoded
are DTS, which neither set claims, so the cost of the narrow list is two
titles and the obvious widening buys none of them back. The RN session had
been carrying a re-test of its `MachaPlayerModule.kt` narrowing against this
question; it is retired until the library gains eac3 rips.

The capability files used were scratchpad, not repo — reproducing it means
writing two `--caps` JSON files from the `CHROME` shape at the top of the
script and changing only `hlsAudioCodecs`.

## The playback session and stream route change

The server is making a playback session a REST resource and moving streams
under it, breaking the contract deliberately with no dual-serve window. The
plan is the server's (`macha/TODO/2026-09-21-playback-sessions-as-a-resource-plan.md`),
agreed with Tom, and core is co-ordinating the client transition.

```
GET /api/v1/playback/sessions/{id}/stream/{token}/{generation}/{name}
GET /api/v1/playback/sessions/{id}/stream/{token}/direct
GET /api/v1/playback/stream/{id}/{token}/...            REMOVED OUTRIGHT
```

**For this client the route move is a no-op, and that is asserted rather than
believed.** Nothing here composes a stream or segment path: the read-ahead
builds a *same-origin* proxy URL and carries the node's URL opaquely in
`?source=`, the worker only checks it parses as http(s), and the HLS preflight
resolves `new URL(uri, manifestUrl)` over URIs the node itself put in its
manifest. Two tests hold that property — one per side — and both were watched
going red against a deliberately rebuilt path. The fakes and fixtures were
moved to the post-change shape at the same time, so what the suite describes is
the wire a node will actually serve.

**What did need building was `410 generation_superseded`**, and it is built,
on `develop` and in the deployed bundle. A 410 on a segment never reaches core
as a status: hls.js raises it and this client's classifier sorts it first,
where `500` is a hold, `404` is not-found, and everything else fell to a
network-degradation branch reported as `stream` — which core reads as evidence
against the endpoint, so a healthy node answering correctly about a replaced
generation would have been condemned. Three sites carry it behind one
predicate, `isSourceGoneStatus`, which narrows hls.js's `unknown` and delegates
to core's `playbackFailureKindForStatus` so the next status core adds arrives
here for free. Core maps 410 onto its existing `not-found` kind rather than
adding a seventh, deliberately; this client follows that. The rest of what was
done for the transition — the cap notice, `prefer()` replacing
`PinnedEndpointRegistry`, the linked-core identity — is in `COMPLETED.md`
under 2026-09-21.

What is still open from it:

- [ ] **Use core's `playbackFailureStatus` in `signInComplaint`.**
      `LoginScreen.tsx` reads `.status` one level off `cause` to decide
      whether to say "that username and password were not recognised", so the
      moment anything wraps a `401` in something carrying no status of its own
      — which is what `endpointFailure()` does, and what cost the phone client
      a live bug in a branch that had never executed — a wrong password
      silently becomes a generic complaint. Core's accessor is a cycle-safe
      walk of any error chain for a finite numeric `status`, with nothing
      playback-specific in it despite the name. Held back because the day's
      instruction was the routes and this is the auth path; a one-line swap
      that wants a test failing on a wrapped 401 first.
- [ ] **Two endpoints in this client's registry can be one node, which is why
      "strictly advancing" cannot be enforced from here.** Five endpoints on
      2026-09-21: three node addresses configured by hand and two discovered
      cluster names. A generation created "on" `ramaroja` lands on whichever
      node haproxy fronts, so a cascade can return to a node it has already
      stranded a session on without the client being able to know it. That
      bears on a per-node cap being exhausted by a cascade, and it is the
      client half of the question the server asked.
- [ ] **Adoption is not implemented and needs nothing yet.** This client never
      holds a session id — core does, keyed `${endpoint.id}::${nodeSessionId}`
      — so there is no bare id to pair with a node. If adoption ever reaches
      this client, the listing is node-local by decision, and an adopted id
      without its endpoint is unusable: core's `sessionAlive` throws on it.
- [ ] **Segmented subtitles are the one place this client still holds a server
      fact, and it is parked on purpose.** Tom, 2026-09-21: *"Tell the other
      clients and the core to ignore subtitle issues FOR NOW."* Everywhere
      else the rule holds — core resolves playback, `stream.url` and
      `subtitle_url` are taken whole, every judgement about a status is
      core's, and the only other `new URL(` in production code resolves a
      playlist URI against the URL the node served it from. The exception is
      three things rather than one line: `WebPlatform.ts` composes
      `segment-${index}.vtt` against the manifest URL, which invents a server
      filename; `SubtitleSegmentManifest` (`WebSubtitles.ts`) is a wire type
      core has never heard of; and `isLegacyWebVtt`'s `.vtt` sniff is a wire
      fact in the same position. Not avoidable as things stand: the manifest
      carries `format`, `version`, `stream_index` and `segment_durations_ms`
      — durations only, no names and no URLs — and the server builds and
      parses the `segment-N.vtt` convention (`macha/src/playback.cpp:2031-2051`)
      without ever stating it. Two ways out, both above this repo: the server
      puts segment names or URLs in the manifest, or core takes the manifest
      type and the URL builder. Why it can wait: neither RN client has a
      segmented subtitle path at all, so there is exactly one copy. The `.vtt`
      sniff is already at two (the TV derives the mime type from the extension
      at `PlayerEngine.kt:296`); that one is cheap to reconcile and is not
      what makes this urgent.
- [ ] **From the smoke test of the deployed bundle** (2026-09-21, sixteen
      titles, three modes, big seeks; the record is in `COMPLETED.md`), two
      things worth chasing and neither a regression: a big seek on a remux
      stream sometimes fails its first generation
      (`seek-needs-generation` → `http-error-response` →
      `generation-update-failed`, *"timed out waiting for first fragmented-MP4
      segment"*, seen twice, the next seek succeeded both times and once the
      client recovered by itself through the failover path); and a mode
      switch to Transcode on a session that does not hold the node's single
      video-transcode slot answers `429 resource_limit` and is shown but the
      chosen mode is silently not applied — the second is under the 429 P1
      below.

## Priorities

P0 is a live or recently-live correctness problem in playback itself; P1 is
important, scoped and actionable now; P2 is real but either blocked on
something outside this repo or needs groundwork before it can start safely.

## Standing rules

- **Never add a client path that sets a password on the anonymous account**,
  and treat any code that `PATCH`es `/api/v1/users/me` as worth a second look.
  Server 0.38.4 closed the hole that made it possible; the rule outlives it.
  Background in `COMPLETED.md`.
- **Protected accounts are flagged, never name-checked.** Drive `root` and
  `anonymous` handling from the server's per-record `mutable` block
  (`rename`, `delete`, `set_password`, `set_roles`), not from the username.
  An absent `mutable` means "this node does not say", not "refused".
- **Roles are literal.** A capability the server did not name is one the
  session does not have; unknown is not the same as none.
- **Tom owns git.** Do not push, force-push, tag, or delete remote branches
  without him asking for that specific action. A general go-ahead is not
  approval. Reinforced 2026-09-13 after a push approved only in general terms,
  and again 2026-09-19 when a peer session amended and force-pushed a release
  commit in this working copy mid-release, leaving `main` and the tag holding
  two different trees under one version.
- **No real media titles in this repository** — not in code, tests, TODO
  documents or the changelog. Record the frame, the mode, the id and the
  measurement; never the name. Several were stripped from this file on
  2026-09-20.
- **Timestamps in records are Zulu.** Tom, 2026-09-21: *"timezones are a
  presentation problem."* The nodes run in three zones and this machine
  matches one of them; anything written beside a journal or sent to another
  session is UTC (`zuluTimestamp`), and the client presents local with the
  zone named (`presentedTime`).
- **Prefer a measurement that could have come back the other way** to a
  mechanism read off a stalled player. 2026-09-21 produced four confidently
  wrong mechanisms in one evening, two of which reached other sessions before
  they were withdrawn; `2026-09-21-session-handover.md` has the pattern. Write
  "not established" rather than saying it in passing.

## P0 — Artwork loads slowly (business P0, Tom, 2026-09-24)

Tom: "We STILL have slow artwork loading"; "a slow bitrate problem from the
server, you can see them loading like its the 90s. It's also a caching
problem I thought we'd solved 20 versions ago." Measured 2026-09-24 from the
fi-1 site, test account, dev client:

- **A node's first read of a poster is slow; repeats are not.** gbni-1, the
  same 77 KB poster six times on one connection: first 1,112 ms (first byte
  550 ms, body ~560 ms, about 1 Mbit/s), then 130-150 ms each. Warm across
  different posters, gbni-1 answered in 115-310 ms against a 90 ms RTT;
  fi-1 in 3 ms first byte, ~15 ms total. So "slow bitrate" is the node
  serving artwork it does not hold hot. Server's to explain (DHT owner read
  per request? a cold local read?).
- **The URLs change every UTC day.** `exp` is the next UTC midnight
  (1790294400000 = 2026-09-25T00:00Z) and every artwork URL carries it, so
  the browser cache (`public, max-age=86400, immutable`) misses on every
  poster after midnight UTC, and each first load of the day pays the cold
  rate above. Signatures are otherwise stable: 2,068 URLs identical across
  all three nodes and across reads. This is the half of the old caching fix
  that was never finished.
- **And each cached poster expires 24 h after it was fetched, with nothing
  to revalidate against.** Tom: "I see it randomly - I think it's local
  cache expiry." The headers agree: `max-age=86400` and no `ETag` or
  `Last-Modified`, so an expired entry cannot be answered with a 304 and is
  downloaded whole again, at the cold rate. Each poster expires on its own
  clock, which is why it looks random. Content-addressed artwork could be
  cached for a year.
- **Within a day the browser cache holds.** In-app revisit: 0-25 ms per
  poster; full reload: all 33 visible posters complete as their cards
  render. Host stays macnessa throughout (core's `ArtworkHostPreference`).
- **Oversized for the card.** Posters are 500x750 JPEG (68-102 KB) for cards
  ~150 px wide; no smaller variant exists.
- **Host choice ignored this viewer's link; fixed in core, verified.**
  Every poster came from macnessa (https, WAN from here; 636 ms median cold)
  while fi-1 (LAN, http) serves the same URL in 65 ms. Core now picks the
  artwork host once per run by health-probe round trip (switching only on a
  gain of at least 50 ms and 40%), and keeps it sticky. Seen live
  2026-09-24: the first load moved all 33 visible posters to fi-1 (all done
  644 ms after the cards rendered, against up to 3.4 s before); a reload kept
  fi-1 and every poster was ready as its card rendered. On an https page the
  http nodes are not candidates, so a deployed https client gains only where
  a nearer https node exists. The https layer on macnessa also adds ~1.5 RTT
  per request against the node's plain http.
- **The browser cannot measure it.** Artwork responses carry no
  `Timing-Allow-Origin`, so Resource Timing hides first byte and size for
  every cross-origin poster. A server header, one line.

Asked of the server session 2026-09-24 with this evidence: cold-read cost,
a stable (not daily) capability for immutable content-addressed artwork,
sized variants, `Timing-Allow-Origin`. Not yet seen: Tom's own view (which
page origin, which node, time of day).

## P0 — A scope title plays small in a black window

Evidence, the one-line test that produced it, and where the fix belongs:
[video fit mode](2026-09-16-video-fit-mode.md).

**Settled 2026-09-16.** The source carries burnt-in letterboxing top and
bottom — a ~2.3:1 picture in a 1920×1080 raster — and the bars left and right
are `object-fit: contain` correctly fitting that 16:9 frame into a wider
window. Two unrelated things stacked; neither is a client defect.

Proved by painting the media element's background magenta on a `VIDEO COPY`
session: the side bars turned magenta, the bands top and bottom stayed black.
Keep that test — it answers "is this us?" for any fit question in one line.

**The client changes nothing, and must not guess.** Nothing it can observe
separates a title with burnt-in bars from one that fills its frame: the raster
is all the session reports. Two rules that inferred it from aspect ratios were
written and reverted the same day, and both crop real picture on every title
that fills its frame. Do not write a third.

**The fix is the server's**, and it is one fact rather than a pipeline change:
`cropdetect` at ingest, stored against the media, reported on the play session
as `aperture: {x, y, width, height}` on the source video stream, absent when
unknown. Not cropped server-side — that forces a transcode on a title that
would otherwise copy, and cannot help a direct session at all.

- [ ] Server: detect and report it. Spec in the document.
- [ ] Client, once it lands: fit to the aperture rather than the coded frame —
      scale the element so the aperture fills the host, existing
      `overflow: hidden` clips it. Unchanged for any title without one.
- [ ] Note the payoff is windowed and ultrawide only: on a 16:9 screen a 2.3:1
      picture is the same size either way.

## P0 — A player sits at `readyState` 0 while the node says it served: no mechanism, nine explanations dead

**Promoted from P2 on 2026-09-21, and the P2's explanation is withdrawn.**
That entry read "explained by tab occlusion, instrumented, not reproduced
since". It reproduced on 2026-09-21, on both playback paths, in the tab under
observation, with the node's journal showing it served — and the
tab-visibility explanation was then measured and did not hold. By this file's
own definition a live, recurring playback correctness fault is a P0. The
investigation record from 2026-09-05 and 2026-09-08 is condensed here (the
full text is in this file at `dca9788`); do not re-run the ruled-out checks.

**The symptom.** After a normal session create, the element never leaves
`readyState` 0 — `networkState` 2, `buffered` empty, `error` null — for
minutes, with no error until hls.js escalates. Seen on Direct Play
(2026-09-05, gbni-1, repeatedly in one evening) and on managed HLS
(2026-09-21, es-1 and fi-1).

**Ruled out, each by a measurement rather than an argument:**

1. Not the server: with a session stuck, the server session found every
   thread idle, no queued extent work, every port-7438 connection healthy,
   and a clean journal (2026-09-05).
2. Not the connection: a plain `fetch()` with the same `Range` to the same
   URL from the same page at the same instant answered in single-digit
   milliseconds, against the proxy URL and the raw node URL alike.
3. Not the read-ahead worker: its `fetch` handler, instrumented, was never
   entered for the element's request; bypassing the worker entirely produced
   the identical hang. And not the worker refusing an open-ended range
   (2026-09-21): `bytes=0-` answers `206` in 46 ms; the probe that said
   otherwise had awaited a 1.76 GB body.
4. Not the element being off the proxy URL: it is on it, and the path
   segment is `__macha_direct_cache__` (the grep that said otherwise looked
   for the wrong string).
5. Not the redundant `video.load()` in the reused-element reset: a real
   double invocation of the load algorithm, fixed and kept, and the hang
   reproduced after it.
6. Not the node failing to produce: es-1 logged `first fragment ready` at
   247 ms and 208 ms for a session whose element never moved, and an
   instrumented AC-3 remux built in 48 ms.
7. **Not tab visibility, which stood as the answer from 2026-09-05 to
   2026-09-21.** Hidden-tab starts of transformed playback succeed in
   1.0-2.4 s at 6 s hidden, at 104 s hidden, and three times back to back;
   playback already running in a hidden, unfocused tab advances at 24 fps
   with no drops. One window had three consecutive hidden starts fail at
   25 s, 85 s and 56 s and nothing since has reproduced it. Tab visibility
   stays a *confound to record* — `document.hidden` on every sample, which
   `videoState()` does — and is not a mechanism.
8. Not element reuse: fresh and reused elements hung identically when the
   symptom was present and both played when it was not.
9. Not an orphaned session for the same media: es-1 built the second while
   the first was present and served it.

**Still untested:** per-origin connection exhaustion across a long-lived
page, which cannot be measured from JS (cross-origin Resource Timing is
opaque without `Timing-Allow-Origin`, and the worker's fetches never appear
in it) and is only informative in the DevTools Network panel *during* a hang;
`video.crossOrigin` left unset; and a genuinely unbounded wait to see whether
it ever self-clears.

**The consequence is understood, from both sides, and is a fault in its own
right.** When a start stalls, the node reclaims the unstreamed session at
120 s (`session reclaimed without ever being streamed idle_ms=120000`); when
the client finally loads it meets a session that is gone, six
`hls-error-nonfatal` escalate to fatal, and it fails over — **condemning a node
that did everything correctly.**

**What is in place:** the start watchdog bounds the wait (2026-09-08);
`source-start-starved` records whether the *browser* never dispatched or the
*node* never answered; `videoState()` reports `document.hidden` on every
diagnostic line since 0.17.2.

- [x] **Instrumentation, not a tenth theory — built 2026-09-23.** One
      `source-start-record` at `warn` per start that is slow, failed,
      abandoned or never shows a frame, armed before `src`, on the element on
      screen and on every standby: element events, per-second state,
      fragments asked and got, hls.js errors, and the requests that left the
      page (observed, because the Resource Timing buffer is full within
      seconds). Details in `COMPLETED.md`, 2026-09-23. The next occurrence
      arrives diagnosable.
- [ ] **A generation that has never produced a byte must not be able to
      charge its node.** The failure that follows the 120 s reclaim is
      reported as evidence against the endpoint today. Decide with core where
      that belongs — this adapter's classifier or core's guard in `degrade()`.
- [ ] When it next occurs under a real viewer: `document.visibilityState` on
      the sample, the Network panel open, and no automation-driven screenshot
      trusted as evidence of visibility — this project's browser tooling
      forces a render through CDP regardless of page visibility.

## P0 — Seek misbehaviour: the node now does what it is told, and this client's clock does not follow

**Read this before adding anything here.** The governing document is the
server's `TODO/2026-09-18-seek-does-what-it-is-told-plan.md` in the `macha`
repo. It was agreed with this session and the core session *before* it was
written, and it shipped in **server 0.46.0**. Three sessions have since
re-derived parts of it from symptoms and two of those derivations were wrong,
which is the reason this item exists as one place rather than five. Raw
measurements stay in `2026-09-18-playback-symptoms-observed.md`; the keyframe
index that would let a client avoid the offset altogether is the P2 further
down.

### The contract, as the node behaves now

Confirmed against the es-1 journal by the `Macha Server` session, 2026-09-18.

| field | meaning |
| --- | --- |
| `seek_ms` | where the generation's media actually begins — the first sample the client receives |
| `seek_offset_ms` | how far into that generation the requested position sits; never negative |
| `seek_requested_ms` | the position the node honoured, after clamping |

`seek_ms + seek_offset_ms == seek_requested_ms`, exactly, in integer
milliseconds.

- **Transcode** now starts exactly on the requested frame and `seek_offset_ms`
  is 0. The forward snap is gone from this path outright.
- **Remux** starts on the **last indexed keyframe at or before** the request and
  carries the remainder as the offset. The snap did not stop here, it reversed
  direction: a stream copy has no decoder and an fMP4 fragment must begin on a
  sync sample, so this is the only split the container permits.
- **Direct** has no generation; offset 0.

So **the first frame the client receives is at `seek_ms`, not at the position
asked for.** The playlist timeline starts there and the generation's media clock
origin is exactly `seek_ms`. The pre-roll between that keyframe and the request
is fetched and must never be presented, because **the client is required to
attach `seek_offset_ms` into the generation**. That is this repo's half of the
contract, and it is the half that does not work.

One live plan from the node's journal, same episode, remux:

```
seek_ms=1282531  seek_offset_ms=8348  seek_requested_ms=1290879
entries=237  longest_gap_s=10.428  median_gap_s=10.427
```

On this title an off-keyframe remux seek therefore carries **seconds** of
offset, up to about 10.4 — and so does every Continue Watching resume into a
remux generation, because a resume position is no likelier to land on a keyframe
than a seek target is.

### The client fault, demonstrated

`WebMediaTimeline.establishOrigin` (`src/platform/WebMediaTimeline.ts:95`) has
two branches and chooses between them on the requested position alone:

- requested at or near zero — the origin is the first resident media timestamp;
- requested non-zero — the origin is `rawPosition - requested`, guarded only by
  the raw position being inside residency.

The second branch was written for the **handover**, where `attachHls` sets
hls.js's `startPosition` and the element's `currentTime` genuinely does land at
the requested position before anything samples it. The **teardown** path builds
the same timeline with the same non-zero argument
(`src/platform/WebPlatform.ts:681`) — but there the loader starts at zero, and
the initial-seek listener calls `publish()` *before* it seeks
(`WebPlatform.ts:690-711`), deliberately, so that the origin is established
first. The sample it learns from therefore has `currentTime` 0, which is inside
residency, so the guard passes and the branch subtracts the offset from zero.

Demonstrated against the current source with a throwaway vitest case — offset
18,120 ms, buffered `[0, 4000]`, position 0, which is the shape the teardown
path presents at `loadedmetadata`:

```
originMs: -18120   reportedLocalMs: 18120   initialSeekTargetMediaMs: 0
```

Two consequences, and both are the reported symptom:

1. **The initial seek targets media time 0**, so playback begins at `seek_ms` —
   the keyframe, up to a GOP *before* where the viewer asked — and the pre-roll
   the contract says is never presented is presented.
2. **Every position afterwards is reported `seek_offset_ms` too high**, because
   `toLocalTime` subtracts a negative origin. Core adds `session.seekMs` on top,
   so the readout sits at the requested position from the first frame while the
   picture is behind it, and stays exactly that far ahead for the life of the
   generation.

A negative origin is also nonsense on its face — a transformed generation's
media clock cannot precede its own start — and `canonicalOrigin` does not reject
one.

**Which activations reach it.** Any `play()` at a non-zero position that does
not take the handover path: after core's `9954656` that is every `relocate`, and
every `continue` whose handover cannot be set up. Core computes that position as
`absolute - session.seekMs` (`generationLocalPosition`), which is exactly
`seek_offset_ms`, and it is right to. `startInternal` activates the *first*
generation the same way — `activateSession(session, currentDesired,
'relocate')` — so **a Continue Watching resume into remux is enough on its own**;
no seek is needed to reach this.

**Why the suite is green.** The two cases in `WebMediaTimeline.test.ts` that
exercise a non-zero origin both assert `originMs: 300_000`, the absolute-clock
shape where MSE preserves the source timestamps. Nothing feeds the branch a
zero-based clock with a non-zero requested position, which is the only shape the
teardown path produces. The standing note that this branch "has still never run
against a real non-zero offset" was right about the live runs and wrong to read
that as safe.

### What this explains, and what it does not

The 18.12 s measurement fits the mechanism exactly: an element duration of
1,748.9 s against a title of 2,464.462 s puts `seek_ms` at 715,560 ms, and a
reported position 733.68 s ahead of `currentTime` is that baseline plus an
18,120 ms offset.

**Not established: why that offset was 18.12 s.** The node's index for this
title has a longest indexed gap of 10.428 s, so keyframe alignment alone cannot
reach 18.12 s. A `continue` activation uses the live intent position, which goes
on advancing while the node spends 10–13 s building, so offset plus travel would
cover the difference — but that is arithmetic, not evidence, the coordinator's
intent handling has not been read, and the server has no journal line at that
value. The mechanism is demonstrated; the value is unsourced.

### The other four symptoms, with what is now known

- **Seek freeze, still video with audio continuing (5.40 s).** Still open, and
  the only one with no mechanism. The node's first transcode fragment for this
  title took **11,672 ms** to encode — 4K HEVC decoded and re-encoded to H.264
  in software — so "the video track has no decodable data at this position yet"
  now has a production-shaped candidate beside the decoder-shaped one. Do not
  choose between them from the outside. The reading that separates them is
  per-track `SourceBuffer.buffered` with
  `getVideoPlaybackQuality().totalVideoFrames`, and it has not been taken.
- **The failure message names the wrong event.** Core's
  `recoverFromSourceFailure` ends with
  `failTerminal(terminalRecoveryError(error, failoverError))`, and
  `terminalRecoveryError` returns the *originating* error, attaching the
  failover error only as `.cause`. So the screen shows what started the
  recovery — here the stall watchdog's line for a generation already reported
  gone — and never what ended it. Core's to decide, and raised with the `Macha
  Client Core` session: either the message carries both, or hosts are told to
  render `.cause`. This repo renders whichever it settles on.
- **Node build time against the client's attempt budget. Fixed in core,
  2026-09-18.** The node's own timings for the 13,433 ms seek: fast path taken
  in ~1 ms, container seek 39 ms, first fragment ready at 11,672 ms. That is an
  encoder, not a planning step, and no change to the seek path will move it.
  When the budget lost, `releaseGenerationAdmittedLate` DELETEd the generation
  that finished 1.4 s late and failover started the same encode again on the
  other node. The cause was structural rather than a bad value: core's
  `GENERATION_ATTEMPT_BUDGET_MS` was 12,000 ms against a server entitled to
  15,000 ms, so core abandoned every node three seconds inside its own bound.
  Server 0.46.2 now reports `playback.startup_timeout_ms` and
  `segment_timeout_ms` per node on `GET /api/v1/status`; core derives the budget
  per endpoint from them and the 12,000 ms constant has been **deleted**. This
  repo supplied the measurement and owes the live verification.
- **The outgoing generation stops resolving 0.8–1.7 s after the PATCH.**
  Answered by the server session, and deliberate: the PATCH handler marks the
  old segment store superseded before building the replacement, which ends the
  *wait* for fragments the old pipeline has not yet produced. **Already produced
  fragments still serve.** `stop_pipeline` does not run until the replacement's
  first fragment is ready, and the flag is cleared if that fails, so it is not a
  teardown. The consequence is structural rather than a bug: buffered runway
  covers a seek only as far as the old generation had already encoded, which on
  a transcode generation is a few fragments.

### The split, formally agreed with core on 2026-09-18

Agreed in an exchange with the `Macha Client Core` session, and written down
here because this item exists precisely because agreements that lived only in
transcripts were re-derived wrongly by later sessions. Each side went and read
the other's source or the server's doc rather than defend a position, and both
sides were corrected at least once in the process.

**Core's, and deliberately not this repo's:**

- **The invariant check.** `seek_ms + seek_offset_ms == seek_requested_ms` is
  verified once, in core, and **this client does not re-check it**. Tom's
  ruling, 2026-09-18: a client-side check is testing whether the server's C++
  and core's JS can do arithmetic, which is not this repo's job. Core's own
  argument reached the same place — a duplicate check earns its cost only if it
  can act on what it finds, and a host that detects a violation can do nothing
  core has not already done. Core's undertaking against the real risk, which was
  silence: the check is **loud** (reported through diagnostics, never swallowed)
  and it **never triggers renegotiation**, because rejecting a generation is
  what livelocked on 2026-09-17.
- `seekOffsetMs` / `seekRequestedMs` on `PlaybackSession`, both optional, where
  **absent means the node cannot say and never zero** — on a pre-0.46.0 node the
  generation may begin *after* the request by up to the measured 9.3 s.
- The player is never given `seekOffsetMs`. Core keeps handing it a
  generation-local position via `generationLocalPosition`; the offset arithmetic
  is universal, the conversion into a browser MSE clock is this repo's.
- `activationPosition` collapses into `generationLocalPosition`. The livelock
  happened because the old server snapped *forward*, so re-asking returned the
  same unusable generation for ever (147 negotiations in 33.3 s, identical
  `serverSeekMs`). 0.46.0 snaps backward, so renegotiation converges in one
  round.
- The terminal message composition, and the stale `startInternal` comment.

**This repo's:** the timeline fix below, the retry behaviour inside the native
first-fragment wait, live verification, and rendering whatever phase state core
ends up exposing.

One correction owed to the server's plan: its line that "the client confirmed
both attach paths already do this" was wrong for the teardown path, and core had
relied on it.

### Tasks

- [x] **Separate the two origin cases instead of inferring them from the
      position.** Done 2026-09-18. `WebMediaTimeline` takes a third argument,
      `WebMediaLoaderStart` — `generation-start` for the teardown path, where
      the loader is given no start position and the first resident timestamp is
      the origin, and `requested-position` for the handover, where `attachHls`
      sets hls.js's `startPosition` so `currentTime` genuinely is the requested
      position. The position-based inference is gone entirely. The argument is
      required rather than defaulted, so a future call site cannot inherit the
      wrong case silently.
- [x] **See it fail first.** Done. The teardown-shape case reproduced
      `originMs: -18120` against the unfixed file, exactly the live figure, and
      a second case covers the handover sampled before its position is resident.
      Both red first, then green. Suite 362 across 48 files, typecheck clean.
- [x] Reject a negative origin outright. `canonicalOrigin` now returns
      `undefined` rather than a negative, so nothing is established and the next
      sample gets another go, instead of the nonsense being baked into every
      later mapping. Only the `requested-position` branch can produce one.
- [x] Verify live on a **resume**, not only on a seek. Done 2026-09-18 against
      `ramaroja.macha.network`, signed in as the test account, on a Continue
      Watching resume into a **transcode** generation carrying a non-zero
      offset. The node put the generation origin at 1,532,781 ms against a
      resume position of 1,536,111.9 ms, so the client was handed a local
      position of **3,330.9 ms** — the teardown branch, with a real non-zero
      offset.

      ```
      initial-local-seek  requestedPositionMs=3330.902
                          targetMediaMs=3330.902   mediaOriginMs=0
                          before: currentTime=0 readyState=HAVE_METADATA buffered=[]
      ```

      The unfixed file turns that exact sample into `mediaOriginMs=-3330.9` and
      `targetMediaMs=0`. Four readings, all clean:

      - origin `0`, not negative, from a sample taken at `currentTime` 0;
      - the initial seek targeted **3,330.902 ms**, not the generation's start;
      - the element's first moving sample was `currentTime` **3.330902 s**, so
        playback began at the requested position and the pre-roll between the
        generation origin and the request was never presented;
      - readout minus picture across 318 samples at `readyState` 4: mean
        **−132.6 ms**, range −754 to +447, which is the scrubber's whole-second
        quantisation centred on zero. The fault is a *constant* +3,330.9 ms.

      The arithmetic closes end to end: generation origin 1,532,781 + element
      duration 1,173,555 = **2,706,336 ms**, exactly the scrubber's maximum.

      **The `relocate` seek path, verified live 2026-09-23**, remux from fi-1,
      scrubber click: seek to 3,333,000 ms, the node started the generation on
      the keyframe at 3,330,473, the client was handed local 2,527 ms,
      `relocation-hold-begin` then `media-seeked currentTime=2.527` then
      `relocation-hold-complete`. The pre-roll was not presented, and the
      readout (55:45) equals generation start plus element time (3,330.473 +
      14.72 s), so no constant offset.

      **Noticed, not diagnosed, and not this repo's:** the generation was
      `transcode` yet carried a 3,330.9 ms offset. Under the 0.46.0 contract
      transcode starts on the requested frame with `seek_offset_ms` 0, so either
      the node behind `ramaroja` is not on 0.46.x or something else is moving
      the position. Raised rather than explained — see
      [read the other side before asserting it].

      **There is a capture that answers half of it, and it is already
      reaching this client.** The core session reported on 2026-09-20 that
      `MachaPlaybackResolver.mapSession` calls `checkSeekInvariant` on its
      first line in the 0.14.0 this repo resolves — verified in its tag and
      its `dist`, and pinned by its own test — and writes one client-
      diagnostics entry at **error** level, event `seek-invariant-violated`,
      carrying `sessionId`, `mode`, `seekMs`, `seekOffsetMs`,
      `seekRequestedMs` and `differenceMs`, whenever
      `seek_ms + seek_offset_ms !== seek_requested_ms`. It is reported and
      never acted on: nothing refuses the generation or renegotiates.

      Error level means this repo already has it in two places — the
      diagnostics buffer on `window.machaDiagnostics`, and the failure trail
      the player screen reads out, which takes warnings and errors. So on the
      next run: **look for it, and record its absence as well as its
      presence.**

      **Corrected 2026-09-20, same day, by the core session — the reading
      above was too strong and is withdrawn.** The check is **mode-agnostic**:
      it compares `seek_ms + seek_offset_ms === seek_requested_ms` and nothing
      else. A transcode generation carrying `seek_offset_ms: 3330.9` satisfies
      it whenever `seek_ms` is 3,330.9 lower than the request, so **silence
      from this check says nothing about whether transcode starts on the
      requested frame.** Those are two different statements and core only tests
      the arithmetic one; whether 0.46.0 requires a zero offset for transcode is
      a server-contract question this check cannot answer either way. What
      absence does still rule out is a node whose two fields do not add up.

      **A finding that stands on its own:** `3,330.9` is not an integer, and
      the contract states these fields in whole milliseconds — core compares
      them with `===` on integers. Whatever else is true of that generation, the
      node is not stating the field in the units the contract describes. Worth
      keeping separate from the zero-versus-non-zero question, and it is the
      same class of fault as the fractional milliseconds this client was
      found committing in the other direction (`COMPLETED.md`, under 0.17.3).

      An end-of-title clamp cannot trip the check, because the node reports the
      clamped value as `seek_requested_ms` and the sum still balances. A node
      too old to state both fields was silent, which made "held" and "could not
      check" the same silence; core's `develop` now leaves
      `seek-invariant-not-stated` for that case, carrying which field was
      missing — **at `debug`**, deliberately, since an old node in a mixed
      cluster is ordinary rather than a failure, and warnings land on the
      television through the failure trail. The consequence here is a capture
      setting, not a code change: **a capture taken at `warn` still cannot
      separate the two, and one taken at `debug` can.** Not in the 0.14.0 this
      repo resolves.
- [ ] Take the per-track buffer and `getVideoPlaybackQuality()` reading for the
      audio-without-video freeze. The server session is holding for it.
      **The recorder is built, 2026-09-23; the reading itself is still owed.**
      `WebMediaDiagnostics` now reports `media-picture-stopped` (warn) when
      `totalVideoFrames` holds for 1.5 s while `currentTime` advances, and
      `media-picture-resumed` when frames move again. Both carry each track's
      `SourceBuffer` ranges (`trackBuffered`, from hls.js's `BUFFER_CREATED`)
      and the frame counters. So the next freeze reads itself: a video track
      with nothing at the playhead is a node still producing, a video track
      holding the playhead with frames frozen is the decoder. Never judged on
      a paused, seeking or hidden page, or on a clock that stopped (that is
      the watchdog's). Decoder state is now per element: it was one shared
      record, so during a handover the two elements' counters were compared
      with each other and a freeze on the outgoing one could not be seen, and
      the audio-stopped check had the same fault. Every guard seen red.
      **Wired and seen live, 2026-09-23**, remux from es-1 in a foregrounded
      tab: holding `getVideoPlaybackQuality` constant for 4 s on the playing
      element gave `media-picture-stopped` at `frozenForMs` 1,594 (clock 1,860
      ms on, frames held at 700), then `media-picture-resumed` at 3,719 ms,
      each carrying real ranges. **The buffer is one `audiovideo`
      SourceBuffer, not two**: the node muxes audio and video into one
      rendition, so MSE holds no per-track ranges to read. The reading still
      separates the candidates, because a muxed buffer's range is where
      *both* tracks have data: a range covering the playhead through a freeze
      means the video data is there (the decoder), a gap at the playhead
      while sound plays means it is not (production). The decoded byte
      counters in the same line say which decoder stopped. No false report
      across a seek and a relocation hold. The reading itself still waits for
      a real freeze.
- [x] Adopt `PlaybackSource.budgets` — done 2026-09-20, shipped in 0.17.3,
      recorded in `COMPLETED.md`. **Unverified live:** both nodes state the
      figures the constants were derived from (`startup_timeout_ms` 15000,
      `segment_timeout_ms` 6000, re-read on 0.48.2), so the adoption is
      indistinguishable from the old behaviour at runtime. A node configured
      differently is what proves it.

## P0 — A handover with no lead cannot win its join, and the picture freezes

**Where it stands, 2026-09-23.** A join is won whenever the new generation
starts ahead of the viewer: both led node moves (6.4 s and 24.6 s leads) and
the reap rebuild at its lead time completed seamlessly, with no stall in
hundreds of 100 ms samples. What still loses is a switch with no lead: the
first move of a page to a node, and a mode switch or relocation that asks for
the viewer's own position. On a slow link that is `join-receding-faster-than-
it-fills`, a relocation hold that freezes 15-19 s, then a fresh start. It no
longer rewinds the viewer (fixed 2026-09-21). The remaining work is leading
those other callers too, which needs the lead to come from somewhere for a
node never measured (see the P1 on moves to a node this link cannot carry).

The original report, 2026-09-20:


**Measured 2026-09-20, foregrounded, on the live cluster.** Reported by Tom as
"problems starting media from a position that isn't zero — sometimes it works,
sometimes it doesn't, may be direct/remux/transcode". It is mode-dependent, and
by construction rather than by accident.

**All three modes were measured on one title, same session, same node.**

| mode | what happened |
| --- | --- |
| direct | **Correct.** Resume at 1,729,693 ms: `req=1729693 target=1729693 origin=0`, element landed at `ct=1729.693` and played. |
| remux | **Correct.** Mid-playback switch: `seekMs=1783687`, `localPositionMs=138`, `initial-local-seek req=138 target=138 origin=0`. Readout tracked the picture. |
| transcode | **Fails, after 30 s, and goes backwards.** |

The transcode switch:

```
session-updated  transcode  seekMs=1809530
source-activate  generationStartMs=1809530  desiredAbsoluteMs=1813248
                 localPositionMs=3718
handover-begin   requestedPositionMs=3718  outgoingPositionMs=29561
                 clockOffsetMs=-25843  runwayMs=128688
handover-abandoned  reason=join-never-buffered
                 targetSeconds=33.869   buffered=[{startMs:1999.999 …}]
```

Two `<video>` elements existed for **29.7 s**. The replacement never buffered
past ~2 s while the join sat at 33.9 s.

**The mechanism, and it is already written down elsewhere in this file.** The
replacement generation starts where the viewer *was* (`1809530`); the join is
where the viewer *will be*; and **the node encodes sequentially from the
generation's start**. So the replacement must encode its way to the join while
the viewer keeps advancing. A stream copy does that far faster than realtime,
which is why remux is fine. A software transcode of a large source does not, so
the join recedes about as fast as the encoder approaches it, and
`HANDOVER_BUFFER_TIMEOUT_MS` (25 s) expires. Whether it ever succeeds depends
on the title and the node, which is exactly why it reads as intermittent.

This is the same fact as *"do not walk the frontier — production is
sequential"* and *"a fresh generation seeked to the arrival point beats making
an existing one encode its way there — 1.92 s cold start against ~9 s of
catch-up"*, recorded under the pause P0 (now in `COMPLETED.md`, 2026-09-23). Nobody had connected it to the
handover path.

**The fallback is worse than the delay.** After abandoning, `play()` falls
through to teardown and attaches the generation created 30 s earlier. The
viewer was at ≈1,843 s and resumed at **1,822 s** — about 20 seconds of rewind
after half a minute of waiting.

**Not implicated, and checked rather than assumed:** the initial-seek listener
and the timeline origin. All three modes computed the right target. The fault
is *when the handover gives up* and *what it falls back to*.

- [x] **Shape chosen and built, 2026-09-20: the first candidate.** The
      replacement is watched for whether it is *gaining* on the join, and the
      handover is abandoned the moment that race is decided rather than when
      the budget expires. `handoverJoinLost()` compares the distance from the
      replacement's buffered edge to the join, at the start of an observation
      and now: not closing at all is lost outright, and closing too slowly to
      arrive inside what is left of the budget is lost too.

      **Both rates are measured, neither is assumed.** Not `source.mode`,
      which says what a node is doing and not how fast it does it — the
      measurement above is one node, one title, and the same mode is fine on a
      node that encodes faster than realtime. Not a constant for the viewer's
      rate either. Only the distance and whether it is shrinking, which is the
      quantity the answer depends on and is observable from here.

      An up-front decline — the literal reading of "falls back at once" — was
      considered and rejected: nothing at the moment of the request says how
      fast the node will produce, so it could only have been a guess dressed
      as a gate, most likely on `mode`. Six seconds of watching is the price
      of knowing, against the 25 s of not.

      Guarded on the join being *out of reach*: a replacement that holds the
      join and is only short of the margin ahead of it is one the loop can
      still promote — it does exactly that when the outgoing element stalls —
      so it is not thrown away for being slow.

      `HANDOVER_CONVERGENCE_WINDOW_MS` is 6 s because a segment arrives whole
      and a rate read from inside one is quantisation, not production. It is
      deliberately **not** derived from `budgets.segmentHoldMs`, per the rule
      recorded with the budgets adoption in `COMPLETED.md`: that figure shapes
      retries and does not bound them.
- [x] **The rewind is fixed too, and separately.** `handOverToSource` now
      returns an outcome rather than a boolean, carrying `resumeAtMs` — the
      live position expressed in the replacement's clock through the
      `clockOffsetMs` taken at the request — and `play()` attaches there
      instead of at the position core computed before the attempt began. Only
      ever forward: a position that has not moved leaves the request exactly
      as core made it, and it is withheld entirely once the element is no
      longer ours, because a superseded handover's live position belongs to
      whatever replaced it. `handover-abandoned` logs `resumeAtMs`, so a live
      run says what it fell back to.

      **Core's side was read before assuming this is allowed**, rather than
      reasoned about from here: `PlaybackCoordinator` releases its seek-intent
      latch on the player *demonstrating it is tracking* rather than on the
      player confirming the number core chose, and its own comment names the
      case — "a host that replaces a source seamlessly does exactly that: it
      cuts at the point the outgoing element actually reached, not at the point
      core nominated". Attaching forward of the request is the behaviour that
      release condition exists for. Nothing validates the position the player
      lands on against the one core computed; core learns it from the events.
- [x] **Seen failing first.** `handoverJoinLost` was written inert — returning
      "keep waiting", which is today's policy — and watched going red on both
      give-up cases while the two keep-waiting cases passed, so the test
      distinguishes the new behaviour from the old rather than agreeing with
      whatever was written. `handoverFallbackPositionMs` was then reverted to
      `return requestedMs` and watched failing on the measured figures
      (3,718 against 33,718). Suite 370 across 48 files, typecheck clean.
- [ ] **Watched behaving correctly on 2026-09-21 — and reachable by no path
      this client now takes.** Both exits fired live, which is what this item
      asked for: killing the serving node under a playing transcode produced
      `handover-abandoned reason=join-receding-faster-than-it-fills` at ~6 s
      (deficit 2,151 -> 4,256 ms over 6,049 ms; and again 921 -> 3,027 over
      6,053) instead of waiting out the 25 s budget, with
      `handoverFallbackPositionMs()` placing the viewer where they actually
      were. Reaching them needed three changes first — the failure reported
      while runway remains, the element kept playing through it, and a recovery
      relocation offered the seamless path — and all three were reverted the
      same evening as tuned to one node and one title; the argument is in
      [2026-09-21-failover-and-mode-switch-live-run.md](2026-09-21-failover-and-mode-switch-live-run.md).
      So on a node death as the client stands, the stall budget expires first
      and the relocation hold carries the picture instead. **The handover was
      abandoned every time**, because the replacement cannot fill faster than
      the join recedes on a node transcoding from scratch; that is core's
      placement and the server's production rate. What this repo owns is
      watched and correct, and unexercised again. What would reach it by a
      path the client takes on its own is a reap or a node failure under a
      playing transcode with core attempting a handover rather than a rebuild.
- [x] **The mechanism is measured rather than reasoned, 2026-09-20.** Three
      figures, all from the node itself: fi-1 states `look_ahead_ms: 32000`
      (true for generations started under its current configuration, and not
      for a session held across a reload — the producer gate is fixed at
      generation construction while the reported figure is not), so
      core's clamp computes the flat 26 s lead and never binds; fi-1 produces
      **1.49x realtime** on this title at 720p (70.1 s of media in 47.0 s of
      wall clock, first fragment 3.8 s); so a 26 s lead closes at 0.49 s per
      second and needs ~53 s against a 25 s budget. **The join is not receding
      — it is closing too slowly**, which `handoverJoinLost()` already answers
      correctly, and which is the first account of "sometimes it works" that
      survives contact with a measurement.
- [x] **And it could not have worked anyway: the node holds one live playback
      session per bearer token.** A second `POST
      /api/v1/playback/sessions` returns the same `session_id` with the
      generation incremented and the previous generation's segments answering
      **404 within a second** — measured with no keys, with distinct
      `idempotency_key` parameters as core sends them, and with distinct
      `Macha-Viewer-Session` headers, identically in all three. The server
      session confirmed it in source: the key is `request.session->id`
      (`src/playback.cpp:2236`), so a second POST supersedes whatever that
      token was playing **across all media**, and `Macha-Viewer-Session` is
      retired and unread. `docs/streaming.md` still describes both headers as
      live, which is how a client comes to build a handover that cannot work;
      the server session is fixing the documentation. **Two live generations of
      one media on one node are not obtainable**, so a same-node handover
      cannot succeed at any lead time, and failing fast and landing the viewer
      correctly is the right shape rather than a mitigation.

      **Superseded by server 0.48.0, deployed as 0.48.2 at the time of
      writing.** Core's `endpointFailure.ts` records the change: one bearer
      token may now hold several playback sessions, bounded by
      `max_sessions_per_account` (32 per node here). So two live generations
      of one media on one node are no longer unobtainable by construction,
      and a same-node handover is no longer impossible — it is still lost on
      production rate, and it has not been re-measured on 0.48.x.
- [x] **Core owns the lead, and has taken both items.** Core has recorded
      re-requesting at the arrival point and the lead accounting for encoder
      speed as core's, with this repo's provenance, and reads the first as
      subsuming the second: create a *deferred replacement* at the arrival
      point rather than at the playhead, so the join lands on the new
      generation's first fragment. The operator has approved the server
      publishing encoder production on the session payload; core owns the
      client-facing surface. **This client must not read that server field
      directly** — the rate is a property of node, title and extent placement
      together (1.49x was fi-1 pulling its source across the link from es-1),
      and two clients deriving it separately would disagree about the same
      generation.
- [ ] Re-measure on a title the node can transcode faster than realtime, to
      confirm the same path succeeds there. That is the other half of "it
      works sometimes" and it has not been demonstrated — and it is now also
      the check that the new exit does not fire on a handover that would have
      worked.
- [ ] **Still open, and not addressed here:** re-requesting a generation at the
      arrival point once the join proves unreachable (the "fresh generation
      beats catch-up" rule applied to this path), and having the lead time
      account for encoder speed, which is core's. Both remain worth doing; the
      client now fails fast and lands the viewer in the right place instead of
      neither.

**Method note, because it nearly cost the measurement.** The first attempt
showed `readyState` 0 with nothing buffered for 43 s and read exactly like a
failure to start. `document.hidden` was **true** — the tab was backgrounded,
`hasFocus()` returned true and lied, hls.js's fragment loop was throttled and
the node reclaimed the idle pipeline. Every sample in the probe now records
`document.hidden`, and no measurement of this kind should be trusted without
it.

## P0 — Any failover from an https page dies on an http node, and says "Failed to fetch"

**This is live in the deployed configuration, not derived. Checked 2026-09-20.**
Viewers reach the client at `https://ramaroja.macha.network`, and
`GET /api/v1/status` from that origin advertises a node with
`api_endpoint: http://10.35.1.50:7438`. So a page served over https discovers
an http LAN node as a failover candidate and cannot fetch it — the exact chain
below, on the address real viewers use. Tom's "random 'Failed to fetch' in a
running stream which resolves if you press play" is this, in production.

Diagnosed 2026-09-16. Evidence and timelines:
[a paused generation is declared dead](2026-09-16-pause-fails-playback.md).
**The client half of that document is fixed and in `COMPLETED.md`; this is what
is left, and it is the more important half.**

Two symptoms, one cause. Pause a title and leave it, and the player fails on its
own with `Macha endpoint http://10.35.1.50:7438 failed: Failed to fetch`. And,
reported separately by Tom the same day, *"random 'Failed to fetch' in a running
stream which resolves if you press play"*. Nobody had connected them.

**Every door into a failover ends in the same room.** A stall, a fatal hls.js
error, a premature source end — any of them correctly hands the coordinator a
generation to replace. What follows never varies: the failed node is excluded,
the only remaining candidate is a discovered plain-http LAN address, an https
page cannot fetch it, and the viewer gets a failure screen naming a node that
was never serving them. Play recovers because it is a fresh candidate walk with
no exclusions. Failing over while playing is right; offering a candidate this
host has no way of reaching is not.

Both items are core's, and neither has a client workaround worth building:

- [ ] **An http endpoint is not a failover candidate from an https page.** The
      same browser constraint as the P1 "https deployment against http nodes"
      entry below, which covers the read-ahead worker and not this. Whether a
      host can reach an endpoint at all is host knowledge, like
      `MediaWatchdogEnvironment.visible()` — core has no way to know and today
      has no seam to be told.
- [x] **The terminal error carries the failure that started the failover**, not
      the last endpoint tried. **Core's half shipped in 0.14.0:**
      `terminalRecoveryError(originating, lastAttempt)` chains the ending
      failure onto the originating one rather than dropping it, and returns the
      originating error — so the head of the message was already the right
      thing to lead with.

      **Checked 2026-09-20, and the client half was not done:** the failure
      screen rendered `fatalError.message` and nothing else, so everything core
      chained beneath it was thrown away on the floor. `failureCauseMessages`
      then walked the chain and read it out under the head, quieter — and
      **was itself replaced on 2026-09-23** by core's `playbackFailureDetail`,
      which carries the server's sentence from whichever layer knew it rather
      than reading `.message` off each layer (core's README: never render
      `.message`, never reconstruct it). The chain is still in the opt-in
      failure trail.

      **Not verified live**, and the thing it is for cannot be produced without
      the failover it belongs to: what a run should show is both sentences at
      once — the node that was actually serving, and the candidate that could
      not be reached.
The pause itself is verified live: 138 s paused with no warnings, no errors and
a forward buffer still filling, against 7 s to failure before the fix. Evidence
in `COMPLETED.md`. What is not verified live is a node dying *during* a pause,
which needs a node stopped at the right moment; the re-arm is unit-covered.

The "Pause: confirmed not applicable" note under any-node failover below was
right that pause makes no server call and wrong about the conclusion.

## P1 — A reclaimed direct session is reported as an unsupported format

Seen 2026-09-23, direct Matroska from fi-1, while the tab was hidden. The
start record read `no-first-frame` after 121,087 ms, **zero requests**, every
sample `hidden`; the node reclaimed the session at about 120 s (the client's
DELETE got 404). When the tab came forward the element failed with
`MEDIA_ELEMENT_ERROR: Format error` on `__macha_direct_cache__`, and the
client made that `PlaybackSourceError: Web media source is unsupported`,
terminal, with the failure screen. The format was fine: the same title played
direct from macnessa on reload. So a session that is gone is named as a codec
fault, and nothing tries to rebuild it. Two things to settle: what the
direct read-ahead cache serves once its session is gone (the format error
is presumably its response, not the media), and whether a hidden start
should hold off rather than let the reclaim run out. Tom, 2026-09-23: "this
is a problem in itself". Not diagnosed further.

The same run also hit the mode-switch P1 below: a direct-to-remux press on
macnessa (across the WAN from here) stalled at 9.81 s, was read terminal
after 7 s of nothing, failed over, overran the 19 s attempt budget on fi-1,
and landed on es-1.

## P1 — A mode switch negotiates from a stale position, and 7 s of nothing-arrived is read as terminal

**The blank half is fixed, shipped in 0.17.3 and watched live on 2026-09-21**
— 16.5 s of black became none; the record is in `COMPLETED.md` and in
[the run](2026-09-21-failover-and-mode-switch-live-run.md). What is left is
the stale position, which is core's, and the 7 s question, which is this
repo's.

**Measured live 2026-09-20, foregrounded, full timings in
[2026-09-20-transcode-handover-live-run.md](2026-09-20-transcode-handover-live-run.md).**
Selecting Transcode from Direct, mid-playback, on a 1080p HEVC 10-bit episode:

```
644,710  viewer at 93.671 s. PATCH {mode: transcode, seek_ms: 93671}
656,167  session-updated                      <- the PATCH took 11.5 s
         generation-update-ready reason=representation requestedPositionMs=93671
         media-element-reused, media-emptied  <- the picture goes
         source-presented generationStartMs=93671 positionMs=105092
661,007  initial-local-seek requestedPositionMs=11421 targetMediaMs=11421
668,018  source-terminal-failure "Playback stopped and nothing arrived for 7s."
         buffered=[0, 1.96]
672,394  failover: new generation on fi-1, generationStartMs=105092 positionMs=105092
672,695  playing
```

**Sixteen and a half seconds of black screen for one click**, and the viewer
kept their place only because the failover happened to build the replacement at
the arrival point.

**Not a P0 because it recovers, correctly and unaided, and the viewer loses no
position** — the 20 s rewind recorded under the handover P0 did not recur here.
It is a P1 because 16 s of black on a deliberate viewer action is the fault
*Thou Shalt Not Make The Viewer Wait* exists to forbid, and three of those
seconds are the client's own.

**The stale position is the same fault as the handover's join, by a different
path.** The PATCH asks for `seek_ms = 93671` — where the viewer was when they
clicked — and takes 11.5 s. By the time the generation exists the viewer is at
105,092. The client then computes the local target perfectly (11,421 ms into a
generation that starts at 93,671) and asks for it, and the node has produced
1.96 s of it. **The seek is right and the generation is in the wrong place.**

- [x] **Ask for the position the viewer will be at, not the one they are at —
      and it is core's, at a line core has now named.** Core located it from
      this trace: `PlaybackCoordinator.ts:1479` binds `seekMs` to the intent
      position at dispatch, and the one compensation that exists
      (`userMovedDuringRequest`, `:1519`) is gated on `positionRevision`, which
      only `seek()` increments (`:1226`). Playback advancing does not touch it,
      so core compensates for the viewer moving during a negotiation and not
      for the negotiation taking time. Core has it recorded as one fault with
      the lead-time placement. **Nothing for this client to build here** — the
      PATCH carries what core gives it. Core's open question is what to
      estimate the round trip *with*: `budgets.deadlineMs` (19 s on fi-1) is a
      ceiling, not an expectation, and over-estimating lands the generation
      ahead of the viewer.
- [x] **Do not empty the element until the replacement can show something.**
      Built and watched live 2026-09-21. The first attempt was wrong about the
      mechanism and the run said so: the hold was not declining, it was never
      called — a representation change arrives as `transition: 'continue'`,
      the handover declines silently because the outgoing source is Direct
      Play, and the hold sat behind `transition !== 'continue'`. It is now
      asked on both transitions, `canHoldThroughRelocation()` owns the rule,
      and it was measured twice: `relocation-hold-complete` at 2,726 ms and
      4,977 ms, `readyState` never leaving 4. Against a node still placing the
      generation at the click position, expect `relocation-hold-abandoned
      reason=incoming-seek-timeout` after ~8 s with the picture up throughout,
      then the teardown — better, and not the whole fix.
- [ ] **7 s of "nothing arrived" is a terminal failure that was not one.** The
      node was producing; the client had asked past its frontier, which the
      server documents as a bounded wait. Failing over to another node is an
      expensive answer to "the fragment I asked for is not encoded yet", and
      the classifier could tell those apart — a request past the produced
      frontier is knowable from `look_ahead_ms` and the buffered edge.
- [ ] **Re-measure once the arrival-point request lands**, on the same title
      and node, with the same three timings: PATCH duration, blank duration and
      whether a failover happens at all. The target is no failover and no blank.

## P1 — The wait is now told; which phase it is in is still core's

**Half done 2026-09-20, and the heading used to say "when it arrives".** Part
of it had already arrived and this session said otherwise: core 0.14.0 exports
`PlaybackRuntimePhase` (`idle | starting | playing | paused | stopping |
failed`) and this client has always consumed it —
`PlayerScreen.tsx` drives the spinner off `phase === 'starting'` and
`usePlaybackController` gates the player's visibility on `'stopping'`. There
is a second one as well, `NodePhase`/`StartupPhase` with `startupPhaseLabel()`
from cluster status, rendered on the Status screen. Tom caught the claim that
there was none. The three
budgets bound three sequential phases — negotiating a generation, waiting for
its first fragment, and starvation after a URL is attached — and nothing
bounds the sum: a cold node can spend 12 s + 30 s + 20 s before anything is
declared wrong, every budget behaving exactly as written. Core's answer,
agreed 2026-09-18, is not a cap (which would be a guess at where to cut) but
**visibility**: expose which phase playback is in and for how long through the
snapshot, and let the host decide what a viewer sees. Law 2 — failure and
degraded states must be visible and actionable rather than becoming indefinite
waiting.

- [x] **The number needed no core change and is in.** `starting` is one word
      covering all three phases, but *how long it has been going on* is
      knowable from here: `useElapsedMs` times the phase and
      `startWaitNotice()` puts "Waiting for the node to start the stream —
      12s" under the spinner after five seconds. Below that it says nothing,
      because most starts are a second or two and a message that appears and
      vanishes reads as a fault of its own. Only a start, never a rebuffer: a
      rebuffer has the picture behind it to say what is going on, and a timer
      over that would announce every brief hesitation.

      **The elapsed figure reads the clock rather than counting ticks**, and
      the test for that had to be rewritten before it meant anything. The first
      version advanced the timer and the clock together, which passes against a
      tick-counter as happily as against a clock — a check that agrees with
      whatever was written. Driving the clock independently of the timer —
      30 s of wall time against a single firing, which is a throttled
      background tab in miniature — distinguishes them: the tick-counter
      answers 1,000 and was watched doing it.
- [ ] **Which of the three phases, which is core's half.** When the snapshot
      says whether it is negotiating, waiting for a first fragment, or starved,
      the sentence gets more specific and the number stays where it is —
      `startWaitNotice()` is where that lands.

## P1 — The relocation hold has run on a seek and a failover; its abandon paths and a slow node never

Shipped in 0.17.2. On a seek that needs a new generation, the outgoing element
is paused on its last frame at the moment the control commits the seek, the
replacement is prepared on a hidden second element, and the two are swapped
once it can present the requested position. `WebPlayer.holdThroughRelocation`,
promoted through the existing `promoteHandover`. Since 0.17.3 the hold is
asked on **both** transitions, after a declined handover as well as on a seek,
and `canHoldThroughRelocation()` owns the guard; the same release made the
hold stand the stall budget down on a relocation no control asked for, which
is **unverified live**.

**What is verified.** One session on 2026-09-18, seven seeks. Five were
servable from the buffer: `picture-held` and `seek-local` on the same
millisecond, released before reaching a frame. Two needed a generation: the
picture was frozen 886 ms before `play()` was called, and
`relocation-hold-complete` landed 1,568 ms after the seek, with paused spans of
1,600 ms and 2,000 ms that ended on the replacement rather than on black. Two
`<video>` elements existed across both.

**What has never run, and must not be assumed good:**

- [ ] **A slow node.** Every completed hold so far finished in one to two
      seconds. The one that took 9.5 s exposed the missing
      `stallWatchdog.suspend()` — a held seek reported
      `source-terminal-failure` 6,864 ms in, on a node that was still building
      the generation it delivered. The `suspend()` call is in and is
      **unverified live**; nothing in the suite reaches it.
- [ ] **Every abandon path.** `not-ready-in-time`,
      `incoming-timeline-unestablished`, `incoming-seek-timeout` and the
      superseded checks all fall through to the teardown, which is the old
      behaviour, but none has been observed doing so.
- [x] **Failover.** A `relocate` transition also arrives on failover, where
      there was no control to take the hold, so `holdThroughRelocation` takes
      it itself. Exercised 2026-09-21: `relocation-hold-begin` on the failover
      itself, `relocation-hold-complete elapsedMs=2596`, the picture never
      blanked.
- [ ] **Native HLS and Direct Play.** Both decline by guard — Samsung owns its
      own element source and Direct never rebuilds a generation to seek — and
      the guards have not been watched declining.

The thing that would settle most of it is one session on a title whose
generations take ten seconds or more to build, which is a 4K HEVC transcode.

## P1 — Generation replacement on a second element: open questions

**Built and shipped; the heading used to say "not yet built".** The handover
(`handOverToSource` / `promoteHandover`, for a `continue` transition) went in
across `647ab48`, `9a07697` and `e716360`; the relocation hold that reuses the
same cut for a viewer-requested seek shipped in 0.17.2. The mechanism is now
documented as current behaviour in `docs/playback-handover.md`, and its
outstanding *verification* is the P1 above this one. What remains here is the
questions the mechanism raised and has not answered.

**A second media element, prepared hidden, is the mechanism.** Demonstrated live
2026-09-17 against `es-1`, transcode over fMP4, **with sound**, and confirmed
seamless by ear as well as by the clock.

```
A playing from 20.05 min, audible
B created at A + 25 s, attached to a second <video> with display:none
B reached canplay in 1.35 s, buffered past 50 s while never rendered
seek B to the join point while still hidden
spin until A reaches that exact content position, then hand over in one tick
  A 20.8998 min -> B 20.8997 min      ~6 ms of content error
  handover                             0.6 ms
```

**`display: none` is enough**, which was the surprise — an unrendered element
still buffers, and buffered *faster than realtime* (16 s of media in 12 s of
wall clock). No stacking, no `opacity: 0`, no off-screen 1×1. Element visibility
does not gate MSE; **tab** visibility gates everything, and a backgrounded tab
stops decode dead (`readyState 0`, `networkState 2`, no error) — the same
signature as the `readyState` 0 P0 — and see that entry for what the
2026-09-21 measurements did to this claim. Out of scope by decision: if nobody
is looking, a gap is acceptable.

**Alignment is the part that must be got right.** A first attempt promoted B at
its own creation point while A had moved on, and replayed about two seconds —
visible, and obvious with sound. B must be seeked to the join point *before*
promotion, which is free because it happens hidden.

**Why this is bigger than the reaped-session P0.** The same mechanism gives
seamless node failover for transcoded media, which has never worked: the
existing standby path is direct-only by construction (`addDirectSourceAlternative`
→ the read-ahead worker's URL list), because byte ranges are interchangeable
between nodes and transcode generations are not. Reaped session, dead node,
quality change — all become the same operation.

It also subsumes `preflightSource`: preparing on a hidden element *is* the
preflight, and a better one, because it ends with media actually playing rather
than a boolean saying bytes arrived.

- [x] Seam with core: **done, and smaller than proposed.** Core passes a
      `transition` argument to `play()` — `continue` when the viewer did not ask
      to move, `relocate` when they did — and the platform decides how to get
      there. No prepare/promote pair was needed; the teardown path stays the
      fallback when preparation is impossible.
- [ ] **Samsung is the open question.** A 2017 Tizen 3 panel forced onto native
      HLS may not tolerate two decoding elements. If not, this is web/Android
      and the TV keeps today's behaviour — a fallback, not a blocker, but it
      decides whether this is *the* mechanism or *a* mechanism.
- [ ] Bandwidth during the overlap: two transcoded streams run concurrently for
      the seconds before the swap, which on the WAN link could starve the stream
      still being watched. Argues for preparing late and keeping the overlap
      short, which is what core's lead time already computes.

- [x] **This repo: `fail-not-found` no longer tears down.** `reportSourceGone`
      reports and does nothing else, so the buffer built before the source went
      away stays as the recovery budget. Core took the obligation to end a dead
      playback (`failTerminal` sets the fatal error and the runtime stops the
      player), which answers the question of what the viewer is told when no
      replacement comes. Recorded in the pause P0's task list with its evidence (now in `COMPLETED.md`, 2026-09-23).
- [x] **Core is blind to Direct Play cover — fixed 2026-09-20.** `publish()`
      now emits `readAheadBytes` from the worker's `aheadBytes`, which is
      measured beyond `lastServedOffset` and so matches core's contract of
      "bytes beyond what the element has taken". Never folded into
      `forwardBufferMs`, which is `video.buffered` alone.

      **The key is absent, not zero, where there is no read-ahead** — a
      transformed source or an unregistered worker. Core reads absent as "this
      host has no such cache" and zero as "it holds nothing", and on a
      transformed generation the second would be a claim about a cache that
      does not exist.

      Deliberately **not** compared in `webPlaybackEventsEqual`, which looks
      like an omission and is commented as not being one: it changes on every
      prefetch response, so comparing it would turn the dedupe into a firehose
      on the path already moving the most bytes. It rides along on events
      published for a reason that matters, recomputed each time.

      **What this was costing:** core reads absent as no read-ahead, so on 453
      of 748 titles it did its runway arithmetic from element buffer alone —
      on precisely the path where element buffer understates cover the most.
      Core confirmed 2026-09-20 that its own aging of `readAheadRunwayMs` was
      a no-op on this host for the same reason. Suite 364, typecheck clean;
      not yet watched live.
- [x] **Held replacements are released when the player closes.** Verified live
      2026-09-17: closed inside the hold window, `session-stop` at teardown, and
      the held session id answered 404 on the node afterwards. No slot leak.
- [ ] **Do not fix it with a keepalive.** On 0.48.x the transcode entitlement is
      released after `transcode_entitlement_idle_ms` (300000 here) of no stream
      activity, so a paused session no longer pins the node's only video
      transcode slot for the life of the tab; the session record itself is
      still not bounded, and the reaping at `session_idle_ms` is correct.
      Noticing it on the way back is what is missing.

## P1 — Any-node failover: Phase 6 UAT is what remains

**Demoted from P0 on 2026-09-20.** Phases 0–5 are implemented and were
live-verified against a real 3-node cluster with repeated `systemctl
stop`/`start`. Nothing here is a live correctness fault; it is a verification
checklist plus one item blocked on the server. The "hard-reactivation seek
failure" that used to anchor this entry is **superseded by the seek P0**: a
seek to a non-zero position failing instantly with zero bytes requested is the
pre-0.46.0 forward snap meeting the client's alignment bound, which livelocked
rather than played, and both halves of that are now fixed and recorded there.

Detailed plan, phase-by-phase status, and dated live-verification evidence:
[the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md).
Remaining work, in priority order:

- [ ] **Measure playback under live import load (requested 2026-09-07 by the
  Macha server session; no deadline, the import runs for days).** Needs a
  genuinely foregrounded Chrome window — numbers from an occluded tab are
  worthless. Measure both a locally-written film and a remote-written one
  (the remote one is what matters — the es-1 WAN is saturated by the import,
  so this measures
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
  `video.seekable` only ever reach the generated frontier — one film's element
  read 8.05 s against a 92-minute title. That was reported as the cause of this
  entry and **it is not**. Two live checks killed it:
  - The scrubber does not use `video.duration`. `PlaybackCoordinator` prefers
    `session.durationMs` (`durationMs: session?.durationMs || next.durationMs`),
    and the UI for that same session correctly showed **1:31:46** with
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

## P1 — A failover still freezes the picture for ~12 s, and a ready standby waits for the terminal failure

**Re-measured 2026-09-21; the 63.6 s figure below is no longer the last
measurement.** The managed-HLS failover path was watched twice in
[the run](2026-09-21-failover-and-mode-switch-live-run.md), transcode from
`fi-1`, the node killed in-page. After the two 0.17.3 fixes: buffer drained
for 12.2 s with the frame up, the stall budget expired at 7 s, the hold engaged
on the failover itself, the swap to `es-1` landed at 21.8 s and playback at
24.0 s. **Zero frames of black**, `readyState` never below 2, and the viewer
landed within ~260 ms of where they were. What the viewer saw was an **11.8 s
still frame**, 7 s of it the stall budget.

**What the run also showed, and is core's question:** a replacement
generation on another node existed about 12 s before the picture stopped, and
was activated only when the player reported the generation dead — the
sequence was `source-stalled` → `source-terminal-failure` →
`source-failover-start`, with no early promotion. `promoteReadyAlternate`
(core 0.6.1) exists to promote a ready standby on continuing degradation
evidence rather than waiting for the fatal; whether its condition was met by
an in-page kill, or whether it fired and was not what the log named, was not
read. An attempt to buy the runway from this side — reporting the failure
while runway remained and keeping the element playing through it — was built,
measured and **reverted the same evening** as tuned to one node and one title;
"Why part three was dropped" in the run document has the argument. Seamless
needs a replacement that arrives at its join, which is core's placement and
the server's production rate; the client cannot buy it with runway.

- [ ] **Read core's promotion condition against the run.** If a standby is
      ready and the primary is still producing degradation evidence, there is
      nothing left to wait for; the 7 s stall budget is the detection cost on
      a node that has stopped answering *anything*, and it is defensible
      there. Whether the budget can be shorter for that case is a separate
      question from the frontier case under the mode-switch P1.
- [ ] **Direct Play failover is unproven by the in-page method.** The kill was
      a page-level patch of `fetch` and `XMLHttpRequest`, and Direct Play's
      read-ahead runs in a Service Worker that never sees it. A real node
      failure — a stopped service or a pulled link — is what tests that half.
      The bar is the path that works: the silent Direct Play swap failed over
      in **17 ms** on 2026-09-08 (`alternate-promoted-silently`).

**The original measurement, 2026-09-08**, web client, remux/HLS generation on
gbni-2, node stopped mid-playback:

```
397973  source-degraded (fragLoadError)
398240  alternate-ready -> gbni-1          <- rescue ready 267 ms in
428241  alternate-recovery-window-expired  <- thrown away, unused
461395  source-terminal-failure
461548  source-failover-ready -> gbni-1    <- the same work, done again
```

**63.6 s of black screen where the replacement was ready in 267 ms.** Two
budgets chosen independently, each defensible, whose product was a rescue
that always went stale: `ALTERNATE_RECOVERY_WINDOW_MS` held a standby for
30 s, hls.js's `errorRetry` backs off 1/2/4/8/8/8 for about 31 s, and one
`restart-network` per generation reset that budget, so the primary could not
go fatal for ~63 s and `recoverFromSourceFailure` only ran on fatal.
`promoteReadyAlternate` landed in core 0.6.1 to answer that. Core has since
cut the alternate recovery window from 30 s to 10 s, because 30 s was a server
*default* while 10 s is the floor a node refuses to start below.

**The Samsung half of this entry is closed** — the cluster-exhaustion symptom
that shared this section was a different defect (failover asked for the wrong
segment container) and is in `COMPLETED.md` under *"Samsung failover plays"*.

## P1 — Persist the confirmed same-origin endpoint, and decide where

0.16.0 ships the non-persisted form: the origin is re-derived and re-confirmed
on every cold start and seeded into the registry as `environment`. Tom's view
is that it should be persisted. The shape was not settled before the release,
so this is the open half of a shipped feature rather than new work.

**What is already true and easy to miss:** `EndpointHealthMonitor`'s
`persistConfirmedEndpoints` writes every confirmed endpoint into
`macha-discovered-endpoints-v1` on each cycle. So an adopted origin is
*already* persisted as discovered history and re-seeded into the registry next
start. What it does not do is count as "configured", so the gate and the probe
still run over the top of it.

**Discovered is the more correct classification** — it is runtime-learned, not
configuration, and the store documents itself that way. Making discovered count
as configured is therefore a small change and supersedes autodetection
entirely: the probe never runs, the splash never holds, and the client starts
with the whole cluster rather than one node.

**The gap it leaves, which is the actual decision.** Discovered names hosts
unrelated to the page's origin. A bundle later served from a different host
reconnects to the *old* cluster and, being "configured", never probes to notice
the Macha node it is now being served from. Narrower case, same shape: page
moves, old cluster is dead, new same-origin node is right there, and the viewer
gets an endpoint form.

Two ways to have both:

- **Discovered plus probe-on-unreachable.** Let discovered count as
  configured, and re-run the same-origin probe when every known endpoint has
  failed rather than dropping to the gate. One store, self-heals the
  moved-host case, at the cost of adopting an origin during an outage.
- **Discovered for the cluster, an origin-keyed record for the fact.** The
  health monitor keeps writing discovered; a separate small record remembers
  that *this origin* is Macha, so the probe is skipped on a matching origin and
  re-run on a different one. Two stores, each saying one thing.

Writing it to `macha-bootstrap-endpoints-v1` was considered and is the one to
avoid: it becomes indistinguishable from an endpoint the viewer chose, appears
in the Connection field as if they typed it, and survives the page moving.

## P1 — Port onto core's session model (`signOut`, `lastIdentityChange`)

**Status 2026-09-19: still adopted and green, still not ported.** Core has
moved 0.11.0 → 0.14.0 since this was written and none of it changes the item:
this client compiles and passes against the session model and references none
of the
renamed or removed symbols. That is *compiles and passes*, which is not the
same as ported, and the distinction is deliberate: two things are still
untouched.

- [ ] `AccountMenu.tsx:55` still calls `await api.logout()`. It should call
      `sessionManager.signOut()`, which revokes server-side and does not mint a
      replacement, then `sessionManager.start(registry)` **only if** that screen
      actually wants a session afterwards. This is the change held back until
      core stated the composition; core has now stated it.
- [ ] `lastIdentityChange` (`{ from?, to?, at }`) is subscribed nowhere.

**Why this is not a mechanical swap, measured on this cluster 2026-09-13.**
Core's session TTL is 30 days from creation with no sliding expiry and no
refresh tokens, so core's "refresh" timer **re-mints** rather than renewing.
Core describes the consequence as conditional — bad *"on a cluster whose
anonymous account holds no roles"*. On Tom's cluster it is not conditional:
`POST /api/v1/session` with empty credentials mints successfully on every node
and returns **`roles: []`**, after which `/catalogue/items` answers `403
requires the 'media_viewer' role`.

So a signed-in viewer whose session ages out is not degraded to browsing. They
are degraded to a session that **cannot read the catalogue at all**, which
presents as an empty client rather than as a sign-out. `lastIdentityChange` and
`sessionLockedOut` are the two signals that separate "your session aged out"
from "this cluster refuses you", and core deliberately says nothing about what
the change *means* — the wording is this client's to choose. Choose it knowing
the above, rather than writing "your session timed out" and leaving a viewer
staring at an empty library.

## P1 — Logout uses a revoked token until something 401s

Tom's ruling, relayed by the `@machafoundation/core` session 2026-09-13: **a
revoked token must not be used at all.** The correct composition is an
explicit server-side logout, then — *only if one is actually needed* — a
separate call to obtain an anonymous token. The phone client already does
this; this client does not.

`AccountMenu.signOut` (`src/components/AccountMenu.tsx:51`) calls
`api.logout()`, then `onSignedOut()`, then navigates. It never calls
`sessionManager.signOut()`, so the revoked token stays in memory and in
`sessionStorage` and is carried on every subsequent request until a later 401
forces a re-mint.

- [ ] Change to the ruled composition. Core will state it on the API surface
      first — on the `UsersApi.logout` and `SessionManager.signOut` doc
      comments, which is where all four clients read it. The conditional half
      — mint anonymous only when one is needed, not always — is the part that
      is easy to get wrong.

**A related core defect, open, and explicitly not to be worked around here.**
Raised by the `@machafoundation/core` session 2026-09-13: `SessionManager`
answers a 401 by re-minting, and a re-mint carrying no credentials is an
*anonymous* mint. So an administrator whose roles change is silently
downgraded to anonymous with nothing telling them they were signed out. It is
core's to fix and it is on their list. Do not build around it — a client-side
detector for "my roles just vanished" would be a second guess at a thing core
is about to state properly.

## P1 — Drop the `/users/me` fallback once every node names the session user

`useCurrentSession` fetches the session, and when it carries no `username`
falls back to `api.me()` — `GET /api/v1/users/me` — purely to learn a name.
Still there at `useCurrentSession.ts:92`. The 0.37.x nodes
named no user at all; 0.38.0 added `user_id`; `username` arrived 2026-09-13.

- [ ] Confirm every node in the cluster reports `username` on
      `GET /api/v1/session`, then delete the fallback and its round trip.
      Keep it until then — a mixed-version cluster is normal here.

**2026-09-20: every reachable endpoint confirmed — this is now a deletion.**
`GET /api/v1/session` returns `username` and `user_id` from
`https://ramaroja.macha.network`, `http://10.34.1.50:7438` and
`http://10.35.1.50:7438`, then on server 0.46.2 and all three on 0.48.2 at
the time of writing. `macnessa` is `gbni-1` and is one of the three;
`inverbeg` (`gbni-2`) is the one node not seen since 2026-09-17, and if it
comes back below 0.38.0 it will be the only one. Delete
the fallback and its round trip.

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

## P1 — Releases keep shipping unseen on both televisions

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
- [ ] **The node pills on a remote.** New focusable controls in the player's
      options panel (0.18.0), grouped and sorted; the D-pad must reach them
      and a press must state the preference. Never opened on a set; deployed
      since 2026-09-21.

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

## P1 — Should a stall move the viewer off a node that is still producing?

**Trimmed 2026-09-20.** This used to hold two questions. The second — where
stall detection lives — was answered by core 0.7.0, which took both watchdogs
with the environment injected. The mechanics of the first have since been
answered too: since core 0.14.0 the stall budget is **derived from the serving
node** — `mediaStallTimeoutMs(source)` is that node's `segment_timeout_ms` plus
a margin, applied through `MediaStallWatchdog.useSourceBudgets(source)` — so
the relationship this entry once complained lived only in prose is now code,
and the "7 s versus 6 s hold" arithmetic is no longer a number anyone picks.
`useSourceBudgets()` is called here since 0.17.3, at the top of
`watchForStall` (`WebPlatform.ts:2171`).

**What is still open, still not a defect, and still Tom's.** A node at its
production frontier *is* making the viewer wait, which is why the budget was
shortened; but the replacement starts its own generation from nothing, so
moving off a node that was seconds from delivering can cost more than staying.
Worth measuring before changing: what it costs to be moved off a producing
node, against what it costs to wait.

**Constraint, from Tom 2026-09-09: none of this may change the seamless Web
failover.** The silent Direct Play swap promoted in **17 ms**, uninterrupted,
with zero measured stall (`alternate-promoted-silently`). That path is
byte-level — the worker swaps the source underneath an element that never
reloads. A coordinator-level detector feeding `degrade()` would be a *second*
degradation source on the one platform that already has one, and `degrade()`
promotes a stored alternate on second evidence, which reloads the element.
Turning a 17 ms invisible swap into a visible reload would be a regression no
test currently catches. Measure before and after, same cluster, same title.

## P1 — `levelLoadError` evicts a healthy node, with no server error behind it

Observed twice on 2026-09-08, unprompted, on **wired gbni-1** during a
transcode of a 92-minute film. Full sequence the first time:

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
| gbni-2 (wireless) | **0.31–0.58 MB/s** across three different films |

Identical across titles, so it is the node and not extent placement. And it is
enough to explain the transcode throughput results directly: the largest of
the three is 21.1 GB over 153 min, so realtime needs ~2.3 MB/s of source reads.
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

**Settled with the RN session, 2026-09-08, and not yet done anywhere.**
Core's single-list `MusicPlaylistStore` is to be **deleted**, not renamed —
at `aab8028` core still exports both it and `PlaylistStore`, and this client
still calls `playlistStore.replace(tracks)` at `useMusicController.ts:59` — a collection subsumes it,
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
  a real subscription. Note the RN session's scar when doing it: subscribing to
  a revision counter and then calling `list()` freezes, because the memo is
  keyed on a store whose identity never changes — the snapshot must *be* the
  value the caller renders.

  **Unblocked 2026-09-13.** Core gave `PlaybackQueueStore` and
  `ContinueWatchingStore` a `subscribe` and a `getSnapshot` with stable
  identity between mutations, matching `PlaylistStore`. Two of the four named
  in the original question needed nothing: `VolumeStore` returns a number, and
  a primitive is stable by value; `MusicPlaylistStore` is superseded by
  `PlaylistStore` and gets deleted rather than a new surface. Tom also ruled
  that volume and mute are player logic and do not belong in core, so expect no
  mute concept there.

  **The "two consumers would silently diverge" case is not hypothetical here —
  it already exists, checked 2026-09-13.** `PlaybackQueueStore` has two: the
  owner, `usePlaybackController`, which holds `queueState` in `useState`
  seeded from `queueStore.load()`; and `useMusicController`, which calls
  `queueStore.load()` / `insertNext` / `append` directly and hands the result
  back through an `onQueueChange` callback wired in `App.tsx:486` to
  `playback.setQueueState`.

  It is correct today, and nothing is broken. But the two are kept consistent
  by one callback that no test asserts and nothing enforces: any future path
  that mutates the queue store and forgets to call it leaves the controller
  rendering a stale queue, with no error and nothing to point at. That is the
  argument for the subscription, and it is stronger than the playlist case
  that originally prompted it — `ContinueWatchingStore` has only the one
  consumer, so the queue is where the work should start.

## P1 — Swap the HLS walks onto core's `hlsWalk.ts`

Core absorbed both walks — the preflight and the readiness probe
(`probeFirstFragment` and its hold-aware 500 retry) — into one module over a
shared target primitive, plus `EndpointHealthMonitor.probeNow()`. This
client's `preflightWebHlsSource` and `probeFirstFragment` become deletable.

**Two behaviour changes come with it, both of which fix real faults here:**

- **A non-manifest source now returns `true`.** Mine returns `false`, which
  makes the coordinator destroy a standby it could have promoted — see the
  open P0 on a ready standby being discarded. The Android TV client's answer
  was the correct one and mine was the bug.
- **The deadline is above `SERVER_SEGMENT_HOLD_MS`.** This one is already
  fixed here — `HLS_PREFLIGHT_TIMEOUT_MS` is
  `SERVER_STARTUP_TIMEOUT_MS + SERVER_SEGMENT_HOLD_MS + 4_000`, 25 s, derived
  and written as the sum it has to exceed. (This entry used to say it was a
  picked 5 s; it was, until 2026-09-17.) Taking the figure from the serving
  node via `PlaybackSource.budgets.deadlineMs` with the constant as fallback
  is done as of 0.17.3.

**The lesson that generalises past this swap:** a picked number states
nothing; a derived one states its relationship. Core's replacement asserts the
*inequality* against `SERVER_SEGMENT_HOLD_MS` in a test rather than pinning the
number, so it cannot drift back. Do the same here for anything that survives
the swap.

- [ ] **Blocked on the web, found 2026-09-23.** Core's walk marks every
      request uncacheable with `Cache-Control` and `Pragma`, and the nodes
      allow only `Authorization, Content-Type, If-Match, Range` cross-origin,
      so a browser blocks those requests outright (`TypeError: Failed to
      fetch`, proven on a live manifest URL). This client's probes pass
      because they use `cache: 'no-store'` and only `Range`. Core keeps the
      headers because the fetch option rewrites signed URLs on React Native
      and is dropped on Tizen 3, and the host fetch override it briefly had
      was removed the same day with the one-byte start-cost probe. Swapping
      today would break the standby preflight and readiness probe on the web.
      Needs either the nodes to allow those two headers, or core to take a
      host fetch for the walk again.
- [x] **Zero-byte checks go, this client's included — Tom, 2026-09-23:**
      "Zero byte check is a hack and we're not doing it. If you've a better
      idea, talk to core." `probeFirstFragment` / `awaitNativeHlsFirstFragment`
      (the native-HLS path, the Samsung build) are a `bytes=0-0` probe and are
      to be deleted. Proposed to core the same day: read readiness from the
      session route instead, where from server 0.47.0 `stream.production`
      `produced_ms > 0` says the first segment is published (segments are
      published whole); absent means cannot say, hand the source over as
      before. **Done 2026-09-23 against core `3e611b8`:** the web player
      declares `needsProducedSource` on the native-HLS path only, core holds
      such a source back until the session route reports `produced_ms > 0`
      (published whole, so never early; the create response carries the
      first reading), and `probeFirstFragment`, `awaitNativeHlsFirstFragment`
      and their constants and tests are deleted. Unit-tested; **not yet seen
      on the Samsung set**, where the evidence is a `source-produced-wait`
      line reading `produced`, the create-to-hand-over time, and the element
      starting clean on its first segment. Needs Tom at the television.
      **The standby preflight stays** (Tom, 2026-09-23): "it is reasonable to
      request initial media from a node you're about to failover to." Its
      `bytes=0-65535` read is real media from the node about to serve.
- [ ] Swap both implementations, run the suite, and confirm the two changed
      behaviours **by test rather than by reading** before deleting anything.
      `Player.preflightSource` stays the seam the coordinator drives, and core
      does not call `probeFirstFragment` for a host — so the call sites stay
      here and only the implementations move. If a call site ends up with no
      obvious home, ask core rather than improvising; that is how a fourth copy
      gets born.

**A playlist must never carry a `Range` header — checked here 2026-09-13, and
this client is clean.** Both probes fetch playlists bare
(`WebPlatform.ts:121` and `:196`); `Range` appears only on media legs
(`bytes=0-65535` preflight, `bytes=0-0` readiness). The Android TV client found
the opposite in theirs: up to 64 KB pulled per playlist per attempt for a check
documented as reading no payload, and — the real fault — **a media playlist
over 64 KB comes back `206` with a silently truncated body**. A two-hour film
at six-second segments is ~1,200 entries, so real content crosses that line.
Parsing top-down hides it completely: the probe still finds a first URI and
still returns ready.

Being clean here is luck, not foresight. The `bytes=0-0` comment explains why
one byte is right *for a fragment*; nothing says why a playlist must carry no
Range at all. Tidying the two fetches into one helper with a shared header
would introduce exactly their bug, and no test here would catch it.

## P1 — Seek acceleration is Samsung-only and should work everywhere

`PlayerScreen`'s scrubber `onKeyDown` returns immediately unless
`samsungControls`, so `accelerateSeek`/`seekAcceleration.ts` — the
hold-to-travel-further behaviour — never runs on web or Android. Web gets
`webSeekDeltaForKey`, a flat ±10 s per press. 0.18.0 made the web scrubber
*commit* on every key a range input moves itself on (`committingScrubberKey`,
on `keyup`), so the position no longer lags the thumb; the step is still the
browser's own, and the accelerating hold is still behind
`if (!samsungControls) return` at `PlayerScreen.tsx:995`.

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

## P1 — Three different 429s, and what each one does here

Observed live 2026-09-07 while measuring transcode latency: `POST
/api/v1/playback/sessions` answered `429` on gbni-2 while an earlier session
of the same client was still open, and `201` immediately after that session
was `DELETE`d. Confirmed with the server session as **admission control by
design — a hard limit, not a queue.** Since then the server has grown a
per-account cap and core has grown a classification, so this entry stops
describing a single "429":

| code | route | scope | core at `aab8028` |
| --- | --- | --- | --- |
| `account_session_limit` | create | this account on **this node** — server 0.48.0, counted per node with no replication, 32 here | walks to the next node and **charges nobody** (`7b4548a`); `isAccountSessionLimit` names it; this client's `accountSessionLimitNotice` follows core's head rather than leading it |
| `resource_limit` | create | the node really is full: node-wide sessions (64) or a transcode limit (video **1**, audio 4) | charged and walked on a walking path; on a pinned path (a viewer chose the node) **not charged** (`failureBlamesEndpoint`), because nothing can walk away from it |
| `resource_limit` | update | request-scoped: the session lives here and still serves, and the remedy is a different instruction on this node | not walked, correctly; surfaces as a refusal |
| `too_many_sessions` / `try_later` | `/api/v1/session` | the auth store (4096 per node) and password rate limiting | a different subsystem; exists because a re-mint loop filled it once, so never probe liveness with a mint |

Core keys on the status for now; the server's `scope` and
`alternative_may_succeed` axes are committed there but were not deployed when
core wrote that, and every node in the field sends `resource_limit` bare.

- [ ] **The one this client owes.** A mode switch to Transcode on a session
      that does not hold the node's single video-transcode slot is refused
      `429 resource_limit`, the player shows the refusal, and the mode the
      viewer asked for is silently not applied (measured on the 2026-09-21
      smoke test). Core's handling is right — the session is serving here —
      but the mode control should say the choice did not take rather than
      leaving that to the failure trail.
- [ ] Do not retry a `429` on a timer, and make sure the client is not the
      one leaking: a session that outlives its player is what turns this into
      a viewer-visible dead end. Core's `stop()` now issues the `DELETE`
      on the strength of the id (verified on the wire 2026-09-21); before
      that it silently dropped the close when its map had lost the id, which
      is why fi-1 once showed 24 creates and no expiries.
- [ ] After the cap cutover, what to watch is not a refusal a viewer sees but
      `standby-preparation-refused` carrying `accountAtSessionLimit` **while
      nobody sees anything wrong** — the cap working as designed while
      seamless failover quietly gets worse, the only state here that produces
      no symptom. The 32-per-node cap is comfortably above the twelve this
      repo's failover measurements produced, and it is reachable on these
      nodes.

## P1 — Choose the node a torrent downloads to

**Tom asked for this through the `Macha Server` session, 2026-09-21. The API
is built and unreleased**; that session will say when it deploys and in which
version. Contract feedback was sent the same night and is summarised below
with what was measured to produce it.

**The contract.** `POST /api/v1/torrents/jobs` takes an optional `node_id`
(32 hex characters) beside `magnet` or `acquisition_ref`. Omitted or null
keeps today's behaviour — the job runs on whichever node served the request.
The `202` now **always** carries `{id, node_id}`, including when no node was
asked for. `400 bad_request` is a malformed id; `409 placement_failed` is a
node that is not an active member or is unreachable, with the message saying
which. It is never quietly downloaded somewhere else, so a 409 means nothing
started.

**Most of the display already exists.** `TorrentJobCard`'s detail pane has a
`Node` row rendering `job.node_id` (`IngestScreen.tsx:236`), and
`GET /api/v1/torrents/jobs` already returns the field per job, so showing
placement needs no new call.

- [ ] **A node control on the magnet form**, in this client's existing idiom:
      the same grouping and labelling the player's node pills use, plus an
      explicit "any node" that sends no `node_id`. Not a silent default —
      the operator should be able to see which they chose. Every control
      needs `data-tv-focusable="true"`.
- [ ] **Show what the choice costs.** The nodes are deliberately unequal and
      the server session put a number on it: a download on the four-core,
      4 GB, spinning-disk box takes it to load 13 while the other two idle.
      `/api/v1/status` already carries `runtime.load1`,
      `process_cpu_percent` and `storage` per node, and this client already
      fetches it. Showing load and free space beside each choice is the
      difference between a control and a guess.
- [ ] **Render `409 placement_failed` as its own sentence**, distinct from
      `400`. One is this client's bug and one is a fact about the cluster,
      and the viewer can act on only the second.
- [x] **The `Node` row's fixture was lying.** It said `gbni-2`; no server has
      ever sent that. A real id is 32 hex characters, so the row an operator
      reads today says `855716bd8bb0ad12b0c4f876386699de`. Fixture and
      assertion corrected to a real id, which is what makes the naming
      problem below visible in the suite rather than only on a screen.
- [ ] **Blocked on the server, and asked for:** a human `name` on each
      `nodes[]` entry of `/api/v1/status`. There is none today, and the only
      human-ish label, `host`, is inconsistent across this cluster — two
      nodes report public DNS names and the third its machine name — as well
      as being the RPC bind address rather than an identity (see the identity
      P2 below). Until it lands, label a node by a short id prefix and say so;
      do not invent a name from `host`.

**Two questions are open with the server session.** Whether a node reporting
`hosts_extents: false` can accept a torrent job at all — `corvus-fi-1` reports
exactly that on the live cluster — because if it can and the data then lands
elsewhere, the guarantee that makes this contract worth building is broken.
And whether `node_id` is accepted exactly as status reports `id`, since this
client will pass it straight through without normalising.

**Not built ahead of the deployment, deliberately.** The contract may still
move — this client has asked for one change to it — and building against a
contract that then moves is how the fixtures in this repo came to describe a
wire nobody serves.

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

## P1 — Home pulls the whole catalogue, and a node may send it uncompressed

Measured 2026-09-17 against `ramaroja`, hard refresh, devtools open, with
`macnessa` and `inverbeg` offline.

**Artwork is not the problem, and was the first suspicion.** 34 artwork
requests, HTTP/2, **23 in flight at once**, median 18 ms each, median stall
before request start 13 ms. No queueing and no connection limit. They simply
cannot start until the cards exist, and the first one goes out 35 ms after the
last catalogue call lands. Anyone watching the waterfall sees a staircase and
blames artwork scheduling; it is the wait in front of it.

**What the wait is.** Home fires `type=movie` (416 KB), `type=episode`
(1.19 MB) and `type=track` (850 KB): about **2.5 MB of JSON before a single
card can draw**. Phase breakdown of the worst one, uncompressed at the time:

```
requestStart -> responseStart    329ms   server thinking
responseStart -> responseEnd    5082ms   body arriving
```

The server answered the same call to `curl` in 0.97 s, and four concurrent
calls finished no slower than four sequential ones, so neither the node nor its
concurrency was the limit. From an idle page the same fetch takes 1.2 s. The
seconds appear only during boot, when 2.5 MB shares one connection with the
bundle.

**Compression is the lever, and it is the server's.** At the time of measurement
the catalogue response carried no `Content-Encoding` *and no
`Vary: Accept-Encoding`* — and the server sets `Vary` before it tests size or
`Accept-Encoding`, so its absence means the response never reached those tests.
Re-measured later the same day, both nodes compress it correctly: **93 KB
against 416 KB, a 4.5x saving**, direct and through the public name. The nodes
that answered during the slow measurement have since gone offline, so which
branch it took is not provable now.

**`Vary: Accept-Encoding` present-or-absent is a one-request test for "is this
node compressing at all".** Use it before theorising.

- [ ] **Does Home need the entire catalogue by type?** 2.5 MB to draw a few
      rails of twenty. Compression makes it ~550 KB, which may be enough that
      this never needs answering — but it is a client design question and
      nobody has asked it.
- [ ] **`/api/v1/manage/unmatched` is fetched on every Home load** — 115 KB,
      3.0 s on one load and 8.0 s on another, competing for the connection with
      the data the screen actually needs. It feeds the count badge on the Manage
      nav item: the screen needs a number and is downloading the list to count
      it. Either a count endpoint (server) or defer it until Manage is opened
      (here).

**For the server session — some streams can be gzipped.** `compress_response`
(`src/http.cpp:597`) skips every response carrying an `HttpBodySource`. That is
right for media: already compressed, range-requested, sent zero-copy, and an
encoding on one part of a representation cannot be reassembled. But `stream`
there means "delivered through an HttpBodySource", not "media", and
`HttpBodySource::resident()` (`src/http.hpp:51`) already names the difference —
a `MemoryBody` has the whole payload in RAM. Those can be compressed exactly as
a `body` is: one shot, known length, no chunked framing, no per-connection zlib
state. Condition: `stream && stream->resident() && status == 200 && no Range &&
compressible type`.

## P1 — The mouse cursor stays hidden once it is hidden

Moving the mouse must bring the cursor back. It does not.

`PlayerScreen` applies `cursor-hidden` whenever `fullscreen && !controlsVisible
&& !fatalError`, and `.player-page.cursor-hidden { cursor: none; }` in
`base.css:677` does the hiding. The class only comes off when `controlsVisible`
turns back on, and nothing listens for pointer movement to do that — the
`showControls()` calls are wired to key presses, transport actions, seeks and
`fullscreenchange`, but there is no `mousemove`/`pointermove` handler anywhere on
the player page. So once the chrome auto-hides in fullscreen the pointer is
invisible until the viewer presses something, which on a desktop is the one
input they are most likely to reach for first.

Revealing the chrome on movement is probably right rather than only restoring
the cursor, since that is what the hidden state is paired with — but a pointer
that moves must at minimum become visible again. Worth checking the mini player
and the non-fullscreen page at the same time, since the class is gated on
`fullscreen` and the behaviour should not differ in a way nobody chose.

## P1 — A move to a node this viewer's link cannot carry

The node move works (see `COMPLETED.md`, 2026-09-23). Two things are left,
both measured, neither this client's to build.

- [ ] **Decline, with a reason, a move to a node that cannot sustain the
      stream from here.** gbni-1 from this client's fi-1 site opened at
      0.26-0.57 MB/s against a 0.63 MB/s stream, then ran at about 1.6 MB/s.
      Core now has fragment-level throughput per node (this client feeds it)
      and the session bitrate, and has agreed to build the decline once the
      rate has more than a handful of media samples. The lead stays this
      viewer's measurement, because a steady-state rate passes where the cold
      opening loses.
- [ ] **The first move of a page to a node is unled.** Neither side has a
      measurement yet, so it behaves as before: a race the handover loses on
      a slow link, and a ~15 s freeze. Core has asked the server what it can
      state about a node's start cost without a stream request; the
      one-byte probe is ruled out (Tom, 2026-09-23).

## P2 — Pause follow-ups that survived the reap run

The pause P0 is closed (`COMPLETED.md`, 2026-09-23). Two small things and two
rules came out of it.

- [ ] **Write `hold_timed_out` down as a contract, beside
      `SEGMENT_NOT_READY_STATUS`.** `500 segment_not_ready`, `Retry-After: 1`,
      `Cache-Control: no-store`, never a `404`: the encoder did not reach
      that index inside the hold window, and retrying is correct. It is the
      one 5xx that must not read as node ill-health.
- [ ] **The standby preflight's failure vocabulary is thin.** Timeout, `404`,
      empty body and not-applicable all return a bare `false`, and
      `!source.isManifest` reads as *refused* before any request is made.
      Harmless while nothing gates on the cause; wrong the moment something
      does.

Rules, not tasks: **production is sequential**, so asking a node for a
distant fragment authorises production and then waits while everything
before it is encoded; a fresh generation at the arrival point beats making
an existing one encode its way there. And **segment durations are on the
wire** (`#EXT-X-TARGETDURATION`, per-fragment `#EXTINF`; a transcode's first
fragment is 2 s by design): read them, never multiply a count by a guess.

## P2 — 40% of artwork is unreachable when one of three nodes is down (server's; watch only)

**Demoted from P0 on 2026-09-20.** The entry says in its own first line that
it is not this repo's fix and that no client time should be spent on it. A
watch item on another repo's fault is P2 by this file's definition — "blocked
on something outside this repo" — however serious the fault is. It is kept so
that it is not re-diagnosed as a client bug, which is its whole purpose here.

One reading below has since been explained: from server 0.42.0 a node holding
no extents reports `local_artwork_objects: 0` **by design**, so that counter
alone is no longer evidence. The replication fault itself was confirmed real
by the server session and is not stale.

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

## P2 — Android TV plays 5.1 titles without downmixing them (the RN session's)

**Not this repo's, by Tom's ruling 2026-09-13, and demoted to P2 on 2026-09-20
for that reason.** Kept for the one finding nobody should re-derive, and the
two routes that were on the table when it was handed over.

**The finding.** `dumpsys media.audio_flinger` shows our track carrying
`Chn mask 8000003F` on a stereo output — `AUDIO_CHANNEL_INDEX_MASK_6`, an
*index* representation with no channel positions, so AudioFlinger's downmixer
has nothing to fold and the centre channel (dialogue) is dropped. The server is
innocent: the init segment's AAC `AudioSpecificConfig` is `11b056e500`,
`channelConfiguration=6`, positional 5.1. Chromium ships no AC-3/E-AC-3 decoder,
so an E-AC-3 source is forced to AAC 5.1 in a WebView and Chromium presents the
result index-masked. Direct Play is unaffected because nothing re-presents the
channels. Stereo titles play correctly; every 5.1 title is wrong from the first
second, permanently — nothing about it is time-dependent.

**The two routes, theirs to weigh:** a native Media3 player host on Android
behind the existing `Platform`/`Player` boundary (the risk being a transparent
WebView composited over a SurfaceView), or a channel-count preference negotiated
like every other transform. Server-side stereo transcode was proposed and
rejected. **Start no client work here on either.**

The shell change that came out of the earlier misdiagnosis stands on its own
merits: `MainActivity` holds `AUDIOFOCUS_GAIN` and `FLAG_KEEP_SCREEN_ON` while in
front and pauses the page's media on focus loss. It is the only way this app can
yield the audio device at all, it has run on the set since 2026-09-09 without a
reported spurious pause, and nobody has deliberately provoked a focus loss to
test it.

## P2 — There is no way to clear the configured endpoints

`ConnectionForm` is the only way to change them and `saveServer` refuses an
empty list: `normalizeConnectionEndpoints()` returns nothing, and the viewer
gets "Enter at least one Macha API endpoint." So a client that has been pointed
at a cluster can be repointed and never unpointed, and the only route back to a
cold start is clearing site data — which on a browser is two seconds and a
devtools panel, and on a television is neither.

Tom asked the RN client on 2026-09-20 to ship no endpoints, persist what the
viewer supplies, and offer a real interface to **change or clear** them, with
this client named as the model. On clearing, this client is not yet a model of
anything.

What a clear has to do, and the reason it is not a one-line delete: with
`bootstrapEndpoints` empty the client falls back to the same-origin probe, so
on a node-served page clearing returns it to "using the host it was served
from" rather than to the Welcome screen — which is correct behaviour and will
read as the clear having failed unless the screen says so. Discovered
endpoints are a separate list (core's, written by `EndpointHealthMonitor`) and
a viewer clearing configuration will expect those gone too, or they will watch
the client reconnect to a node they have just removed.

- [ ] Decide whether clearing means "forget configuration" or "forget every
      endpoint including discovered", and say which in the UI copy.
- [ ] Add it to `ConnectionForm` as its own control, not as an empty save —
      an empty textarea is ambiguous between "clear this" and "I have not
      finished typing".
- [ ] Coordinate the shape with the RN client rather than inventing two.

While in there: `setDiscoveredEndpoints` in `src/state/client.ts` is exported
and has **no caller**. The write is core's, inside `EndpointHealthMonitor`;
this client only reads the list to seed the registry. Either it is the hook a
clear needs, or it should go.

## P2 — Identity reset is keyed on the RPC address, and fails open if that address goes

**The relabel is done, since 0.16.0.** The node page shows `API endpoint`
(`api_endpoint`, or "None advertised") and `RPC address` (`host:port`) as the
two different things they are; this entry used to ask for that and kept
asking after it shipped. The node's display name still falls back to
`node.host` (`StatusScreen.tsx:73`), which is the RPC host — harmless, and the
`api_endpoint` host would be the better name when one is advertised.

- [ ] `resetNodeIdentityAssociation(nodeId, host, port, reason)` is a
      **mutation** keyed on host and port, fed from `node.host`/`node.port`.
      If those survive as the RPC address, nothing changes. If the server
      tidies them away, `port` is optional through `ManageApi`,
      `MachaManageApi` and `ClusterManageApi` alike (core, 2026-09-08), so a
      payload that stopped carrying it would neither fail to compile nor throw
      — it would send a **destructive identity reset with the port missing**.
      Everything else in that wire change fails closed; this is the one path
      that does not. `/api/v1/status` on 0.48.2 still carries `host` and
      `port` per node, and now `identity_association_reset` beside them.

This client reads no `api_host`/`api_port` anywhere (verified 2026-09-08), so
the server's replacement of those two is safe here; discovery is core's alone.

## P2 — Repo conventions

Tom set these 2026-09-13 and asked every session be told. The dated branch
bookkeeping that used to sit here is gone: `0.18.0` is the last tag, on
`main` at `ce74408`; `develop` is the working branch, a few commits ahead
with the core link in it, and the two differ in `package.json` and the
lockfile by design (see the core section).

- Work happens on a long-lived **`develop`**; releases are tags on `main`,
  with a merge commit on `main` named for the version.
- The remote may still carry stale release-named branches (`0.13.0`,
  `0.14.0`). They hold nothing unreachable and are Tom's to delete.
- The push rule lives under Standing rules, where it belongs.

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

## P2 — Seeks are blind: no keyframe index reaches the client

Blocked on the server; recorded here because the client is the thing that
would use it. Detail, measurements and sizing in
`2026-09-18-keyframe-index-for-exact-seeks.md`. **This is the optimisation half
of the seek P0 above** — that item is the correctness half and comes first.

Neither this repo nor core has any keyframe data for the media being played.
`MediaTechnicalProfile` carries format, container, duration, bitrate, size and
streams, and nothing about sync samples. So every seek names a millisecond
blind and finds out afterwards how far the node had to travel to reach a point
it can start a stream on.

Measured 2026-09-17/18 across five generations on one episode, remux, two
nodes: overshoots of **449 ms, 1,810.8 ms, 4,779 ms, 8,933 ms and 9,293.9 ms**.
Same title, same mode — a 20x spread the client cannot predict.

**The content loss is gone; the blindness is not.** Server 0.46.0 aligns remux
backward to the keyframe at or before the request and reports the remainder as
`seek_offset_ms`, so nothing is skipped any more — see the seek P0 for the
contract. What remains is that a client still cannot tell, before asking,
whether a seek will be exact or several seconds of offset, and an offset still
costs a fragment fetched and discarded.

The server already has the data (`video_random_access_points`, derived from
the demuxer index at open) and already states the contract: **a position in
that set yields offset zero in both remux and transcode.** The client cannot
take that offer because it does not know where the points are.

Sizing: ~20–25 KB gzipped for a dense three-hour film, ~4–10 KB for this
library's density — one to two percent of a single Original-quality segment,
and immutable per file so it is fetched once and cached indefinitely.

- [ ] Server: expose the random access points for a title, cacheable per
  source file. (Server-side; tracked here only because the client waits on it.)
- [ ] Core: model them so the platform and coordinator can read them.
- [ ] Client: snap a seek target to the nearest point at or before the request
  before sending, so `seek_offset_ms` is zero, nothing is skipped, and the
  node's seek fast path becomes reachable.
- [ ] Client: consider snapping the scrubber to those points while dragging,
  and decide whether snapping is unconditional or a preference — transcode can
  still serve an exact frame at the cost of a decode pre-roll, so the precise
  option must stay reachable.

## P2 — Native platform players

Real, substantial feature work with no active bugs behind it — sequence
after the P0/P1 items above, not before.

- [ ] Implement an Android Media3 platform host against the existing player
  boundary while preserving `PlaybackRuntime` ownership and state-machine
  semantics.
- [ ] Implement a Samsung Tizen AVPlay platform host against the same boundary.
  Until then, retain the shared HTML5/Web player and conservative Tizen 3
  capability profile used by the current Samsung package.
