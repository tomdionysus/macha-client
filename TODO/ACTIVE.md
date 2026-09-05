# Active tasks and concepts to explore

Last updated: 2026-09-05

This is the working backlog for the current session. Add new work here. When an
item is implemented and its stated verification is complete, remove it from
this file and add a dated entry with evidence to `COMPLETED.md`.

The existing documents in this directory remain the detailed plans,
checkpoints, and verification records. This file is only the current index.

Scope: this file (and this repo) is macha-client only — the UI/playback
client. Server-side backlogs (e.g. `macha`'s own `TODO/ACTIVE.md`) are a
different repo's concern and are not tracked or duplicated here, even when a
client bug and a server bug are related.

Priority reflects active-breakage/user-impact, not effort: P0 is a live or
recently-live correctness problem in playback itself; P1 is important,
scoped, and actionable now; P2 is real but either blocked on something
outside this repo or needs groundwork before it can be started safely.

## P0 — Any-node client and seamless playback failover

Detailed plan, phase-by-phase status, and dated live-verification evidence:
[the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md).
Phases 0–5 are implemented and live-verified against a real 3-node cluster
(repeated `systemctl stop`/`start` against real nodes, not synthetic
failures). Remaining work, in priority order:

- [ ] **Finish Phase 6 UAT.** Direct Play range-transfer failure is verified
  (silent mid-stream swap, no video reload, confirmed live with zero
  measured stall). Not yet exercised: HLS failure, and failure specifically
  during session POST, manifest transfer, pause, seek and option-change.
  Also still open: prove the client never navigates away, loses its
  queue/preferences, creates an unbounded retry/session loop, or waits on
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
- [ ] **`fail()`'s reactive path has the same shape of race `degrade()` had.**
  `degrade()` now correctly ignores playback errors while a seek-driven
  generation replacement (`this.activeMutation?.reason === 'seek'`) is
  already in flight (fixed 2026-09-05, live A/V-desync report — see the plan
  doc, Phase 5). `fail()` was deliberately left unguarded: the same
  short-circuit there would risk silently swallowing a genuinely unrelated
  fatal error during a seek, with neither recovery nor failure UI. Needs a
  real design (e.g. wait for the in-flight mutation to settle before
  treating a fatal error as fresh), not a copy of the `degrade()` fix.
- [ ] **No bounded per-request timeout anywhere in the cluster status/
  catalogue/routing fetch layer.** Every `AbortSignal` in that layer is
  caller-supplied for unmount cancellation only, never a timeout. Caught
  live: a single already-known-good endpoint took 19.7s on one request,
  serialized behind nothing, blocking unrelated work. Add a real
  `AbortController`-based timeout to every fetch in this layer.
- [ ] **Endpoint registry has no memory across a reload.** Runtime-discovered
  cluster membership (`discoverClusterEndpoints()`) lives only in memory; a
  page reload reseeds purely from the single original bootstrap URL in
  localStorage. If the client already failed over away from that node
  because it went down, a reload while it's still down has no way back in.
  Persist a small, bounded set of endpoints actually confirmed working
  (not unbounded discovery history), treated as `bootstrap`/`environment`
  source so it survives `applyAdvertisement()`'s replace-on-refresh.
- [ ] **Phase 3 compatibility-path rationalisation** — explicitly deferred,
  not actionable yet: blocked on a minimum-supported-node-capability
  guarantee (immutable media profiles) that does not exist yet.

## P1 — Samsung deployment verification

- [ ] Complete interactive UAT of the build installed on `10.44.1.183`:
  confirm application boot, catalogue refresh, D-pad navigation and playback
  controls on the Tizen 3 TV.

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
