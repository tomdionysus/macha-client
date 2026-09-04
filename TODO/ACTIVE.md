# Active tasks and concepts to explore

Last updated: 2026-09-04

This is the working backlog for the current session. Add new work here. When an
item is implemented and its stated verification is complete, remove it from
this file and add a dated entry with evidence to `COMPLETED.md`.

The existing documents in this directory remain the detailed plans,
checkpoints, and verification records. This file is only the current index.

## Samsung deployment verification

- [ ] Complete interactive UAT of the build installed on `10.44.1.183`:
  confirm application boot, catalogue refresh, D-pad navigation and playback
  controls on the Tizen 3 TV.

## TV spatial navigation redesign

- [ ] Rethink Samsung and Android D-pad focus navigation from first principles;
  the current geometry scorer remains unintuitive, while the attempted
  row/group replacement was materially worse. Do not make another incremental
  scoring adjustment without first defining and reviewing expected focus paths
  for the primary navigation, secondary navigation, media grids/rails, detail
  actions, management forms/modals and the player.
- [ ] Build a route-by-route focus-path fixture suite from those expectations,
  including uneven card layouts, overlays, scrolling, modal containment,
  remembered/default focus, text inputs and the seek bar. Validate the proposed
  model on both Samsung and Android hardware before adopting it globally.

## Catalogue dates

- [ ] Add a full optional release or air date to the Macha catalogue wire model
  and persist it from metadata providers. For TMDB, populate movie
  `release_date`, series `first_air_date`, season `air_date` and episode
  `air_date`.
- [ ] Update the client wire mapping after the server contract exists. The
  client already has an optional `releaseDate` field and displays a neutral
  placeholder until the server supplies it; do not introduce a provisional
  wire field beforehand.

## Any-node client and seamless playback failover

- [ ] Execute the phased client-first plan in
  [the any-node playback failover plan](2026-08-31-cluster-any-node-playback-failover.md).
  Demonstrate automatic Direct Play and HLS recovery between two explicitly
  configured current Macha nodes before requiring a new server API. Keep media,
  position, preferences, queue and playlist exclusively client-owned.
- [ ] Preserve the server boundary: the future cluster session is only a
  replicated ephemeral existence/authorization capability. It has no playback
  state, authoritative playback node, ownership transfer or fencing token. Any
  node may concurrently create a disposable local playback generation for it.
- [ ] Treat seamless handoff as the primary correctness/performance objective:
  keep exactly one session during healthy playback; on concrete stream failure
  evidence, retain usable buffered playback while opening a 30-second alternate
  recovery window. Promote a working replacement permanently, then retry old
  session cleanup with exponential backoff. Never expose transient node failure
  as terminal player failure before bounded alternate-node recovery is exhausted.
- [ ] Measure request latency per healthy API endpoint. If the current
  authoritative endpoint is consistently slow while another known healthy node
  is materially faster, consider a hysteresis-based pre-emptive authority swap.
  Do not flap on individual slow requests or let background probes interrupt
  healthy in-flight work.

## Native platform players

- [ ] Implement an Android Media3 platform host against the existing player
  boundary while preserving `PlaybackRuntime` ownership and state-machine
  semantics.
- [ ] Implement a Samsung Tizen AVPlay platform host against the same boundary.
  Until then, retain the shared HTML5/Web player and conservative Tizen 3
  capability profile used by the current Samsung package.
