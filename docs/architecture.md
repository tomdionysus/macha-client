# Architecture

The [principles and scheduling laws](principles-and-laws.md) are constraints on
this architecture, not aspirations. In particular, control and viewer work stay
responsive independently of catalogue artwork, ingest, diagnostics and
speculative activity.

## Layers

```text
                          Macha cluster
                 distributed media + catalogue
                             |
       /api/v1/catalogue       /api/v1/playback
          JSON + artwork       sessions + streams
                |                    |
  ==============|====================|=============== @machafoundation/core
                |                    |
       MachaCatalogueApi     ClusterPlaybackResolver
                |                    |
          MachaMediaApi         PlaybackRuntime
                |                /          \
                |   PlaybackCoordinator   Player (interface)
                |                    |       |
  ==============|====================|=======|======= macha-client
                +---------+----------+-------+
                          |
                  React presentation
              + browser-history router
                          |
           +--------------+--------------+
           |              |              |
          Web          Android TV        Samsung
    video + hls.js   WebView + hls.js   native HLS,
                                        MPEG-TS segments
```

The endpoint registry, health monitoring and failover sit beside the API layer
in `@machafoundation/core` and are shared with the React Native clients, which
reuse none of this repo's presentation.

## Ownership

**The server serves facts; the client negotiates.** The server states what a
title is, what its streams are and what it can perform. The client reports what
its platform can decode and chooses Direct Play, remux or transcode from that.
The chooser lives in `@machafoundation/core`, so every Macha client decides
identically from the same facts. The server performs the result and does not
substitute for it.

**Any node will do.** Configured API URLs seed a client-owned endpoint registry
and one shared router used by catalogue, status, management, import and
playback. The endpoint that most recently completed real work is authoritative
and is tried first; on retryable failure the first working alternative becomes
authoritative. Every known endpoint is checked immediately and at a bounded
interval, but probe completion updates health only and never displaces
authority.

**Cancellation is never node-health evidence.** Health probes are not wired to
playback, component lifecycle or client timeouts. An `AbortError` represents
local intent and cannot demote an endpoint or trigger cluster-unreachable
state. Node identity and API endpoint identity stay separate, because one node
may advertise several reachable API bases.

**Cluster transport exhaustion is an application-level state**, not a
screen-level error. Only the background health scan may publish that
transition, and only after every configured endpoint fails an independent
status request. An exhausted foreground catalogue, profile, artwork or
management operation cannot infer a cluster-wide outage. While a player owns
playback, recovery UI is deferred so neither playing nor paused presentation is
unmounted, and recovery is cancelled if any endpoint responds before playback
ends. Afterwards the application mounts only the Connection gate at
`/manage/settings/connection` until an endpoint passes a bounded check. With no
stored endpoints the same gate is presented as first-run setup.

## Playback

Playback is split into two planes:

```text
user intent ── play / pause / seek ───────────────► active player immediately
     │
     └── source-generation change required? ─────► server preparation
                                                       │
                                                       ▼
                                              newest generation ready
                                                       │
                                                       ▼
                                              apply latest user intent
```

`PlaybackRuntime` is the application-scoped resource owner and state machine. It
owns one platform `Player` and at most one `PlaybackCoordinator`; the
coordinator owns the active server session lease and source-generation
transitions. React renders snapshots and provides presentation hosts. A
full-screen or mini-player route change may rebind the player surface but
cannot create, replace or destroy a playback session.

The runtime creates one opaque logical-viewer identity for its player. Every
session admission, including recovery and failover, carries the same
`Macha-Viewer-Session` so the cluster retains one transcode entitlement across
pipeline and node changes. Idempotency is operation-scoped: a distinct POST
receives a new key, while endpoint retries of that POST retain it.

Generations are ordered: a replacement cannot acquire a new lease until the
prior coordinator has finished teardown. Persisted queue and progress state is
resumable history, never proof of a live lease.

Replacing a *playing* generation without an interruption is described in
[playback handover](playback-handover.md).

### Preparation

Local player preparation consumes one normalized technical profile regardless of
where its facts came from. An immutable catalogue profile may arrive while the
detail screen is open and opportunistically wires the reusable media element and
starts the runtime's single cached capability probe. The session response always
supplies the authoritative fallback and augments the same preparation with
negotiated mode, MIME type, output format and source size. Neither path waits
for the other, and profile absence never delays the session POST. Source
acquisition begins only once the session returns its capability URL.

Profile consumers are cancellable. Leaving or replacing a detail view detaches
the consumer immediately so a stale result cannot prepare the wrong media. Up to
two consumerless profile requests continue as a bounded corpus-building tail;
further abandonment aborts the oldest.

### Invariants

- `PlaybackRuntime.phase === 'idle'` implies no owned coordinator, session or
  source acquisition.
- Viewer demand is never queued behind caching, bookkeeping or speculative work.
- Catalogue-derived preparation is idempotent and advisory; session-derived
  preparation is always sufficient alone.
- Play, pause and any seek representable by the active generation are local
  transport commands. A server playback update requests a new generation and is
  not a transport operation.
- Newer user intent supersedes older intent while server work is in flight.
- Buffering is observable state, never a lock that disables or serializes
  controls.
- Exit performs best-effort explicit session teardown; server idle expiry is the
  crash and network-loss fallback only.

### Transformed playback on Web and Android TV

hls.js/MSE with a bounded forward buffer. Pause freezes presentation without
stopping acquisition: in-flight fragments finish and the buffer continues
filling to its ceiling so Resume stays local. Healthy playback owns no standby.

