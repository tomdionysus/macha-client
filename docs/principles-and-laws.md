# Principles and laws

Shared with the Macha server. These are constraints on design and
implementation, not aspirations.

## Principles

**Macha is a media system.** The client browses and plays the owner's media.
No advertising, recommendations, social activity or global watchlist.

**The server serves facts; the client negotiates.** The server owns the
catalogue, media identity, durability, placement and transformation. The
client owns presentation, navigation, platform capabilities and playback
intent. Choosing Direct Play, remux or transcode, and which of an item's files
to play, is the client's, made in `@machafoundation/core` from measured
capabilities so every client decides alike. The server performs the result.
The client does not infer cluster state, invent a parallel server model,
transcode, or treat a local cache as authority.

**Control, data and cache are distinct.** Control and status stay responsive
whatever bulk media is doing. Cached or stored client state is an optimisation
or history, never proof of server state or a live playback session.

**Playback resources have one owner.** `PlaybackRuntime` owns the player and
the coordinator; the coordinator owns the server session. React presents
snapshots and binds surfaces; a route change never creates or destroys
playback. Play, pause and local seeks act at once and are never blocked by
server preparation. New intent supersedes obsolete work.

**Work is bounded and event-driven.** Events wake work; polling and quiet
periods do not replace ownership. Every retry, buffer, queue, cache and
recovery is bounded, and failure is shown and actionable, never an indefinite
wait.

**Compatibility is explicit.** Platform-specific code is limited to
capabilities, playback, lifecycle and input. A fallback must be deliberate and
tested, and must not weaken playback ownership, viewer priority or server
authority.

**Nothing the viewer waits on is fetched late.** Application code is one
bundle. A large library that some playback paths never use (hls.js) may be
split out, but its fetch starts before it is needed, overlapping session
negotiation, and never adds a round trip to playback start. Catalogue artwork
may be viewport-lazy; the logo and the UI assets startup needs are preloaded
or embedded.

## Laws

1. **Thou Shalt Not Make Control Wait.** Membership, health, cancellation,
   shutdown and the control work needed to admit a viewer never queue behind,
   or run inline with, bulk data work.
2. **Thou Shalt Not Make The Viewer Wait.** Playback start, reads and seeks
   have overwhelming priority. No throughput gain justifies viewer-visible
   delay or buffering.
3. **Thou Shalt Not Make The Ingester/Loader Wait, Unless It Would Make The
   Viewer Wait.** Without viewer contention, ingest uses the capacity there
   is. It may be paced by real limits, never by an artificial quiet period.
4. **Thou Shalt Not Shoot Thyself In The Foot.** Nothing may leave the node,
   or the client, in a state it cannot recover from alone. This overrides the
   other three. The test: a television in another room that nobody will
   relaunch. In practice: re-derive, do not assert; every retried item gets
   backoff, a failure budget, a parked state and an operator action; recover
   by resolving, not refusing; a bound smaller than one unit of its own work
   is not a bound.

The order is priority, not exclusion:

```text
control > viewer >> loader > speculative
```

A lower class may hold only a bounded amount of uninterruptible work when a
higher class arrives, and the loader must still make progress under sustained
viewing.

## End to end

Classifying a request at the UI or API is not enough. Its priority must hold
through everything it can wait for or occupy:

```text
user intent -> client state -> network request -> server admission
            -> executor -> lock -> buffer -> CPU -> I/O -> RPC
            -> source delivery -> media pipeline
```

No bounded operation may hide an unbounded one. Lower-priority work may not
hold a lock, slot, buffer or connection while waiting on something slow if
that can block control or the viewer. Priority inversion is a correctness
failure. In the client: bookkeeping, artwork, diagnostics, ingest status and
read-ahead must never delay playback start, transport controls or seeks.

When a resource is unavailable, the higher class completes from what is
already published or fails within a stated bound. It never waits indefinitely.

## Review gates

Check any material client change against these:

- Can control, cancellation or error recovery queue behind media, artwork,
  ingest, diagnostics or speculative work?
- Can playback start, transport or seek wait on bookkeeping, caching,
  read-ahead or presentation?
- Can a route or render lifecycle create or destroy playback resources?
- Is any retry, queue, buffer, cache or recovery loop unbounded?
- Is polling introduced where an event or state transition exists?
- Is cached state treated as server authority or a live resource?
- Does a compatibility path change ownership or priority?
- Does startup or playback start now wait on a fetch that could have begun
  earlier, or load a module it does not use?

If any answer is uncertain, add coverage before changing the mechanism.
