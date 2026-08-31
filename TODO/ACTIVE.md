# Active tasks and concepts to explore

Last updated: 2026-08-31

This is the working backlog for the current session. Add new work here. When an
item is implemented and its stated verification is complete, remove it from
this file and add a dated entry with evidence to `COMPLETED.md`.

The existing documents in this directory remain the detailed plans,
checkpoints, and verification records. This file is only the current index.

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
  retain usable playback while preparing an alternate, never expose transient
  node failure as terminal player failure, and exhaust bounded alternate-node
  recovery before asking the viewer to intervene.

## Catalogue dates

- [ ] Add a full optional release or air date to the Macha catalogue wire model
  and persist it from metadata providers. For TMDB, populate movie
  `release_date`, series `first_air_date`, season `air_date` and episode
  `air_date`.
- [ ] Update the client wire mapping after the server contract exists. The
  client already has an optional `releaseDate` field and displays a neutral
  placeholder until the server supplies it; do not introduce a provisional
  wire field beforehand.

## Native platform players

- [ ] Implement an Android Media3 platform host against the existing player
  boundary while preserving `PlaybackRuntime` ownership and state-machine
  semantics.
- [ ] Implement a Samsung Tizen AVPlay platform host against the same boundary.
  Until then, retain the shared HTML5/Web player and conservative Tizen 3
  capability profile used by the current Samsung package.

## Samsung remote and focus navigation

- [ ] Replace the current Samsung D-pad focus heuristics with a deterministic,
  documented navigation model. Focus movement is presently inconsistent and
  often appears unrelated to the visual direction requested; define explicit
  rows, groups, boundaries, restoration rules and editor behaviour, then cover
  representative screens with navigation tests.
- [ ] Map the Samsung remote's Play, Pause, Play/Pause, Previous, Next and Stop
  keys to the corresponding playback actions, including key registration and
  legacy key-name/keyCode coverage where required.
- [ ] Re-enable the interactive playback progress slider on Samsung and make
  D-pad seeking natural and predictable. Focused Left/Right must adjust the
  seek target without spatial focus navigation stealing the event, with clear
  commit/cancel behaviour and tests around long presses and bounds.
