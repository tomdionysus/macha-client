# Active tasks and concepts to explore

Last updated: 2026-09-21 (410 tolerance landed for the server's route change; 0.17.3 tagged and pushed, deployed nowhere; a failover driven live — the mode switch and the failover both keep the picture now, and the seamless half was tried and rolled back)

This is the working backlog. Add new work here. When an item is implemented and
its stated verification is complete, remove it from this file and add a dated
entry with evidence to `COMPLETED.md`. The dated documents in this directory
remain the detailed plans and verification records; this file is the index.

Scope: this repo is macha-client only — the UI/playback client. Server-side
backlogs (`macha`'s own `TODO/ACTIVE.md`) and core's are different repos'
concerns and are not duplicated here, even when a client bug and a server bug
are related. Core is addressed as the `Macha NPM Core` session.

## Start here

**0.17.3 is released, tagged, merged and pushed — and NOT deployed.** Tagged
`0.17.3` on 2026-09-21, `main` and `develop` both at `9409780`. The release
built clean from `main` as `index-CnpOpAES.js` — and that bundle has still
never been deployed. What every node serves as of 14:37 on 2026-09-21 is the
**develop** build against hot-linked core `648474d`, `index-NDVfpduh.js`,
deployed on Tom's instruction because these nodes are not production; see the
deploy section. So the nodes are ahead of 0.17.3, not on it.

It carries ten changes, and `CHANGELOG.md` says which of them have been watched
against a node: **two have** — the picture now survives a mode switch (16.5 s
of black, measured, now none) and a failover (9 s of black, measured, now
none). The other eight landed with unit cover and a fault watched failing
first, and no live run; each one's open half is a `[ ]` further down this file.

**0.17.2 is deployed everywhere**, from 2026-09-20 on Tom's instruction: `fi-1`,
`es-1` **and `gbni-1`** — the third had never served the client at all and
needed a `web:` block and a process restart. `ramaroja` and `macnessa` answer
with it too. What the `gbni-1` restart cost is recorded below.

**Core is `^0.14.0` from npm as this is written, and a `file:../macha-ts` link
is expected to come back.** It carries the seek contract,
`PlaybackSource.budgets`, `useSourceBudgets()` and the derivation helpers, and
`GENERATION_ATTEMPT_BUDGET_MS` is gone.

**Do not unlink core because you found a link.** Tom, 2026-09-20: core
development is starting again, and a direct link to core's tree during
development is how the two projects are worked on together — making core spend
a version number on every verify-fix-verify turn is not how that happens. An
earlier version of this paragraph said to treat a link as a fault to be fixed;
that is withdrawn and it was never the rule, only a badly compressed version
of the one below.

**The rule is a gate before `main`, not a ban.** Switch to a published version,
`npm install`, prove the link is gone with `test -L
node_modules/@machafoundation/core`, and run the suite against the registry
copy — then merge. A link is a development instrument and must never be what a
release resolves against; 0.17.2 nearly shipped a tag nobody could install
from. The full procedure is under "Core comes from npm" below.

**The cluster, as used on 2026-09-19.** `ramaroja.macha.network` answers and
fronts the cluster over https; `fi-1` (10.35.1.50) and `es-1` (10.34.1.50)
answer directly on 7438, on server **0.46.x**, which is the first version with
the seek contract and the per-node `playback` budgets. `macnessa` and
`inverbeg` were offline through 2026-09-17. Nothing measured against a partial
cluster should be quoted as current.

**Eight changes are on `develop` and none has been run against a node.** They
are listed with their commits and their unproven halves in `COMPLETED.md`
under 2026-09-20. Nothing is released and nothing is deployed: `fi-1` and
`es-1` are still on **0.17.1** from 2026-09-17, so they do not carry 0.17.2
either.

**The live run was taken on 2026-09-20 and it did not find what it went
looking for.** Full record with timings in
[2026-09-20-transcode-handover-live-run.md](2026-09-20-transcode-handover-live-run.md);
what it settled, in one place:

1. **The handover's two new exits still have not run.** A mid-playback mode
   switch is a *representation change*, not a handover — the client tears down
   and reattaches on the same element — so `handoverJoinLost()` and
   `handoverFallbackPositionMs()` were never reached. Reaching them needs a
   reap or a node failure under a playing transcode. The P0 stays open on
   exactly that.
2. **The mechanism behind the P0 is now measured, at the node.** fi-1 states
   `look_ahead_ms: 32000` (for generations created under its current
   configuration — see the run document on why a reload breaks that), so
   core's clamp is inert there and the lead is a
   flat 26 s; and fi-1 transcodes this title at **1.49x realtime**, so a 26 s
   lead needs ~53 s to close against a 25 s budget. The arithmetic is the
   fault, and it is the first account of "sometimes it works" that survives.
3. **A node holds one live playback session per bearer token, and creating a
   generation destroys the previous one** — confirmed in the server source at
   `src/playback.cpp:2236`. Two live generations of one media on one node are
   not obtainable, so a same-node handover cannot work at any lead time.
4. **The same run found a live 16 s blackout on the mode switch itself**, with
   its own P1 below. The viewer lost no position — but that was the failover
   building its generation at the arrival point, **not** this client's new
   fallback, which did not execute.
5. **The method notes held.** `document.hidden` was `false` in all 123 samples,
   and the capture was at `debug`. The tab had to be raised to the front first
   — backgrounded, the client reads as a failure to start while `hasFocus()`
   returns `true`.

**The deploy happened** — 0.17.2 is on all three nodes, see the top of this
section. **The next thing is the reap run**, and it is the only thing this
repo's open P0 waits on: `handoverJoinLost()` and `handoverFallbackPositionMs()`
have still never executed, and reaching them needs a reap or a node failure
under a *playing transcode*, not a mode switch. That run is also where core's
requested `source-reaped` triple — `runwayMs`, `leadTimeMs`, `lookAheadMs` —
gets captured. The RN session has already taken a reap on hardware and reports
it arrives there as a terminal error carrying its status
(`Response code: 404`), not as a stall; this client has not seen one.

**What needs Tom, and nothing else does.** A television needs him in front of
it. So does a deployment, and so does the decision below. The cluster itself
does not — the test account signs in from any browser.

**One decision is still open — P1 below.** The confirmed same-origin endpoint
is not persisted. Tom's view is that it should be, and the shape was not
settled before 0.16.0 went out, so the non-persisted form is what ships.

**The first P0 below is a business P0 and outranks the rest** — scope-ratio
titles play small in a black window, which is the quality of the product on the
titles people choose it for. 2026-09-16 settled where the black comes from: the
bars are burnt into the source, the client's fit is correct, and the fix is an
ingest/server one. [Evidence](2026-09-16-video-fit-mode.md).

**The relocation hold shipped with one live exercise behind it** — see the P1
below. It works, and the paths it has not run are named there rather than
assumed good.

**Rationalised 2026-09-20: five P0s, down from eight.** Each is a live or
recently-live playback correctness fault with a client half still open:

1. **Scope titles play small in a black window** — Tom's business P0, blocked
   on the server reporting an aperture; the client task is small and waits.
2. **A pause past the node's idle budget kills the session.** Both halves are
   now built — this repo's 404 policy and core's regenerate-in-place, shipped
   in core 0.14.0 and client 0.17.2 — and **neither has been watched live on a
   thirty-minute pause.** That is the only thing keeping it a P0.
3. **Seek misbehaviour.** The origin fix shipped and is verified on a resume;
   the `relocate` seek path and the per-track reading the server session is
   waiting on remain. The budgets adoption is done and is now its own P1.
4. **A transcode handover can never reach its join.** Measured live
   2026-09-20: 30 s of waiting on a join the replacement was losing ground to,
   then a 20 s rewind. Both client halves are built — the race is now decided
   rather than waited out, and the fallback attaches where the viewer actually
   is — and **neither has been watched live.** That is what keeps it a P0.
5. **Failover from an https page dies on an http node** — promoted in
   importance rather than tier: it is now **confirmed live in the deployed
   configuration**, since a page at `https://ramaroja.macha.network` discovers
   `http://10.35.1.50:7438` as a candidate. Core's, with a host-knowledge seam
   the client may need to offer.

Four former P0s were demoted with their reasons written in: Direct Play stuck
at `readyState` 0 (explained by tab occlusion, instrumented, twenty clean
visible attempts — P2), any-node failover (Phases 0–5 verified, what remains
is UAT — P1), the ready standby discarded 33 s early (fixed in core 0.6.1,
re-measure only — P1), and the artwork replication fault (the server's, watch
only — P2). Demoting is not dismissing: each says what would promote it back.

**Anything on a television needs Tom present.** The Samsung items below are
gated on the set being on.

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
`gbni-1`, `ramaroja` and `macnessa` all now report 0.47.0 and serve
`index-BGrNH6KR.js`. The skew is closed and was never exercised — no title was
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

## Core comes from npm, and the registry is the only resolution path

`@machafoundation/core` is `^0.14.0` from the registry, and 0.14.0 is what is
installed. **Read `package.json` rather than this line** — it has been wrong
twice, which is the failure mode the rest of this section is about. A clone and
an `npm install` are the whole setup, which is the point: this repo has to work
for someone who only downloaded it.

**It was a `file:` link again on 2026-09-18, and that is worth remembering.**
Core needed the seek contract in front of this client before publishing, and
the link was the instrument. It went into the 0.17.2 release commit, which
would have shipped a tag nobody could install from; the commit was amended back
to `^0.14.0` before that mattered. A link is a temporary measure inside one
session, never a state to develop in.

**Tom's ruling, 2026-09-20 — this supersedes the "no local link" rule that
stood here.** A direct link to core's tree during development is **fine**: the
projects have to work together, and making core spend a version number on
every verify-fix-verify turn is not how that happens.

**What is not negotiable is the gate before main.** Switch back to the
published npm version, test against *that*, and only then merge and push.
`main` has people looking at it and must work at all times. A link is a
development instrument; it must never be what a release resolves against.

Concretely, before any merge to `main`:

1. `package.json` back to a published `^x.y.z`, and `npm install` — not a
   lockfile edit.
2. `test -L node_modules/@machafoundation/core` must fail. It is the only
   check that cannot lie; a version string agrees while a stale link is still
   in place.
3. `npm run typecheck` and `npm test` green **against the registry copy**, not
   against the tree the link pointed at.
4. Then merge and push.

The 0.17.2 near-miss is why the gate is written out rather than assumed: the
link reached the release commit and would have shipped a tag nobody could
install from. `pretest` went with the earlier version of this rule —
`cd ../macha-ts && npm run dist:check` validated a tree we no longer compile
against, and a green check that means nothing is how a real one stops being
read.

**Vite caches the link.** `node_modules/.vite/deps` is pre-bundled and
swapping the symlink underneath does not invalidate it, so after any change of
resolution: `rm -rf node_modules/.vite` and start with `--force`, or you are
testing the copy you think you just replaced.

**When core needs eyes on something unreleased** it publishes a prerelease under
a dist-tag (`npm publish --tag next`) and this client installs
`@machafoundation/core@next`. Same install path, same tarball shape, `latest`
unmoved. Expect that rather than a `file:` path.

**A swap can silently not happen.** `npm install` reuses an existing link rather
than fetching the tarball, and a version check can agree while it does — the
local tree was also 0.11.1, so `require(...).version` said 0.11.1 with the
symlink still in place, and the suite passed. `test -L
node_modules/@machafoundation/core` is the only check that cannot lie. Reported
to the `Macha NPM Core` session for the phone and Android TV clients, who have
it worse: they are renaming `@macha/core`, so a stale link can survive under the
old key while the new one resolves from npm.

**[[built is not released]] still applies, differently.** It used to mean core's
last *build* was what you compiled against. It now means core's last *publish*
is: a change on core's `develop`, or even a git tag, is invisible here until it
reaches the registry and this client's range moves. Read core's published
versions, not its git log.

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

**Typecheck with `npm run typecheck`, not `npx tsc --noEmit`.** They are not the
same check: the script runs `tsconfig.app.json` and `tsconfig.node.json`, the
bare command runs `tsconfig.json`, and on 2026-09-21 the bare one passed while
the real gate found an unused import and a test calling a function with the
wrong argument type. A check pointed at the wrong project is the same hazard as
a test pointed at the wrong artefact.

The server is making a playback session a REST resource and moving streams
under it, breaking the contract deliberately with no dual-serve window. The
plan is the server's (`macha/TODO/2026-09-21-playback-sessions-as-a-resource-plan.md`),
agreed with Tom, and core is co-ordinating the client transition.

```
GET /api/v1/playback/sessions/{id}/stream/{token}/{generation}/{name}
GET /api/v1/playback/sessions/{id}/stream/{token}/direct
GET /api/v1/playback/stream/{id}/{token}/...            REMOVED OUTRIGHT
```

**For this client the route move is a no-op, and that is now asserted rather
than believed.** Nothing here composes a stream or segment path: the read-ahead
builds a *same-origin* proxy URL and carries the node's URL opaquely in
`?source=`, the worker only checks it parses as http(s), and the HLS preflight
resolves `new URL(uri, manifestUrl)` over URIs the node itself put in its
manifest. Two tests hold that property — one per side — and both were watched
going red against a deliberately rebuilt path. The fakes and fixtures were
moved to the post-change shape at the same time, so what the suite describes is
the wire a node will actually serve.

**What did need building is `410 generation_superseded`.** A 410 on a segment
never reaches core as a status: hls.js raises it and this client's classifier
sorts it first, where `500` is a hold, `404` is not-found, and everything else
fell to a network-degradation branch reported as `stream` — which core reads as
evidence against the endpoint. A healthy node answering correctly about a
replaced generation would have been condemned. Found here on 2026-09-21 and
folded into the server's plan, which now has this client in step 1 of its
sequencing beside core. Three sites carry it, all behind one predicate
(`isSourceGoneStatus`): the managed-HLS classifier, Direct Play's read-ahead
failure branch, and the native preflight, whose readiness now reports `gone` so
the Samsung path asks for a new generation instead of blaming the node.

Core maps 410 onto its existing `not-found` kind rather than adding a seventh,
deliberately — the required action is identical, and a new kind would put that
obligation behind a value existing hosts meet as `default`. This client follows
that, so a 410 reaches core as `not-found` and keeps the obligation not to tear
the presentation down.

- [x] **`SOURCE_SUPERSEDED_STATUS` comes from core, and this client is linked
      to core's tree to get it.** Tom's instruction, relayed 2026-09-21: *"we're
      nowhere near ready to publish npm"* and *"they should hotlink for now so
      we can actually test this works."* `@machafoundation/core` is
      `file:../macha-ts`. **Do not cut a release while linked** — `main` pins
      published versions, and core's tree carries symbols that exist in no
      published one. `npm view @machafoundation/core versions` still ends at
      0.14.0.
- [x] **The status mapping is core's, asked for rather than repeated.**
      `isSourceGoneStatus` now narrows hls.js's `unknown` and delegates to
      core's `playbackFailureKindForStatus`, so the next status core adds
      arrives here for free — which is exactly what did not happen when 410 was
      added and left this classifier condemning healthy nodes. Watched failing:
      pointing it at `'not-ready'` turns eight assertions red.
- [ ] **Identify the linked core by SHA, not by its version, because the tree
      moves under a fixed number by design.** Core is *building* `0.17.0`: a
      version is only immutable once it is published, so until then it is the
      name of the thing being built and work goes on accumulating under it.
      Tom, 2026-09-21: *"It's 0.17.0 because the rest of the world hasn't seen
      that yet."* `0.15.0` and `0.16.0` were waypoints from that morning and are
      not releases to pin. `0.17.0` is the number this client will eventually
      pin, and `npm view @machafoundation/core versions` ends at `0.14.0` until
      the work is proven on hardware.

      **A link resolves the working tree, not a commit**, so the identity has
      three parts and the middle one is easy to forget: what this client
      compiled against was core `5485db4`, clean, `dist` hash `f662293ec1c0`.
      Hash from *inside* `dist` — `shasum` includes the path it is given, so
      two runs from different directories disagree about identical bytes.
      Measured, not quoted: an hour earlier the same tree answered `0.17.0` on
      disk while its HEAD had committed something else, which is why the
      version is not the thing to write down. Re-measured every time core's `src`
      moved, because a linked client compiles at a moment of its own choosing:
      the bundle that is ready to deploy was built against core **`5aa3f6f`**,
      clean, `dist` `ffbe251b5294`, and verified in the *minified artefact*
      rather than in the source — `jj=410 ... "not-found"` for the status
      mapping, `standby-preparation-refused` for the cap, and `Fj=8e3` /
      `Vj=1e4` for the two standby windows, the second of which core cut from
      30 s to 10 s because 30 s was a server *default* while 10 s is the floor
      a node refuses to start below. A version number would have reported none
      of those three. Core has taken the same rule the other way — do not leave the tree
      dirty while anyone is linked, since a linked client compiles at a moment
      of its choosing rather than core's.

      **Re-measured 2026-09-21 18:15 after dropping the subclass: core
      `8db9d26`, `dist` `bb88949a916b`, bundle `index-Bv4GTP94.js`, 628,490
      bytes, `shasum` `8cdee13f3b21`.** The bundle name and size moved
      because the client changed, not only core: `prefer()` (core `8db9d26`)
      replaced `PinnedEndpointRegistry` here. Re-read in the minified bytes
      rather than assumed — `Nj=410` with `s===Tj||s===Nj?"not-found"` for
      the status mapping, `standby-preparation-refused` for the cap, and
      `Kj=1e4,Qj=8e3` for the two standby windows; no `playback/stream`
      string, `playback/sessions` present. Suite 433 green, typecheck clean.
      **This bundle is built but not deployed** — the nodes still serve
      `index-NDVfpduh.js` from 14:37.

      **`vite dev` does not notice that a linked core changed.** The
      production build resolves the link fresh every time, but the dev
      server pre-bundles `@machafoundation/core` into
      `node_modules/.vite/deps` and keeps serving that copy: the first live
      test of `prefer()` failed with `endpointRegistry.prefer is not a
      function` against a tree where the method plainly existed, and the
      built bundle was fine at the same moment. `npm run dev -- --force`, or
      delete `node_modules/.vite`, after core moves. Core recorded the same
      trap from its own side as *"a build system may not notice core changed
      at all"*.

      Core also carries `7b4548a` in this range: **a per-account cap refusal
      now walks the cluster and charges nobody**, because the cap is counted
      per node. `isAccountSessionLimit` is unchanged, so
      `accountSessionLimitNotice` still fires as before — fewer viewers will
      reach it.

      **Superseded, kept for the shape of the measurement: core `648474d`,
      `dist` `fb4b23dcffd5`, same bundle bytes.** Core moved 5aa3f6f → 648474d across
      three files; the only non-test one is comment-only in
      `PlaybackCoordinator.ts` (`git diff -U0` over it yields no changed line
      that is not a comment, and the floor still reads `10_000`), so
      minification strips the whole change and it cannot reach the artefact.
      Re-measured here rather than taken from core's word: suite 402/402,
      typecheck clean, `vite build` output `index-NDVfpduh.js` at 624,128
      bytes, `cmp` IDENTICAL to the 12:12 artefact, and the same four markers
      re-read in the minified bytes — `jj=410`, `a===Ej||a===jj?"not-found"`,
      `standby-preparation-refused`, `Vj=1e4,Fj=8e3` — with no
      `playback/stream` string and `playback/sessions` present. **So the
      deployable artefact has not changed since 12:12; only the core SHA
      beside it has.** The `dist` hash is `cd dist && find . -type f | sort |
      xargs shasum | shasum`, first twelve characters — written down because
      an unlabelled hash cannot be checked by the next session.

      **Three sessions, three correct hashes of one artefact**, which is why
      the command is part of the value rather than a footnote. Core
      reproduced `fb4b23dcffd5` from the same dist with the same command; the
      same command given an absolute path instead of `cd`-ing in yields
      `b780999efb68`, and scoped to `*.js` it yields `8c835ad33000`, which is
      what the phone session recorded for that dist at that SHA. All three
      are right under their own method and none is comparable to the others.
      This repo keeps the all-files method above, deliberately: it covers the
      `.d.ts` files, so a type-only change in core moves this hash where a
      JS-only one would not — and a type-only change is exactly the kind a
      linked client compiles against without noticing.
- [x] **The failure screen names the account when the cap refuses.**
      `accountSessionLimitNotice` leads the fatal-error block when core's
      `isAccountSessionLimit` recognises the refusal, with core's own message
      still beneath it because that is what a viewer would quote in a report.
      The match is core's rather than a code string matched here, since four
      clients matching it separately is how they drift. Three tests, seen red.
      **Unverifiable live until the server ships the cap**, and this client
      cannot produce a `429 account_session_limit` on demand — nobody should
      fake a 429 to watch it work.

      **It follows core's message rather than leading.** A cap refusal is the
      reason a *recovery* could not finish, not the thing that went wrong: core's
      head is the failure that started the recovery, which may be a node dying
      under the viewer, and leading with the cap would tell somebody their
      account is busy while their node is on fire. Corrected after it shipped
      the other way round — core's own reasoning said "the wrong thing to lead
      with" in the same breath as endorsing the order it was in, and the
      reasoning was right. The placement itself is not unit-covered: the notice
      is, the JSX order is not, and asserting it would need a rendering test
      this repo does not have.
- [ ] **Superseded, kept for the shape of the argument.** Core 0.17.0 exports `playbackFailureCode(error)`
      and `isAccountSessionLimit(error)`, which walk the cause chain cycle-safe.
      The cap answers `429 account_session_limit`. Nothing here misclassifies it
      today, but the sentence a viewer gets reads as a breakage when the node is
      working exactly as designed, and this client — unlike the television — has
      an address bar behind the failure screen, so a viewer told the truth has
      somewhere to go.
- [ ] **Use core's `playbackFailureStatus` in `signInComplaint`, and not
      today.** `LoginScreen.tsx` reads `.status` one level off `cause` to decide
      whether to say "that username and password were not recognised", so the
      moment anything wraps a `401` in something carrying no status of its own
      — which is what `endpointFailure()` does, and what cost the phone client a
      live bug in a branch that had never executed — a wrong password silently
      becomes a generic complaint. Core's accessor is the fix and its name is
      narrower than its behaviour: read rather than taken on trust, it is a
      cycle-safe walk of any error chain for a finite numeric `status`, with
      nothing playback-specific in it, and core has put that in the docblock so
      the name does not talk somebody into writing a third walk. **Held back
      because today's instruction was the session and stream routes and this is
      the auth path** — it is a one-line swap when it is wanted, and it wants
      a test that fails on a wrapped 401 first.
- [ ] **Two endpoints in this client's registry can be one node, which is why
      "strictly advancing" cannot be enforced from here.** The 2026-09-21 run
      held five endpoints: three node addresses configured by hand and two
      discovered cluster names. A generation created "on" `ramaroja` lands on
      whichever node haproxy fronts, so a cascade can return to a node it has
      already stranded a session on without the client being able to know it.
      That bears directly on a per-node cap being exhausted by a cascade, and it
      is the client half of the question the server asked.
- [ ] **The cap is `streaming.max_sessions_per_account`, 32 per node, zero
      disables** (server, 2026-09-21), comfortably above the twelve-in-
      disturbance case this repo's failover measurements produced. What to
      check after the cutover is not a refusal a viewer sees but
      `standby-preparation-refused` carrying `accountAtSessionLimit` **while
      nobody sees anything wrong** — the cap working as designed while seamless
      failover quietly gets worse, which is the only state here that produces
      no symptom at all.

      **The cap phase cannot run on the shipped config, and that is mechanical
      rather than bad luck.** `reserve_session_slot` (`macha/src/playback.cpp:
      1402-1410`) checks node-wide first — `streaming.max_sessions`, throwing
      `ResourceLimitError` → `429 resource_limit`, shared with both transcode
      limits — and only then the per-account cap four lines later. Shipped
      config is `max_sessions` 8 against `max_sessions_per_account` 32, so the
      node limit always refuses first and `account_session_limit` is
      unreachable on every live node. Raising `max_sessions` on all three
      nodes is a precondition for the phase existing, not a tuning step.
      Two further traps for reading a log: the account check sits inside
      `if (config.max_sessions_per_account)`, so unset or zero disables it
      **silently** — a node that never refuses looks exactly like a client
      handling the refusal correctly — and `too_many_sessions` /
      `try_later` on `/api/v1/session` are a different subsystem entirely
      (auth store full; password-check rate limiting), not this cap.
      Settled from the server source 2026-09-21 with the `Macha Mobile Phone
      Client` session, which caught the attribution wrong here first.
- [ ] **Nothing else is needed here for the per-account cap**, and that should
      be re-checked when the server lands the code. This client never creates a
      playback session — core does — and it classifies no create failure, so a
      `429 account_session_limit` arrives as core's message on the failure
      screen. The hazard this repo contributed evidence for is on the server's
      side: a session on a node that has just died cannot be DELETEd, so a cap
      counting those refuses the create a failover depends on. Measured here
      2026-09-21 (`session-stop-failed`, `failed-session-close-retry`) and
      recorded in the server's plan.
- [ ] **Adoption is not implemented and needs nothing yet.** This client never
      holds a session id — core does, keyed `${endpoint.id}::${nodeSessionId}` —
      so there is no bare id to pair with a node. If adoption ever reaches this
      client, the listing is node-local by decision, and an adopted id without
      its endpoint is unusable: core's `sessionAlive` throws on it.
- [ ] **Segmented subtitles are the one place this client still holds a server
      fact, and it is parked on purpose.** Tom, 2026-09-21: *"Tell the other
      clients and the core to ignore subtitle issues FOR NOW."* Everywhere else
      the rule holds: core resolves playback, `stream.url` and `subtitle_url`
      are taken whole, every judgement about a status is core's
      (`playbackFailureKindForStatus`, `isAccountSessionLimit`), and the only
      other `new URL(` in production code resolves a playlist URI against the
      URL the node served it from. The exception is the whole segmented
      subtitle path, and it is three things rather than one line:
      `WebPlatform.ts:1688` composes `segment-${index}.vtt` against the
      manifest URL, which invents a server filename; `SubtitleSegmentManifest`
      (`WebSubtitles.ts`) is a wire type core has never heard of — zero
      occurrences in `macha-ts`, which passes `subtitleUrl` through opaquely;
      and `isLegacyWebVtt`'s `.vtt` sniff is a wire fact in the same position.

      **Not avoidable as things stand, which is why it is written down rather
      than fixed.** The manifest carries `format`, `version`, `stream_index`
      and `segment_durations_ms` — durations only, no names and no URLs — so
      the convention has to live somewhere. The server builds it that way at
      `macha/src/playback.cpp:2031-2040` and *parses* the convention twenty
      lines later in `subtitle_segment_index` — `segment-` + digits + `.vtt`,
      playback.cpp:2042-2051 — with its own tests hand-building
      `segment-0.vtt`. So it is a server fact the server only ever parses and
      never states, and this client is the only place on the other side of the
      wire that writes it down.

      **Two ways out, both above this repo.** The server puts segment names or
      URLs in the manifest — cheap, since the durations vector is in hand at
      the moment the manifest is built — or core takes the manifest type and
      the URL builder, so there is one declaration and the clients import it.

      **Why it can wait, measured in the other trees rather than assumed.**
      There is exactly one copy of the composition and the manifest type:
      both RN sessions searched their own repos on 2026-09-21 and neither has
      a segmented subtitle path at all — the phone has track selection only
      (`PlaybackOptionsSheet.tsx`), and the TV side-loads a single
      `subtitleUrl` into media3 (`PlayerEngine.kt:195-212`) without building a
      URL. The cost arrives the day a second copy grows, because two private
      copies of an unstated convention can disagree. **The `.vtt` sniff is
      already at two**, though: the TV derives the mime type from the
      extension at `PlayerEngine.kt:296` the way `isLegacyWebVtt` does here.
      That one is cheap to reconcile and is not what makes this urgent. Until
      then this is a known hole, not a live fault. Found by the `Macha Client
      Core` session sweeping the clients against Tom's rule that no client
      composes a path it can avoid.

- [ ] **Smoke test of the deployed build, 2026-09-21 14:45-15:20, sixteen
      titles against the live cluster.** Driven through the UI in Chrome
      against `vite dev` (same develop tree as the deployed bundle, `/api`
      proxied to `gbni-1`), signed in as `webclient`. Every title was played,
      seeked, rewound, paused, resumed and stopped; eleven of them with
      **large** seeks — dragging the scrubber to ~75% and back to ~20% of the
      title, not arrow-key nudges. All three modes covered, with the mode read
      off the player's own plan overlay rather than inferred:
      - **Direct** (`DIRECT · H264/HEVC` + `DIRECT · AAC`): six titles,
        including a 3-minute short and an MP3 music track. Big seeks settle in
        0.4-12 s.
      - **Remux** (`VIDEO COPY` + `AUDIO TRANSCODE`, the AC-3/E-AC-3 titles):
        six titles, two of them TV episodes. Big seeks settle in 2-19 s.
      - **Transcode** (`VIDEO TRANSCODE · SOURCE · H264 → H264`): forced from
        the player's MODE selector, since nothing in this library needs it —
        Chrome decodes both H.264 and HEVC here. Big seeks 14.8 s forward,
        18.8 s back.

      **Three things worth chasing, none of them a regression in this build.**
      1. A big seek on a remux stream sometimes fails its first generation:
         `seek-needs-generation` → `http-error-response` →
         `generation-update-failed`, surfaced to the viewer as *"Macha endpoint
         http://10.35.1.50:7438 failed: ... timed out waiting for first
         fragmented-MP4 segment"*. Seen twice. Both times the next seek
         succeeded, and on one occasion the client recovered by itself —
         `source-terminal-failure` → `source-failover-start` →
         `failed-session-closed` → `source-failover-ready` — which is the
         failover path doing its job on the seek path.
      2. **`max_video_transcodes` is 1 on every node.** Asking a session that
         already holds the slot to switch to Transcode answers
         `429 resource_limit` ("video transcode limit reached"), the player
         shows the refusal, and the mode the viewer asked for is silently not
         applied — no walk to a node that could serve it. A fresh session gets
         the slot and transcodes first time. Node-scoped refusal, so walking
         would be correct here.
      3. ~~The seek UI commits on pointer release only.~~ **Fixed the same
         day.** A focused scrubber moved its thumb on every arrow and page
         key — the browser's own range behaviour, arriving as a new preview
         position — while the commit fired only for a television's seek keys
         or Home/End, so the playhead drew in the new place and playback
         carried on where it was until focus left and `onBlur` committed it.
         Measured before: five `PageUp` presses moved the scrubber to 50% of a
         two-hour film and left the position at 59 s. `committingScrubberKey`
         now names every key a range input moves itself on; watched failing
         against the old list first, and re-measured live afterwards — five
         presses from 22:07 landed at 1:39:27, playing.

      **And a correction to the cap numbers this repo was given.** All three
      nodes read `streaming.max_sessions: 64`, `max_sessions_per_account: 32`,
      `max_video_transcodes: 1`, `max_audio_transcodes: 4`, so the per-account
      cap is reachable here and the cap phase is not blocked on a raise for
      these nodes. Read off each node's deployed `/etc/macha/macha.yaml`, not
      the example — `corvus-fi-1` 5262 bytes md5 `9e8e7ffcf38e` lines 181-184,
      `corvus-es-1` 6749 bytes `0ddf30935716` lines 235-238, `corvus-gbni-1`
      6476 bytes `4e6606a93029` lines 232-235, all uncommented. Worth the
      three hashes: the example carries the identical four values, es-1 and
      gbni-1 each keep a `macha.yaml.example` beside the real file, and the
      `Macha Client Core` session was right to ask which one had been read.
      All three configs were written at the same instant, 11:34 UTC that day,
      with each service entering active state two minutes later, so the
      running server holds these numbers. **The 8-against-32 contradiction is
      real but lives in the compiled defaults** — `config.hpp:502`
      `max_sessions{8}` against `:540` `max_sessions_per_account{32}` — and
      bites only a node that does not set the value. The example sets it, and
      says at 597-599 why.

- [ ] **A viewer can choose the node, and it works by starting a new
      generation there rather than moving the old one.** Tom, 2026-09-21:
      *"there's no reason we can't get a new session, and stream, at the same
      time index and play it."* Pills in the player's options panel, right-hand
      area, one per node, the serving node highlighted: `PlayerOptions` renders
      `playerNodeChoices`, `PlayerScreen.selectNode` pins the choice and calls
      `runtime.play({media, startPositionMs: current})`, which closes the old
      generation first so the node being left is not holding a transcode slot.
      Measured live: 2:11.795 on `fi-1` to 2:12.197 on `gbni-1`, **13.2 s of
      gap**.

      **The pin is an ordering preference, never a health record.**
      `PinnedEndpointRegistry` promotes the chosen node's endpoints in
      `candidates()` and touches nothing else. The obvious alternative,
      core's `recordSuccess(id)`, sets the sticky preference *and* writes a
      successful round trip that never happened, dating a success onto the
      Status screen. The pin is also skipped while the chosen endpoint is not
      `ready`, so failover still walks away from a node that is failing.

      **Grouped by `nodeId`, sorted by name.** One node is commonly two
      entries — a LAN address and an advertised name — and core stamps
      identity from `api_endpoint` only, so the LAN entry stays *Unidentified
      node* and the same machine appears twice. `useNodeIdentity` advertises
      each node's `host:port` alongside its `api_endpoint`, restricted to URLs
      the registry already holds so nothing invents a discovered endpoint.
      Order is numeric-aware by label, tie-broken on id, because the
      registry's own order is a live ranking that re-arranges under a pointer
      on the way to a click. Dozens of nodes wrap into justified rows that
      scroll inside their own area; the panel itself never scrolls.

      **Three pieces of this are stopgaps with a named retirement, not
      permanent client code.** Core replied on 2026-09-21 and is taking all
      three:
      - ~~`EndpointRegistry.prefer(id)`~~ **landed and the subclass is
        gone**, same day. Core `8db9d26` carries it — sticky endpoint,
        notifies, writes no health, ignores an unknown id, and still ranks
        availability above preference — so `PinnedEndpointRegistry` and its
        skip-if-not-ready guard were deleted rather than kept in parallel.
        What remains on this side is `preferredEndpointForNode`, which exists
        only because a viewer picks a *node* and `prefer()` names an
        *endpoint*: it states the preference against a ready door onto that
        node, falling back to the first so a choice still registers while the
        node is cooling.
      - `moveTo` is next in core's current phase, and the shape is settled by
        the server: **a session is permanently bound to the node that created
        it** — the session map is in-process and node-local, with no
        replication and no control-call forwarding — so a move can only be
        create-there, promote, release-here. That is `prepareAlternate` plus
        promotion, entered deliberately rather than only on failure. The
        13.2 s gap measured here is the cost of close-then-start, not
        anything the server imposes: **the account cap is counted per node**,
        so acquiring the new session before releasing the old one costs
        nothing against it. When `moveTo` lands, `selectNode` should call it
        and the `runtime.play()` restart goes.
      - Node identity belongs in `EndpointHealthMonitor`, where
        `apiBaseUrls: [node.api_endpoint!]` is built single-element; core has
        it as phase 2. `useNodeIdentity` retires then. The restriction to
        URLs the registry already holds is what makes it safe either side —
        it invents nothing, so it threads the fail-closed reasoning about
        nodes deliberately behind TLS rather than overriding it.

- [ ] **A mode press never asks a node to copy audio this device cannot
      decode.** `MODE_TRANSFORMS` had `remux: {video: copy, audio: copy}`,
      unconditional, so pressing Remux on an AC-3 title asked the node to
      copy audio this browser has no decoder for. Two endings, both measured
      2026-09-21 against `fi-1`: the node produced no first fragment —
      `readyState` 0, position 0, six `hls-error-nonfatal` over ~35 s then
      two `hls-error-fatal` at 59 s — and, had it served, a silent film. The
      mobile client had written the same table independently
      (`transformFor(mode)`) and hit it the same afternoon; the television
      reproduced the symptom too.

      **The server defined the fix by refusing the obvious one.** Asked for
      `mode=remux` with `audio=transcode` it answers *"remux repackages and
      copies every stream: to re-encode one, ask for mode=transcode with
      video=copy or audio=copy for the stream that is being copied"*. So a
      remux press that cannot copy the audio becomes
      **`mode=transcode, video=copy, audio=transcode`** — the same plan the
      server's own chooser produces for these titles, and the one the press
      was throwing away. `modeRequest` decides it from
      `hlsAudioCodecs ?? audioCodecs`, because remux is delivered as fMP4 and
      the delivery decoder is not always the element's; an unknown codec or
      absent capabilities transcode rather than gamble. Re-measured live on
      the title that stalled: the press now keeps playing, `VIDEO COPY` plus
      `AUDIO TRANSCODE`.

      **This rule is core's, for the automatic path only.**
      `choosePlaybackInstruction.ts:399-401` already decides exactly this,
      with core's own docblock saying it "is not something each client should
      reinvent, so it lives here" — but a viewer pressing a mode *by name*
      has no entry point into it, which is why this client and the phone
      wrote the same table independently and hit the same bug on the same
      afternoon. Core has the gap on its list with both bugs as evidence.
      `modeRequest` delegates the day there is something to delegate to; the
      capability lookup is the part that should not be here.

      **What is the server's, and deliberately not recorded here:** why an
      AC-3 copy stalls at all. A mechanism was relayed and then retracted —
      `delay_moov` turns out to be documented as the *fix* for this class of
      503, measured on 2026-09-07 — so the cause is open and this repo should
      not carry a guess at it — and the mux path has since been cleared by
      experiment, so it is not that either. Two facts of ours that survive
      whatever it turns out to be: AAC audio-copy remux succeeds on the same node in the
      same minutes, and **the same client request produced a declined copy
      once and a true copy minutes later**, so the difference is inside the
      node rather than in what was asked.

- [x] **Withdrawn: the "direct-play stall" was my own instrumentation.**
      Recorded because the retraction is worth more than the claim was. While
      running the server's orphan reproduction I saw direct play sit at
      `readyState` 0 for minutes and reported, in order: that the element was
      not on the proxy URL (wrong — I grepped for `macha-direct-read-ahead`
      when the path is `__macha_direct_cache__`), and then that the Service
      Worker never answers an open-ended range (wrong — my probe awaited
      `arrayBuffer()` on a 1.76 GB body, so it was my own read that never
      finished).

      Measured properly afterwards, on the same title and node: the worker
      answers `bytes=0-` in **46 ms** with `206` and
      `content-range: bytes 0-1763346940/1763346941`, and a tail range in
      **53 ms**. A clean page load reaches `loadedmetadata` in **801 ms** and
      playing in **1.0 s**. There is no reproducible fault here. The stalls
      were real but produced by the state I had made: a force-stopped tab, a
      Service Worker I had unregistered and re-registered three times, and
      1.7 GB streaming probes competing with the element for the same link.

      **The lesson is the entry.** Both wrong claims were inferences from a
      black player dressed as measurements, and both were sent to other
      sessions who acted on them. A stalled player is a symptom; the first
      question is what the element is actually fetching and how the thing
      serving it answers, asked with a probe that does not itself consume
      the link. The server session recorded the mirror image of this in its
      own backlog the same evening: four mechanisms written for the AC-3
      stall, every one killed by measurement. Theirs were about a server and
      mine were about a client, and the failure was identical.

- [ ] **Unexplained: a player that sits at `readyState` 0 while the node
      says it served.** Seen three times on 2026-09-21, on both playback
      paths, and it is the one live symptom nothing has accounted for. The
      two client-side explanations offered for it — the element not being on
      the proxy URL, and the worker not answering an open-ended range — were
      both measured and both wrong, so this entry deliberately states the
      shape and no cause.

      **What is known, from both sides.** Transformed path: es-1 logged
      `first fragment ready` at 247 ms and 208 ms for a session whose element
      never left `readyState` 0, with a `blob:` source and nothing buffered
      three minutes on. Direct path: the same title that had loaded metadata
      in 801 ms an hour earlier sat at `readyState` 0 with `networkState` 2,
      while the read-ahead worker answered `bytes=0-65535` from that
      element's own `currentSrc` in **50 ms** with a `206` and 1,448 bytes of
      body. So in both cases the bytes were available and something between
      the source and the decoder did not consume them.

      **It is intermittent and correlates with a session-heavy run**, which
      is the part that makes it hard: a cold page plays the same title in a
      second. Next step is to watch it from the client with `hls.js` error
      detail flattened to text and the element's own event sequence recorded
      from before `src` is set — not to theorise from a black player, which
      has now cost three wrong answers in one day.

- [ ] **Diagnostic timestamps are Zulu, because the cluster spans
      timezones.** Tom, 2026-09-21: *"Macha absolutely needs to handle
      multiple timezones across sites. They WILL be in different timezones.
      We should be using hard Zulu, UTC."* Tonight the three nodes ran EEST,
      CEST and BST, and a session timeline handed to the server session was
      an hour out because this machine matched one node's zone and was read
      against another's. Nobody was confused for long, which is the danger:
      the error is silent, plausible and survives review.

      **The rule, in his refinement of it: present in local, deal in UTC
      everywhere else — timezones are a presentation problem.** So
      `src/diagnostics/timestamps.ts` has two forms and they are not
      interchangeable. `presentedTime` is what a screen shows: the reader's
      own zone, **labelled with it** (`21 Sep 2026, 18:51:52 GMT+3`), because
      an unlabelled hour read beside a journal written in another zone is the
      exact ambiguity that cost the hour. `zuluTimestamp` is the interchange
      form, `2026-09-21 15:51:52Z`, for anything leaving this client for
      another machine or another person's terminal. Zero and absent are `—`
      rather than 1970 in both.

      My first pass put Zulu on the screens as well and Tom corrected it: a
      viewer should not have to convert their own clock to read when a node
      was last seen. The zone label is what makes local safe; UTC is what
      makes correlation safe.

      **The rest is not this repo's to fix and is raised with the other
      sessions.** Server logs print node-local time with no offset, which is
      what actually cost the hour; the API's `*_unix_ms` fields are already
      unambiguous and are the reason this fix was cheap here.

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

## P0 — A pause past the node's idle budget kills the session, and the resume never checks

Reproduced live and verbatim 2026-09-17:
[a paused session is reaped](2026-09-17-paused-session-reaped.md).

**A measurement is coming from the Android TV RN client, 2026-09-19.** That
session has implemented the same park-and-reclassify policy against
`expo-video`, and a long pause is ordinary on a television rather than an edge
case, so it will provoke this before a desktop can. Two things it has
undertaken to report: whether its re-attach blank is visible at ten feet, and
what `session_idle` does to a set actually left paused, and after how long.
Record whatever arrives as measured **on that platform**, not restated as ours
— its player cannot keep the buffer and frame through a park, because a player
in its error state will not resume, so the two clients differ at exactly the
moment the viewer is looking at the screen.

Two things went the other way in the same exchange and are worth keeping. The
404 policy — `isHlsSourceNotFound`, `fail-not-found` and the Direct Play
`notFoundSourceGeneration` latch — shipped in **0.17.2 and is not deployed**,
so anyone comparing against a live web client is comparing against 0.17.1,
which still condemns the node on a 404. And "no spinner on parked resume" is
asserted from this repo's code and has never been watched on a screen.

Pause for thirty minutes or more and press play: the buffer plays out, then
`Macha endpoint http://10.35.1.50:7438 failed: Failed to fetch`.

`streaming.session_idle_ms` is **1800000 — thirty minutes exactly**, and `fi-1`
runs the default. The reaper's clock runs from `touched`, which only a request
refreshes; a paused client fills its bounded forward buffer, stops asking, and
from then on the clock runs unopposed. **A pause longer than the budget is a
certainty, not a risk.** A reaped session answers `404 not_found` on both the
session and the stream routes.

Nothing between the pause and the resume asks the node whether the session is
still there. `resume()` restarts the parked load and asks the element to play;
the 404s are retried blind for 62 s, the one permitted hls.js network recovery
is spent on them, and the node is then failed over for having answered
honestly — onto the unreachable http LAN address, which is the name the viewer
is shown. Measured: the session was on `es-1`; the screen blamed `fi-1`.

**There is more cover than the symptom suggests.** Instrumented, the first 404
reaches the degradation channel **3.7 s before the viewer presses play** — hls.js
meets the reaped session while topping up its buffer — on top of 62.8 s of
buffer. Core is already told, on the right channel, at the right moment; it
answers `alternate-preparation-start`, a standby on another node, purely because
the kind says `'stream'`. Recovering inside that window is invisible to the
viewer.

Split with the `Macha Client Core` session 2026-09-17; it owns the core half and
has confirmed the chain in its own source. Core's sharper statement of it:
**core has no "regenerate here" verb** — every terminal source error has one
exit, and that exit starts by condemning the node.

- [x] **Core: a failure kind for "this source is gone"**, not endpoint-retryable,
      with a regenerate-in-place path. **Shipped in core 0.14.0 and verified in
      the installed package 2026-09-19:** `degrade()` tests
      `isMissingSourceFailure` (`kind === 'not-found'`) *before* the
      endpoint-evidence guard and calls `beginMissingSessionRecovery(error,
      false)` with the source still playing, "deliberately not gated on paused
      state". `isEndpointRetryablePlaybackFailure` excludes `not-found`. This
      client's Direct Play worker and HLS policy both already emit into it.
      **Not yet watched live:** a pause past thirty minutes recovering without a
      failure screen, against 0.14.0. That is the only thing keeping this a P0.
- [x] **This repo, policy layer.** `SOURCE_NOT_FOUND_STATUS` and
      `isHlsSourceNotFound` beside `isHlsSegmentHold` in `WebHlsPolicy.ts`, the
      404 excluded from `isHlsNetworkDegradation`, and a `fail-not-found` action
      that spends no network restart. Tests seen red first — including the
      inversion of an existing assertion that a 404 *is* degradation evidence.
      Named for what the node said, not what it means: the adapter cannot tell a
      reaped session from a fragment past the end of the plan, and must not
      pretend to.
- [x] **This repo, the wiring — written and proven live.** `WebPlatform` reports
      a 404 as `'not-found'` on both channels, on its own degradation latch so an
      earlier transient error cannot swallow it. Verified against a linked core
      at `ce8b596`: regenerates on the same node, keeps the position, charges
      nothing against the endpoint, never goes near a failover. Evidence in the
      document above.
- [x] **Gate cleared: `@machafoundation/core@0.13.0` is published and installed.**
      The tree builds again for the first time since `cc85216` — typecheck clean,
      **360/360 green**, from a real `node_modules` directory and not a link.
      Verified through the module system before trusting it:
      `playbackFailureKindForStatus(404) === 'not-found'` (500 `not-ready`, 503
      `stream`), `SOURCE_NOT_FOUND_STATUS` 404, `SEGMENT_NOT_READY_STATUS` 500,
      `BROKEN_GENERATION_STATUS` 503, `SERVER_STARTUP_TIMEOUT_MS` 15000, and
      `isEndpointRetryablePlaybackFailure` false for the new kind. The local
      `SERVER_STARTUP_TIMEOUT_MS` copy is deleted and imported from core.
      **Install trap:** npm's local metadata cache can answer `ETARGET — no
      matching version found` for a version that is demonstrably on the registry
      over HTTP. `--prefer-online`, or `npm cache clean --force`. Same shape as
      the Vite `node_modules/.vite` trap, one layer down.
- [x] **`fail-not-found` reports without tearing down.** `reportSourceGone`, own
      latch, wired to three sites: the hls fatal, the Direct Play element error
      when the worker already reported the source gone for that generation, and
      the stall once the buffer runs out. Seen red against real core by removing
      the element-error branch, not merely red against an absent constant —
      which is what the first red actually was, and would have passed for
      evidence.
      **This removes the only thing in this client that ends a dead playback.**
      Core has taken that obligation and proved it is code: `failTerminal` sets
      the snapshot's fatal error and the runtime stops the player. The stall
      report is the *trigger* for core to build, not a backstop; core carries its
      own deadline bounded by the viewer's remaining media.
- [x] **This repo, the Direct Play half — the same fault, a different exit.**
      The worker's `retryableSourceStatus` is `408 || 425 || 429 || >= 500`, so a
      404 fell through to the success path and the media element was handed the
      error envelope as though it were media. It raised a generic `MediaError`,
      which maps to `unsupported`/`media` and never `not-found`, so Direct Play
      would still have failed terminally after core ships. The worker now
      reports the failure with its status; the response travels exactly as
      before, because not splicing an alternate over a 404 is a deliberate older
      invariant and its test caught an early version of this that broke it.
      **This is the path the original report's episode actually takes** in
      Chrome on macOS, so a quiet release would have looked fine.
- [ ] **The deferral works and makes the stall worse. Tested 2026-09-17 against
      core `73abbdc`.** A swap finally happened — `replacement-held` ->
      `source-failure-superseded-by-replacement` -> `replacement-swapped-in`, no
      failover, no release-unused — and the viewer's picture froze for
      **12,749 ms**, measured by sampling the element every 250 ms, against the
      **5.16 s** baseline it was meant to remove.
      **A held generation produces nothing while it is held.** Inside the stall:
      manifest 0.55 s, then 2.7 s to the first fragment request, then **9.0 s
      waiting on that one fragment**. The node starts producing on the first
      stream request, and holding the replacement is exactly the decision not to
      make one — so the session sat 28 s having produced nothing and the swap
      paid the full cold start anyway. The floor cannot fix it: `media-emptied`
      fires at the swap whatever the runway is, so the remaining 61.5 s was
      discarded and then the viewer waited for a pipeline nobody had started.
      Either core warms the replacement (spend the runway making the request
      that starts production) or it goes back to activating at once and accepts
      5.16 s. Raised with core; two data points, one per arm, so worth repeating
      the baseline arm on the same build before anyone commits to a shape.
      This also answers the look-ahead question: a generation created and left
      alone has not produced ahead, it has not produced at all.
- [x] **Preflight budget raised from 5 s to 25 s, derived.** A standby is a
      freshly created transcode generation and the server's pipeline is lazy —
      the preflight's own request is what starts production, then waits for it.
      Measured 9.0 s for that first fragment; the node's own
      `startup_timeout_ms` is **15 s**, read off `es-1`. So a 5 s gate had been
      recording healthy-but-starting nodes as unable to serve, and core's
      `prepareAlternate` discarded and closed the session on that `false` —
      silently, and worst on the cold, busy or distant nodes a standby exists
      for. Now `SERVER_STARTUP_TIMEOUT_MS + SERVER_SEGMENT_HOLD_MS + 4_000`,
      written as the sum it has to exceed rather than a number picked alone.
      Both tests seen red at 5 s first. Core still has to widen
      `ALTERNATE_TRANSCODE_RECOVERY_WINDOW_MS` (8 s) or a standby that now
      passes is still discarded before a cold pipeline could be useful.
- [x] **The pipeline is NOT lazy. Measured 2026-09-17, premise withdrawn.**
      `POST /playback/sessions` calls `start_pipeline` and blocks on the first
      fragment before answering 201 — the node's own journal for trace
      `c04cacfb`: `first fragment ready elapsed_ms=1924 segments=1`, then
      `session create complete elapsed_ms=1924`. Client side: create then
      segment 0 immediately is **0.30 s** with no seek, **0.64 s** with
      `seek_ms=434000`; and after holding a generation **28 s untouched**,
      segments 0/5/8/9 all come back in ~0.6 s. A held generation is warm and
      stays warm. "Holding bought no warmth" was wrong and core had already
      built on it — corrected there.
- [ ] **What actually costs the 9.0 s: the look-ahead does not follow the
      viewer.** Production parks at `highest_requested + max_ahead_segments`, so
      warming segment 0 buys 0..8 and no more. Same held generation:
      `segment-000012` -> **500 after 6.27 s**, `segment-000014` -> **500 after
      7.59 s**, with the node logging `stream refused ... reason=hold_timed_out`
      for both. A replacement held 28 s has the viewer arriving past the
      frontier, and the node produces forward to reach them at roughly realtime.
      **`REPLACEMENT_LEAD_TIME_MS` (30 s) must be compared against the
      look-ahead**, which on `es-1` is `max_ahead_segments: 8` ×
      `segment_duration_ms: 4000` = 32 s. Two seconds of margin, and on a node
      with `max_ahead_segments: 4` the reshape reproduces the bug it fixes.
      Neither field is on the play session payload; asked the server session
      for a `look_ahead_ms` rather than hardcoding 8 and 4000.
- [x] **`stream.look_ahead_ms` shipped in server 0.45.0 and is verified live.**
      Confirmed end to end by this session on both nodes, because the server
      session had no credentials to check its own release: `es-1` and `fi-1`
      both report 0.45.0; a transcode session returns **32000** on each; it
      survives a `PATCH {"seek_ms":...}` (generation 2, still 32000); and a
      direct session returns **`null` with the key present**, so
      `'look_ahead_ms' in stream` is true.
      **Three states, and they are not interchangeable:** absent means a node
      too old to say, `null` means direct play with no pipeline and nothing to
      bound, a number is the answer. Zero would have read as "no look-ahead",
      which is why the server chose null.
      **It is a distance from `highest_requested`, not from the start of the
      generation.** For a freshly created generation `highest_requested` is 0,
      so the two readings agree perfectly — right up until anything requests a
      later index, which is when the conflation would bite. The coincidence is
      strongest exactly where a client is most likely to make the mistake.
      **Read it per session, never cached against an endpoint.** It is
      serialised from the live config, so an operator reload can change it
      mid-session with no `PATCH` to announce it.
      The 32000 matches what was measured before the field existed — segments
      0/5/8/9 in ~0.6 s, segment 12 refused after 6.27 s — so eight four-second
      fragments, arrived at from both directions.
      **The field would not have prevented our 12.7 s freeze**, and the server's
      changelog has been corrected to say so. `es-1` sets 8 and 4000 explicitly,
      so the constant we would have hardcoded was right and the frontier really
      was 32 s wide; the freeze was holding a generation 28 s and the viewer
      then arriving past a correctly-read frontier. The field fixes the general
      case — a differently configured node — which is a different bug from the
      one we had.
- [ ] **Do not "walk the frontier" — production is sequential.**
      `note_requested` raises `highest_requested` with `std::max`, but that moves
      only the *permission* boundary; the producer still appends strictly in
      order. Asking for index 20 authorises production to 28 and then makes you
      wait while 10..19 encode at roughly realtime. Walking one index at a time
      costs the same wall clock as jumping. The 6.27 s and 7.59 s above were
      that encoding, not a lookup. **The rule instead:** a fresh generation
      seeked to the arrival point beats making an existing one encode its way
      there — **1.92 s** cold start against **~9 s** of catch-up over a 28 s gap.
      (Corrected 2026-09-17 after telling core the opposite; second wrong
      instruction sent on this, both withdrawn before anything was built.)
- [x] **Bound the lead by the look-ahead and warming becomes unnecessary.
      Done in core 0.14.0.** `replacementLeadTimeMs(lookAheadMs,
      attemptBudgetMs)` clamps the lead to `min(REPLACEMENT_LEAD_TIME_MS,
      lookAheadMs - LOOK_AHEAD_MARGIN_MS)` and floors it at the attempt budget,
      so a replacement is neither created past the frontier nor started with
      less time than one attempt needs. The reasoning that got there: the viewer
      arrives at generation-local `L`; if `L <= lookAheadMs - margin` they land
      inside permission and there is nothing to warm, and if `L` exceeds it
      warming cannot fix it either because permission caps production. Not yet
      watched live on a reap.
- [ ] **Segment duration is already on the wire; only the count is not.**
      `#EXT-X-TARGETDURATION` and per-fragment `#EXTINF`, plan complete from the
      first fetch (`#EXT-X-ENDLIST`). Do not multiply a count by a duration, and
      note the **first fragment of a transcode generation is 2 s by design**,
      not the configured duration — read the real values.
- [ ] **Write `hold_timed_out` down as a contract, not an observation.** 500
      `segment_not_ready`, `Retry-After: 1`, `Cache-Control: no-store`, and
      never a 404 — the playlist has already promised the object exists and a
      404 would invite an intermediary to cache the absence. "Held then refused"
      means the encoder did not reach that index inside the hold window, not
      that the fragment is missing; retrying is correct and succeeds as
      production advances. It is the one 5xx that must not read as node
      ill-health, and it belongs beside `SEGMENT_NOT_READY_STATUS`.
- [x] **`warmSource` — superseded, not built.** Once the lead is bounded by
      the look-ahead (above), a replacement created at lead `L` lands inside
      permission and there is nothing to warm; and if `L` exceeds the frontier,
      warming cannot help because permission caps production regardless. Core
      did not add it. If a longer lead is ever wanted deliberately, raising
      permission early is the one job it would have, and it should be argued
      for then rather than kept warm here.
- [ ] **Preflight's failure vocabulary is still thin.** Timeout, 404, empty body
      and not-applicable all return the same bare `false`. Core does not need
      causes today; the standby path is the one place "not ready yet" and
      "refused" genuinely differ, and that is the argument for it whenever it is
      worth making. Note `!source.isManifest` returns a bare `false` too, so
      Direct Play reads as *refused* before any request is made — harmless while
      nothing gates on it, wrong the moment something does.
- [ ] **`runway-spent` is still unexercised, and may be unreachable here.**
      hls.js gives up ~28 s after the hold; `maxBufferLength` is 60. Any pause
      long enough to fill the buffer leaves more runway than hls.js has
      patience, so the fatal always wins while this adapter escalates it. That
      raises the stakes on the teardown change below rather than lowering them.

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

      **Not covered:** the `relocate` seek path. A synthetic scrubber commit did
      not start a negotiation, and it was not worth fighting the UI for — a seek
      reaches the same branch by the same call site, so this is confirmatory
      rather than new. Worth doing by hand next time the player is open.

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
      same class of fault as [the fractional milliseconds] this client was
      found committing in the other direction.

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
- [ ] Adopt `PlaybackSource.budgets` — **moved to its own P1** ("Adopt
      `PlaybackSource.budgets`: three call sites, one change"), since it is the
      named next thing and was invisible buried here.

## P0 — A transcode handover can never reach its join, waits 25 s, then rewinds the viewer

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
catch-up"*, recorded under the pause P0. Nobody had connected it to the
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
      deliberately **not** derived from `budgets.segmentHoldMs`, per the note
      under the budgets P1: that figure shapes retries and does not bound them.
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
- [ ] **Watched behaving correctly on 2026-09-21 — and not reachable by any
      path this client now takes.** Both exits fired live, which is what this
      item asked for, but reaching them needed three changes that were reverted
      the same evening as over-fitted (a runway-based escalation budget measured
      once, on one node, with one title). So the behaviour is proven and the
      route to it is not: on a node death as the client stands, the stall budget
      expires first and the relocation hold carries the picture instead. What
      was seen, with numbers: Killing the serving
      node under a playing transcode reached them:
      `handover-abandoned reason=join-receding-faster-than-it-fills` at ~6 s
      (deficit 2,151 -> 4,256 ms over 6,049 ms; and again 921 -> 3,027 over
      6,053) instead of waiting out the 25 s budget, with
      `handoverFallbackPositionMs()` placing the viewer where they actually
      were. Reaching them needed three changes first — the failure has to be
      reported while runway remains, the element must keep playing through it,
      and a recovery relocation has to be offered the seamless path — all
      recorded in
      [2026-09-21-failover-and-mode-switch-live-run.md](2026-09-21-failover-and-mode-switch-live-run.md).
      **The handover is still abandoned every time**, because the replacement
      cannot fill faster than the join recedes on a node transcoding from
      scratch; that is core's placement and the server's production rate. What
      this repo owns is now watched and correct — and unexercised again.
- [ ] **Superseded, kept for the record — what 2026-09-20 said.** A mid-playback
      mode switch does **not** take this path: it is a representation change,
      handled by teardown and reattach on the same element, so neither
      `handoverJoinLost()` nor `handoverFallbackPositionMs()` executes. The run
      is recorded in
      [2026-09-20-transcode-handover-live-run.md](2026-09-20-transcode-handover-live-run.md).
      What would prove it is unchanged — `handover-abandoned
      reason=join-receding-faster-than-it-fills` at about 6 s rather than
      `join-never-buffered` at 25 s, and a `resumeAtMs` within a second or two
      of the live position — but **reaching it needs a reap or a node failure
      under a playing transcode**, not a mode switch. Until then this stays a
      P0.
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

## P1 — A mode switch blanks the picture for 16 s and negotiates from a stale position

**The blank half is fixed and watched live, 2026-09-21** — see the first item
below and [the run](2026-09-21-failover-and-mode-switch-live-run.md). The stale
position is core's and is unchanged.

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
- [x] **Do not empty the element until the replacement can show something —
      built and watched live on 2026-09-21.** Full record in
      [2026-09-21-failover-and-mode-switch-live-run.md](2026-09-21-failover-and-mode-switch-live-run.md).
      The first attempt at this was wrong about the mechanism and the run said
      so: the hold was not declining, it was **never called**. A representation
      change arrives as `transition: 'continue'`, the handover declines
      silently because the outgoing source is Direct Play, and the hold sat
      behind `transition !== 'continue'`. It is now asked on both transitions,
      except after a handover that spent the viewer's budget. Measured twice:
      `relocation-hold-begin` then `relocation-hold-complete` at 2,726 ms and
      4,977 ms, `readyState` never leaving 4, no `media-element-reused`.
      **16.5 s of black became none.** What follows is the original entry, and
      the clause it removed is still removed: The remedy was already in the tree: the 0.17.2 seek
      hold prepares the replacement on a second element and swaps when it can
      present. It declined here on one clause — it asked the *outgoing* source
      to be a manifest as well, and the outgoing source was Direct Play — which
      is a fact about media the hold never touches. It is now
      `canHoldThroughRelocation()`, which asks only what the replacement needs
      (an hls.js-driven manifest, and a frame actually up to hold), and the
      Direct Play case was watched failing against the old clause before the
      clause went. Two things went with it: a promotion now releases the
      outgoing side's Direct Play read-ahead, which only the teardown path did,
      so the worker no longer fetches a source nothing will play; and the hold
      stands the stall budget down, which it had been getting for free from
      `holdPicture()` on the seek path and does not get on a relocation no
      control asked for — a picture frozen on purpose reads to that countdown
      exactly like a dead node, measured at 6,864 ms on the seek path before
      `holdPicture()` stood it down. 391 tests across 50 files, typecheck
      clean. **Unwatched live**, and what a run has to show: the same mode
      switch with `relocation-hold-begin` and no `media-element-reused`, the
      frame up throughout, and `relocation-hold-complete` rather than a
      failover. Against a node still placing the generation at the click
      position (below), expect instead `relocation-hold-abandoned
      reason=incoming-seek-timeout` after ~8 s with the picture up for all of
      it, then the teardown and failover as measured — better, and not the
      whole fix.
- [ ] **7 s of "nothing arrived" is a terminal failure that was not one.** The
      node was producing; the client had asked past its frontier, which the
      server documents as a bounded wait. Failing over to another node is an
      expensive answer to "the fragment I asked for is not encoded yet", and
      the classifier could tell those apart — a request past the produced
      frontier is knowable from `look_ahead_ms` and the buffered edge.
- [ ] **Re-measure once the arrival-point request lands**, on the same title
      and node, with the same three timings: PATCH duration, blank duration and
      whether a failover happens at all. The target is no failover and no blank.

## P1 — A failover threw the picture away at diagnosis, seven seconds early

**Found and fixed on 2026-09-21, watched live both ways.** Record:
[2026-09-21-failover-and-mode-switch-live-run.md](2026-09-21-failover-and-mode-switch-live-run.md).

`failSourceGeneration` called `hls.destroy()` the moment it diagnosed a
terminal failure. `destroy()` detaches the MediaSource, so the element emptied
there and then — `media-abort` and `media-emptied` at `HAVE_NOTHING` — while
core was still building a replacement elsewhere. Measured on a killed node:
**9 s of black**, all of it after the failure was already known, and the
relocation hold declined correctly because by then there was nothing to hold.

A failed generation is now stopped where it fails (`stopLoad()`, so it fetches
nothing more from a dead node) and destroyed where it is replaced, on the three
paths that take the element. Re-measured on the same procedure: the hold
engaged on the failover itself, `readyState` never dropped below 2,
`videoWidth` never left 1920, `relocation-hold-complete elapsedMs=2596`, and
the viewer landed 330 ms into the new generation — within ~260 ms of where they
were.

- [ ] **The freeze is still 11.8 s**, 7 s of it the stall budget, and an
      attempt to remove it on 2026-09-21 was reverted — see "Why part three was
      dropped" in
      [the run](2026-09-21-failover-and-mode-switch-live-run.md). Seamless needs
      a replacement that arrives at its join, which is core's placement and the
      server's production rate; the client cannot buy it with runway. A still frame
      is better than black and is not the same as uninterrupted; whether the
      budget can be shorter on a node that has stopped answering *anything* is
      a separate question from the frontier case above.
- [ ] **Direct Play failover is unproven by this method.** The kill was a
      page-level patch of `fetch` and `XMLHttpRequest`, and Direct Play's
      read-ahead runs in a Service Worker that never sees it. A real node
      failure is what would test that half.

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
      now walks the chain and the screen reads it out under the head, quieter.
      Only `Error` causes are followed — a `PlaybackSourceError` carries an
      hls.js payload in `cause` and that is evidence for a log, not a sentence
      for a viewer — and the walk is cycle-safe, because a viewer waiting on a
      hung failure screen is worse off than one told less. Seen failing first
      against a stub that says nothing, which is what the screen did.

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

## P1 — Adopt `PlaybackSource.budgets`: three call sites, one change

**The named next thing, unblocked since core 0.14.0 published.** Agreed with
the core session on 2026-09-18 and, until now, buried as a task in the seek P0.
Core reads each node's `playback.startup_timeout_ms` and `segment_timeout_ms`
off `GET /api/v1/status` and passes per-endpoint figures on every source as
`budgets?: { deadlineMs, segmentHoldMs }`. Absent means the node could not say.

**Done 2026-09-20, all three in one change**, as agreed — a partial adoption
would have let the shortest surviving constant silently win.

- [x] `awaitNativeHlsFirstFragment` takes `source.budgets.deadlineMs` at its
      call site, keeping `NATIVE_HLS_FIRST_FRAGMENT_TIMEOUT_MS` as the
      absent-field fallback. The docblock's "five of the server's own
      six-second holds" is **withdrawn in the source**: the node's
      `startup_timeout_ms` *is* the bound on what that wait is waiting for
      (`macha/docs/streaming.md`), and five was a multiplier invented to fill
      the gap where that figure belonged. The number is unchanged — a
      conservative fallback is right when nothing is stated — only the claim.
- [x] `preflightWebHlsSource` defaults its `timeoutMs` to
      `source.budgets?.deadlineMs ?? HLS_PREFLIGHT_TIMEOUT_MS`, so the
      `Player.preflightSource` seam picks it up with no signature change.
- [x] `stallWatchdog.useSourceBudgets(source)` at the top of `watchForStall`
      — the one place every attach path passes through, rather than at each of
      the three, where a new path would forget it.

**Seen failing first.** A preflight against a source stating
`deadlineMs: 1` aborts; against the pre-fix default it does not, and the test
was watched going red with the old line restored before being kept. A second
test pins the other direction: absent budgets must resolve, never abort, since
a missing field lengthens a budget and never shortens it. Suite 364 across 48
files, typecheck clean.

**Not verified live.** No run has yet been watched where a node's stated
figure differs from the fallback — on this cluster both nodes report
`startup_timeout_ms: 15000` and `segment_timeout_ms: 6000`, which is what the
constants were derived from, so the adoption is currently indistinguishable
from the old behaviour at runtime. A node configured differently is what would
prove it. Core has been told which three sites were done.

What stays this repo's is the behaviour *inside* the deadline: honouring
`Retry-After` (capped at 5 s), treating `500 segment_not_ready` as the node
working rather than as evidence against it, and distinguishing a transfer
that never became a response. Do not derive a deadline from `segmentHoldMs`;
it shapes retries, it does not bound them. Absence lengthens a budget rather
than shortening it, which is the direction `streaming.md:188` requires.

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

## P1 — The relocation hold has run once, and three of its paths never have

Shipped in 0.17.2. On a seek that needs a new generation, the outgoing element
is paused on its last frame at the moment the control commits the seek, the
replacement is prepared on a hidden second element, and the two are swapped
once it can present the requested position. `WebPlayer.holdThroughRelocation`,
promoted through the existing `promoteHandover`.

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
- [ ] **Failover.** A `relocate` transition also arrives on failover, where
      there was no control to take the hold, so `holdThroughRelocation` takes
      it itself. Not exercised.
- [ ] **Native HLS and Direct Play.** Both decline by guard — Samsung owns its
      own element source and Direct never rebuilds a generation to seek — and
      the guards have not been watched declining.

The thing that would settle most of it is one session on a title whose
generations take ten seconds or more to build, which is a 4K HEVC transcode.

## P1 — The handover read its runway from a figure that stops updating (fixed)

`handOverToSource` takes `const runwayMs = outgoingEvent.forwardBufferMs ?? 0`
(`WebPlatform.ts:908`) — the last event the stream carried — and uses it to
decide whether there is enough buffer to be worth protecting. The quantity is
read from the stream, and the decision is about a stream that may have stopped
producing.

**Not a finding, an unchecked case.** This repo has contrary evidence:
`forwardBufferMs` was measured *not* to lag, matching the element to 211 ms at
build and **7 ms** at the reap. But that run still had events arriving — a
reaped generation emits while its buffer drains. The case that is untested is
the element that has **stopped emitting entirely**, where the age of the last
sample is unbounded and the figure can only overestimate the runway. A 7 ms
agreement does not refute that; it fails to test it.

Raised by the Android TV RN client on 2026-09-19, which hit the same shape
harder: it reads its runway for a *failure* decision, and a failed player is
precisely the thing that stops emitting, so its gap is unbounded by
construction. It now subtracts the event's age, and its test fails without
that. Core has recorded the staleness as a core item.

**Done 2026-09-20, and the survey with it.**

- [x] **The handover's runway gate reads the element, not the event.** Not the
      event's age subtracted from its figure, which is what the RN client does
      and is right for a client that cannot re-read its player: this one can.
      `forwardBufferMsAt(outgoing.currentTime * 1000, …)` answers for now, so
      the staleness stops being discounted and stops existing. The arithmetic
      is the same function `publish()` uses — position and ranges need only
      share a clock, because an origin common to both cancels in the
      subtraction — so the figure cannot drift from the published one.
- [x] **The clock offset still comes from the event, and must.** Core computed
      its request from that sample, so the two positions denote the same
      content by construction; a fresher position there would pair the viewer's
      place with a request that was never about it. Worth writing down because
      the obvious tidy — refresh everything at the top of the handover, which
      is the idiom two other call sites in this file use — is wrong here for
      exactly that reason.
- [x] **The other places were checked, and are clean.** `localSeekCoverage()`
      and `seek()` both call `publish()` synchronously before reading, so their
      sample age is bounded at zero by construction. `reportSourceGone` reads
      no buffer figure at all — it reports and does nothing else — so the worry
      recorded about it does not apply; it was a reasonable place to look and
      it is not one of these.
- [ ] **The call-site change is not unit-covered**, and saying so rather than
      implying the arithmetic tests cover it: `handOverToSource` has no test
      harness, so what is covered is `forwardBufferMsAt` — including the case
      that a sample taken 8 s ago claims 9 s of cover where 1 s is left, which
      is the fault in one line. A live run would show `handover-begin` with a
      runway that matches the element rather than the last event.

## P1 — Fractional milliseconds were wrong in three more places (surveyed)

**A change has been made for the known instance and it is NOT yet verified;
nothing else has been looked at.** This is a placeholder for a survey that has
deliberately not been done, not a report of one.

`publish()` emitted `video.currentTime * 1000`, which is sub-millisecond. That
value becomes the intent position, the persisted resume position, and the
`seekMs` sent back to a node. The seek contract is stated in **integer
milliseconds with no rounding slack**, so the client was asking in a precision
the wire does not carry.

What that cost, measured live on 2026-09-18: asked for 2,018,389.921 ms, the
node answered with a generation starting at 2,018,390, and core's
`generationLocalPosition` read `absolute < generationStart` as "this generation
begins after the viewer". It refused to activate, re-asked with the same
fractional number, and the node rounded to the same integer — 25 rounds, no
error raised anywhere, `player.play()` never called once, and the media simply
never played. It bites only when the node honours the *exact* position and
rounds up, which is a frame-accurate transcode, so it appears intermittent.

`publish()` now rounds. **That has not been seen to cure the livelock on a live
node** — it is typecheck-clean and the suite is green, but nothing in the suite
reaches this and it has not run against a cluster. Until a node has been watched
activating a generation it previously refused, treat the rounding as a proposed
fix and not a closed one.

**Surveyed 2026-09-20, and it was wrong in three more places.** The rule
applied throughout: anything crossing the wire or reaching storage is whole
milliseconds, and the element's own clock keeps its precision.

- [x] **`durationMs` was published raw** — `video.duration * 1000`. It reaches
      `localStorage` through Continue Watching, and it is the scrubber's `max`.
      That second one is the live escape: an `<input type="range">` snaps to
      its step grid *except at the maximum*, which it hands back exactly as
      given, so a drag to the far right committed the fractional duration as a
      seek — at the end of the title, which is where a node is most likely to
      clamp and round, which is the livelock's own precondition. **Floored, not
      rounded:** a duration must not claim media the element does not have,
      because a seek to the end is clamped against it.

      **How much this buys, stated honestly** (core session, 2026-09-20).
      Core's own published event takes `session?.durationMs || next.durationMs`
      and `generationLocalPosition` clamps a direct position against the
      session's figure, so the node's integer wins wherever a session has one
      and the element's fractional duration could never escape into a seek
      through core's path. Two windows are left, and both are this repo's: the
      Continue Watching record takes `event.durationMs` **unconditionally**,
      so storage always had the fraction; and `firstUsableDurationMs` prefers
      the session's figure but falls back to the element's, so the scrubber's
      `max` is fractional whenever the session states no duration. The
      scrubber-to-node path was real, and it was ours.
- [x] **`bufferedRangesMs` was published raw.** Made whole **outward** — floor
      the start, ceil the end — and the direction is the decision: narrowing
      refuses a seek the element could have served and charges the viewer a
      whole generation negotiation for it, while widening claims at most one
      millisecond it does not hold, which is a fraction of one frame and lands
      the element inside media it has.

      **One clause of the reasoning was wrong and is corrected.** It said
      these ranges "are what core admits a local seek against". They are not:
      core's `rangeContainsPosition` reads `localSeekCoverage()`, a different
      method on this adapter (core session, 2026-09-20). The conclusion
      survives for a reason worth writing down rather than being lucky — on
      this adapter `localSeekCoverage()` *is* computed from them, calling
      `publish()` synchronously and returning `lastPublishedEvent
      .bufferedRangesMs`, deliberately, so that local-seek admission and the
      buffer indicator have one authority. The widening reaches the admission
      path through that. Core confirms the direction independently for
      `localSeekCoverage()`: widening costs a seek to a position the element
      may have to fetch, which is a rebuffer and not a wrong position, since
      the element clamps to what it has.

      Where `bufferedRangesMs` itself reaches core, neither use admits a seek:
      `reportedElementRunwayMs` reads it **only when `forwardBufferMs` is
      absent**, and this client always publishes that; and the presentation
      path merges ranges within 1 ms of each other, so outward widening can
      merge a sub-millisecond gap — presentation only, and harmless.
- [x] **`forwardBufferMs` was published raw.** No known cost — it is compared
      against thresholds in seconds — rounded so that everything leaving the
      player is whole, rather than leaving one field to be reasoned about
      separately next time.
- [x] **`seek()` rounds at the commit**, which is the one place every committed
      seek in the UI passes through, so a fractional target from a path nobody
      has thought of yet still leaves whole.
- [x] **Checked and already clean:** the persisted queue position and the
      Continue Watching position both come from `event.positionMs`, which was
      rounded when the original fault was fixed. `seekBy` adds whole constants
      to a whole base. Seekable ranges are not published.
- [x] **Seen failing first, at the level that matters.** The test drives the
      real player through `play()` and a `timeupdate` and asserts on the event
      that actually leaves it, rather than on a helper: it was watched failing
      with `expected 2706336.031 to be 2706336`, a genuine element's figure.

**Still not verified live**, and this is the part to keep separate: the
original rounding has never been watched curing the livelock on a node, and
neither has any of this. Suite 379, typecheck clean.

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
signature as the Direct Play investigation. Out of scope by decision: if nobody
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

- [ ] **Superseded, kept for the record: run 1's failure, since fixed in
      `73abbdc`.**
      `replacement-held` fires correctly (runway 110 s against a 15 s floor) and
      is thrown away 28 s later. hls.js keeps retrying the reaped session for
      ~30 s and goes fatal; core cannot probe that fatal because `regenerate()`
      has already released the old session, so `sessionAlive()` throws *"has no
      endpoint provenance"*, which reads as "could not find out" and lands in
      failover — releasing the held replacement on its way past. **Worse than
      the 5.16 s stall it replaced**: 82 s of runway discarded, element emptied,
      playback moved onto a different endpoint.
- [x] **This repo: `fail-not-found` no longer tears down.** `reportSourceGone`
      reports and does nothing else, so the buffer built before the source went
      away stays as the recovery budget. Core took the obligation to end a dead
      playback (`failTerminal` sets the fatal error and the runtime stops the
      player), which answers the question of what the viewer is told when no
      replacement comes. Recorded in the pause P0's task list with its evidence.
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
- [ ] **Do not fix it with a keepalive.** The transcode entitlement is held by
      the session, not the pipeline, so a paused session held open pins the
      node's only video transcode slot for as long as the tab is. The reaping is
      correct; noticing it on the way back is what is missing.

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

## P1 — A ready standby was discarded 33 s before it was used: re-measure

**Demoted from P0 on 2026-09-20.** The fix, `promoteReadyAlternate`, landed in
core 0.6.1 and the only task left has been "re-measure" since 2026-09-08. A
twelve-day-old verification task is not a live correctness fault. It is kept
because the 63.6 s figure below is still the last measurement anyone took of
the managed-HLS failover path.

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

## P1 — `lastMintFailure` is read, and the heading's premise had already moved

**Done 2026-09-20 — but not the thing the heading describes.** The title said
"so a refusal stops raising the connection gate", and core 0.14.0 already
stops it: `mintNow` calls `reportClusterUnreachable()` only
`if (this.mintFailure.reason !== 'refused')`, with the argument written in the
source. Read before building, so what was left turned out to be the opposite
problem.

**The client was not lying about a refusal. It was silent about one.** Roles
stay `undefined` through a failed mint, `sessionPermits` answers its
permissive "unknown is not none", and the whole navigation therefore rendered
as usual over a session that does not exist: every section visible, every
request refused, and nothing on screen admitting it. A node that answered
**403 in forty milliseconds has been reached** and has stated a policy — which
is exactly why no connection gate appears, and exactly why something else had
to.

- [x] `useSession` publishes `mintFailure` from the subscription it already
      holds, which is where core says to read it — "every change to it is
      published through `subscribe()`", together with `isReady`.
- [x] A refusal now lands on the **sign-in wall**, the same one a role-less
      session gets: `sessionLockedOut(roles) || mintFailure?.reason ===
      'refused'`. Two different facts — a session that may do nothing, and no
      session at all — with one honest answer, because signing in is the one
      thing a viewer can do about either.
- [x] The server's own sentence is **not** shown. Core's contract states it is
      never assumed fit for a viewer.
- [x] Seen failing first: the hook test stubs a 403 with `anonymous_disabled`
      and asserts `reason: 'refused'` with its status, and was watched red
      before the field existed. A second test pins that an adopted session
      reports no failure at all, so the field cannot become sticky.
- [ ] **Not verified live**, and the refusal is not reproducible on this
      cluster by waiting: an unauthenticated mint here *succeeds* with
      `roles: []`, which is the locked case and a different branch. Producing
      a refusal needs a node configured to disable anonymous sessions.

Related to the port below, and worth doing in the same sitting: both are about
telling a viewer the truth about why they cannot see anything.

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
falls back to `GET /api/v1/users/me` purely to learn a name. The 0.37.x nodes
named no user at all; 0.38.0 added `user_id`; `username` arrived 2026-09-13.

- [ ] Confirm every node in the cluster reports `username` on
      `GET /api/v1/session`, then delete the fallback and its round trip.
      Keep it until then — a mixed-version cluster is normal here.

**2026-09-20: every reachable endpoint confirmed — this is now a deletion.**
`GET /api/v1/session` returns `username` and `user_id` from
`https://ramaroja.macha.network`, `http://10.34.1.50:7438` and
`http://10.35.1.50:7438`, all on server 0.46.2. `macnessa` and `inverbeg`
were not reachable to ask, but they are the nodes that have been offline since
2026-09-17; if they come back below 0.38.0 they will be the only ones. Delete
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
`useSourceBudgets()` is not yet called here; that is the budgets-adoption P1.

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

- [ ] Show the real thing. **Unblocked: `api_endpoint` has shipped and is on
      the wire** — checked 2026-09-20, `GET /api/v1/status` reports
      `api_endpoint: https://ramaroja.macha.network` for the fronted node and
      `http://10.35.1.50:7438` for a LAN one, scheme included. That is the value
      this field can honestly display, and the hold on relabelling is over. A
      node with no `api_endpoint` (one of three did not report one) shows an em
      dash, not the RPC socket.
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
  picked 5 s; it was, until 2026-09-17.) The remaining step is to take the
  figure from the serving node via `PlaybackSource.budgets.deadlineMs` with
  the constant as fallback, which is the budgets-adoption P1.

**The lesson that generalises past this swap:** a picked number states
nothing; a derived one states its relationship. Core's replacement asserts the
*inequality* against `SERVER_SEGMENT_HOLD_MS` in a test rather than pinning the
number, so it cannot drift back. Do the same here for anything that survives
the swap.

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

## P2 — Direct Play stuck at readyState 0: explained by tab occlusion, instrumented, not reproduced since

**Demoted from P0 on 2026-09-20.** Twenty confirmed-visible attempts without a
failure, every observed hang traced to an occluded or backgrounded tab, the
unbounded wait closed by the start watchdog, and two instruments now in place
that will speak on their own: `source-start-starved` records whether the
*browser* never dispatched or the *node* never answered, and `videoState()`
reports `document.hidden` on every diagnostic line since 0.17.2. The same
occlusion signature was walked into again during the 2026-09-18 seek work and
identified in seconds because of that field. By this file's own definition
this is P2: it needs a real viewer report to progress, and no scripted
evening will produce one. Everything below is the investigation record; do not
re-run the ruled-out checks.

**Original report (2026-09-05).** Environment: macOS Chrome 152.0.7977.77, dev
server (`localhost:5173`), 3-node cluster, a Direct Play film (`tmdb:movie:8374`,
mp4, video+audio `copy`), streamed from node `gbni-1` (`10.44.1.50:7438`).
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
throughout (dev server, Chrome 151, gbni-1, the same film, Direct Play,
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

## P2 — Repo conventions

Tom set these 2026-09-13 and asked every session be told. The dated branch
bookkeeping that used to sit here is gone: `0.14.0` **is** tagged, `develop`
is the working branch, and as of 2026-09-20 `main`, `develop` and the `0.17.2`
tag are level.

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