HLS network evidence may open a recovery window in which one alternate
generation is created and its manifest, initialization data and first segment
are preflighted without attaching a second decoder. If the primary continues the
alternate is closed; if it fails the prepared generation is promoted. Fatal
media recovery must demonstrate playback progress before another is allowed.
Proven decoder or unsupported-source failures are terminal and do not condemn a
healthy endpoint.

Attempt, stall and segment-hold budgets come from the serving node through
`PlaybackSource.budgets`, which core derives from what each node reports. The
client's own constants are the fallback for a node that does not state them, and
absence lengthens a budget rather than shortening it.

### Direct Play

Direct Play starts and retains exactly one session while its source is healthy.
Its rolling read-ahead Service Worker treats pause as acquisition-active: it
preserves in-flight ranges and continues contiguous reads to the bounded cache
frontier. Only new viewer demand, seeking, source replacement, release or
failure interrupts speculative work.

A failed speculative range read is non-terminal node-health evidence: buffered
playback continues while the client creates at most one byte-compatible
alternate for a recovery window. Cleanup of the superseded session begins only
after replacement bytes are buffered, and retries with backoff. Immutable media
identity, size and MIME compatibility are required before any handoff.

Read-ahead is optional. If the Service Worker is not already usable, playback
takes the native URL immediately.

### Samsung

The Samsung target keeps the native HLS path with MPEG-TS segments. It has no
degradation channel and prepares no standby; a stall watchdog stands in for one,
and the client holds a native source until the node will actually serve its
first fragment, because a native player handed a not-yet-ready playlist reports
a permanent network failure the coordinator can only read as node failure.

## Catalogue

A series page loads its series record and direct season children; a season page
loads its direct episode children. This maps onto Macha's `parent_id` hierarchy
and keeps catalogue work proportional to what is on screen.

Season pages prefer season artwork and fall back to series artwork. Episode
cards prefer still or thumbnail artwork.

Artwork is a non-critical, content-addressed data plane. Near-viewport requests
are triggered by `IntersectionObserver` rather than scroll polling, so a card
revealed by any layout change is never missed. Demand for the same immutable
artwork ID is coalesced and successful Blobs remain cached across authoritative
endpoint changes. There is no client-side concurrency cap; the browser's
connection management governs that. Each node attempt has a bounded deadline,
and a node-local `404` searches the remaining nodes without changing API
authority or declaring the responding node unhealthy. Network exhaustion and
decode failures cool down and re-arm only while the card is again near the
viewport. These are diagnostic events, not global UI errors.

## Routing

The React application owns URL routes. Browser Back and Forward work on Web
without special state handling; packaged Android and Samsung builds use hash
routing so navigation stays inside the application asset.

Music, Status and Manage expose secondary routes through one shared shell
navigation row, styled and focused like the primary navigation. Status is
partitioned into Overview, Client, Connectivity and Nodes; the Client route is
strictly local and neither waits for nor polls cluster status. Node detail
routes stay within the Nodes context.

Production hosting must fall back to `index.html` for unknown application paths.

## TV focus navigation

Samsung and Android D-pad focus use a shared geometry-based spatial model.
Candidates must lie in the requested direction and are scored by primary-axis
distance, secondary-axis distance and a penalty for leaving the current visual
lane. Where a constrained browser has not produced usable geometry, DOM order is
the fallback.

Visible full-player chrome is scoped independently of the current page. Active,
selected and explicit default focus are preferred before the first control. Text
editors, selects and focused playback ranges retain native key ownership rather
than participating in spatial movement.

## Managing records

One idiom for everything the viewer manages — accounts, files, playlists,
unmatched media.

A **list** presents records compactly and read-only: identity, a one-line
summary, and an actions menu. **A row contains no inputs.** An editable field in
a list can be changed by accident, makes every row as tall as its longest form,
and forces each row to carry its own busy, dirty and error state.

Every mutation opens a **dialogue**: `FormModal` to edit, `ConfirmModal` to
destroy. The dialogue owns the form, the busy state and the failure, and stays
open when the server refuses, because a dialogue that closes on failure takes
the explanation with it. Field-level errors sit beside their field; the
dialogue's own error slot is for failures with no field to sit against.

Two rules follow from the television, which has no pointer:

- The row itself is the edit control, not a separate button beside it.
  Secondary and destructive actions go in the row's overflow menu.
- Every control carries `data-tv-focusable="true"`, including inside a dialogue.

Acts with different consequences get different dialogues rather than more fields
in one. Setting an account's password signs that account out everywhere, so it
is not part of editing the account.

Browser `alert`, `confirm` and `prompt` are not used: they are visually
inconsistent, block the event loop, and give no reliable Web or TV focus
behaviour.

## Android TV shell

A thin full-screen WebView shell around the Android-mode bundle, using hash
routing, the shared D-pad model and hls.js/MSE. The shell holds
`AUDIOFOCUS_GAIN` and `FLAG_KEEP_SCREEN_ON` while in front. A future Media3 host
would sit behind the existing `Platform`/`Player` boundary and would not require
a second UI.

## Rules

- The client does not know about DHT extents, replicas, peers or routing.
- The catalogue wire model mirrors Macha rather than inventing a client-specific
  server API.
- The client never transcodes.
- The client chooses Direct Play first, remux second, transcode only when
  required, from its own measured capabilities.
- Anything a non-DOM client would also need belongs in
  `@machafoundation/core`.
- Platform-specific code is restricted to capabilities, playback, application
  lifecycle and remote-key integration.
- React owns browsing, routes, search, hierarchy, focus navigation and playback
  chrome. It does not own playback resources.
- Continue Watching is installation-local, bounded to three unfinished items,
  and never uploaded.
- There is no cloud service, account system, advertising, recommendation engine,
  social activity or global watchlist.
