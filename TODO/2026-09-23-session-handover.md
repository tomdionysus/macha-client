# 2026-09-23 — handover

Written for a context clear, at the end of the session that rationalised the
backlog after the previous collapse, released and deployed 0.18.0, and
answered the server's torrent-placement contract. What was measured is here
with its measurement; what was inferred says so. `ACTIVE.md` is current;
this is the record of the session.

## Where the repo is

- **`main` at `ce74408`, tagged `0.18.0`** (annotated, one-line message,
  like every release before it). Resolves `@machafoundation/core` as
  `^0.18.0` from the registry. Pushed, with the tag.
- **`develop` at `95cb3a0`**, pushed as far as `8ca7760`; the two records
  commits after that (the deploy record and the torrent fixture fix) are
  local. `develop` links core (`file:../macha-ts`) and differs from `main`
  in `package.json` and `package-lock.json` by design.
- Working tree clean apart from `CLAUDE.local.md` and `basemind.toml`,
  untracked on purpose.
- Suite 461 tests across 56 files, typecheck clean, against the link.

## What is deployed

**0.18.0 is on all three nodes and both public names**, deployed 2026-09-21
22:53 UTC: `index-CKNh5Q9D.js`, 633,692 bytes, `shasum` `eff197072a8e`,
built from `main` at the tag against the *published* core — the first
deployed bundle ever built that way. Backups at
`/etc/macha/web.bak-20260921-225245.tar.gz` on each node. Old and new
bundles share the lazy `hls-Bt6kO1A0.js` chunk, so the additive deploy could
not break a viewer mid-session.

**The browser smoke test is unfinished and is the first thing owed.** It
proved the artefact boots (`react-mounted` at 29 ms, read-ahead worker
registered, no exception), then the tab logged nothing for 101 s, reported
`route-exhausted` and `same-origin-absent`, and the renderer stopped
answering CDP. Read as a frozen background tab, because the independent
measurement disagrees with the log: all five hosts answer `/api/v1/health`
with `{"service":"macha","status":"ok","version":"0.48.2"}` as JSON, which
is exactly what `confirmMachaEndpoint` requires, and that probe aborts at
1.5 s against a tab whose timers had stopped. **But do not take that on
trust.** `useNodeIdentity` is now in front of viewers and is the one deployed
mechanism that could drop endpoints in a healthy tab (see below). The check:
open the client foregrounded, confirm it finds its own node, and read the
endpoint list before and after the first identity cycle.

Chrome on this machine was left with a frozen tab on `ramaroja` that could
not be closed through the extension.

## Core

- **Published 0.18.0**, `latest` on the registry. Its tree is at `a3b40ca`,
  its own `0.18.0` commit, so the linked and published code agree today;
  they will not tomorrow, which is the point of the link. Core's session had
  an uncommitted `TODO/ACTIVE.md` change at the time of writing.
- Everything this client compiles against is in the published tarball:
  `prefer`, `moveTo`, `claimNodeId`, `SOURCE_SUPERSEDED_STATUS`,
  `playbackFailureDetail`. Checked in the tarball, not the tree.
- **The gate caught a live instance of the trap this repo had only described.**
  Removing the symlink and running `npm install` put it straight back,
  because `package-lock.json` carried `"link": true` at `../macha-ts`; the
  version check agreed because core's tree was also at 0.18.0. `test -L` was
  the only check that failed. Removing the two lockfile entries fixed it.
  Going back to `develop`, `npm install` restores them by itself.

## The cluster

All three nodes on server **0.48.2**, `ready`/`online`. Per-node `playback`
now states `startup_timeout_ms` 15000, `segment_timeout_ms` 6000,
`session_idle_ms` 1800000, `pipeline_idle_ms` 60000,
`transcode_entitlement_idle_ms` 300000, `max_sessions` 64,
`max_sessions_per_account` 32. The per-account cap (0.48.0) has replaced
one-session-per-bearer, which supersedes the "a same-node handover cannot
work at any lead time" finding — noted in the handover P0, not re-measured.
`corvus-fi-1` reports `hosts_extents: false`. No node record carries a
`name`; `host` is a DNS name on two nodes and a machine name on the third.

Node ids and addresses, zones, caps and the three 429 codes are under "How
the test cluster behaves" in `ACTIVE.md`.

## What was done, in order

1. **Rationalised `ACTIVE.md`, `COMPLETED.md`, README and docs** against the
   code, the commits and the cluster (`3f269c8`). The readyState 0 stall
   went back to P0 with nine dead explanations in one place; `useNodeIdentity`
   became a deletion rather than a feature; five finished P1s moved to
   `COMPLETED.md`; the docs lost `Macha-Viewer-Session` and `Idempotency-Key`,
   which core no longer sends.
2. **Released 0.18.0** — merge to `main`, registry core, gate, tag, push
   (`ce74408`). **Relinked `develop`** (`8ca7760`).
3. **Deployed** to all three nodes (`8fdebb2` records it).
4. **Answered the `Macha Server` session's torrent contract** (`95cb3a0`):
   keep the hex `node_id`; add a `name` to `/api/v1/status` nodes rather
   than to the torrents route; the default placement is arbitrary and the
   always-present `node_id` on the 202 is what makes that acceptable; and
   two questions — can a `hosts_extents: false` node take a job, and is
   `node_id` accepted exactly as status reports `id`. **No reply had
   arrived** when this was written. The torrent detail pane's fixture, which
   asserted a node id reads `gbni-2`, was corrected to a real 32-hex id.

## What is next, in order

1. **The foregrounded check of the deployed client** (above). Ten minutes,
   and it either closes the deploy or opens a P0.
2. **Delete `useNodeIdentity` and wire `selectNode` to `moveTo`** — the
   first P1. The deletion is now urgent rather than tidy, because the hook is
   deployed and calls the membership call.
3. **Instrument the `readyState` 0 stall** — the P0 with the recorder spec.
4. **The reap run** — a thirty-minute pause against 0.48.2.
5. **The torrent node control**, once the server session says which version
   deploys the contract. Design sketched in its P1.

## What is running on this machine

- `vite --host --force` (pid 79584 at the time of writing) on `:5173`,
  against the linked core. Kill with `pkill -f "vite --host"`. The SSH tunnel
  to `gbni-1` that the dev proxy used is **gone**; `MACHA_API_TARGET` in
  `.env.local` still points at `127.0.0.1:7438`, so the dev server has no
  API behind it until the tunnel is re-established:
  `ssh -f -N -L 7438:127.0.0.1:7438 root@10.44.1.50`.
- Chrome, with the frozen tab above.
- All three nodes answer `ssh root@<addr>` from here without a password.

## Method, because two of these cost time

- **A version check is not a link check.** Two artefacts can answer the same
  version while one is a symlink into a tree that will move tonight. `test
  -L`, and the lockfile's `"link": true`, are the only things that cannot
  agree by coincidence.
- **A browser observation from a tab you did not foreground is not evidence.**
  This session walked into it again, on the deploy check, with the confound
  written in the file it was reading from. Foreground the window, record
  `document.visibilityState`, and measure the same thing from outside the
  browser before believing a log line.
- **Answer a contract question by reading what the client would render.** The
  torrent feedback's one real finding — the Node row is unreadable hex and
  nothing on the wire can name it — came from opening the component and the
  fixture, not from reading the proposal.
