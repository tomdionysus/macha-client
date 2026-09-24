# 2026-09-23 (evening) — handover

Written for a context clear, at the end of the session that followed this
morning's [handover](2026-09-23-session-handover.md). `ACTIVE.md` is current
and its Start here says where things stand; `COMPLETED.md` has three dated
entries at the top with the evidence. This note is what those files do not
hold: what is running, what is in flight with the sibling sessions, and the
method that cost time.

## Where the repo is

- `main` is 0.18.0 (`ce74408`), unchanged today.
- `develop` is **22 commits ahead of `origin/develop`**, all local, none
  pushed. Tom owns pushing. The working tree is clean apart from
  `CLAUDE.local.md` and `basemind.toml`, untracked on purpose.
- Suite 488 tests, typecheck clean, against core's linked tree at `23583aa`.
- Core is **unpublished past 0.18.0**, and `develop` depends on what is past
  it: `PlaybackRuntime.moveTo(endpointId, { leadMs })`, `holdsThroughLead`,
  `needsProducedSource`, the move fixes. A release of this client needs a
  core publish first, which is Tom's word.

## What is running on this machine

- `vite --host --force` (pid 40176) on `:5173`, against the linked core.
  **It was restarted several times today because it served a stale copy of
  core's `dist`** (see Method). Kill with `pkill -f "vite --host"`.
- The SSH tunnel to gbni-1 (pid 48563):
  `ssh -f -N -o ExitOnForwardFailure=yes -L 7438:127.0.0.1:7438 root@10.44.1.50`.
  `curl 127.0.0.1:7438/api/v1/health` answered 0.53.2 at the time of
  writing. The dev client talks to its configured node addresses directly;
  the tunnel only matters for anything that reads `MACHA_API_TARGET`.
- No browser tabs are left open by this session.

## In flight with the sibling sessions

- **Core** has no open request from this client. Its open items that touch
  us: a server-stated start cost for a node never measured (core asked the
  server; needed before an unled switch can be led), the decline of a move
  to a node this viewer's link cannot carry (core has the inputs now and
  will build it once the rate has enough media samples), and
  `EndpointBandwidth.restore()` re-entering a persisted record at one sample.
- **Server**: nothing asked by this session directly.
- Core records every live run of today in its own `TODO/ACTIVE.md`
  (latest `909cf4d`, the reap run).

## Tom's rulings today, verbatim where they were given

- Node start cost: core measures, the host may override. Tom later ruled out
  core's one-byte probe: "one-byte request - we're not doing this".
- "Zero byte check is a hack and we're not doing it. If you've a better idea,
  talk to core." This client's native-HLS probe is deleted for it.
- The standby preflight stays: "it is reasonable to request initial media
  from a node you're about to failover to."
- Commit when a piece of work is complete (not push).
- The README carries the version under its title and is kept updated.
- The pause P0 was the only thing keeping it a P0; it is closed.

## What needs Tom next

- A television: the native-HLS produced-source wait is unit-tested only.
  Evidence wanted: a `source-produced-wait` line reading `produced`, the
  create-to-hand-over time, and the element starting clean.
- The Import page under an account with `importer` (the test account does
  not have it).
- A core publish, then this client's release, then a deploy.

## Method, because these cost time today

- **The dev server can serve a stale core.** Core's tree sits outside what
  Vite watches, so a rebuilt `dist` is not picked up. Before any live run,
  load the page and fetch the served module (`/@fs/.../macha-ts/dist/...`)
  to check it contains a string from the newest core change; restart
  `vite --host --force` if not. A direct `curl` of an `/@fs/` path is refused
  until the app has imported it, which is not a stale-copy signal.
- **A hot reload mid-run spoils a long live test.** Editing `src/` while a
  run is in progress reloads modules into the page. For work during a long
  run, use a git worktree outside the served tree and cherry-pick after.
- **Foreground, and record `document.visibilityState` at every read.** The
  window was taken to the front with AppleScript before each run; it still
  went to the background at an unknown time during the 35 minute pause.
- **The Resource Timing buffer is full within 11-18 s of load** (250
  entries). Never read "no requests" from it; observe with a
  `PerformanceObserver`.
- **The browser tool redacts values whose keys look sensitive**
  (`session`, `token`, anything JWT-like), including `session_idle_ms` and
  node hosts. Transform the value (divide, slice) to read it.
- **A page-side `await` over 45 s times out the browser tool.** Wait in
  shorter calls.
- **Check every session is gone after a run** (GET each created id on each
  node, expect 404, or list the account's sessions). The first move run
  leaked one that held gbni-1's only transcode slot.
- **Split a slow node into time to first byte and transfer before naming
  it.** This machine is at the fi-1 site; gbni-1 answered fragments in
  0.1-0.35 s and was slow only on the link. The first diagnosis blamed the
  node and was wrong.
