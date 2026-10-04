# Architecture

The [principles and laws](principles-and-laws.md) constrain everything here.

## Layers

```text
                          Macha cluster
                             |
       /api/v1/catalogue       /api/v1/playback
                |                    |
  ==============|====================|=============== @machafoundation/core
       MachaCatalogueApi     ClusterPlaybackResolver
                |                    |
          MachaMediaApi         PlaybackRuntime
                |                /          \
                |   PlaybackCoordinator   Player (interface)
  ==============|====================|=======|======= macha-client
                +---------+----------+-------+
                          |
               React presentation + router
                          |
           +--------------+--------------+
          Web          Android TV      Samsung
    video + hls.js   WebView + hls.js  native HLS (MPEG-TS)
```

Core also holds the endpoint registry, health monitoring and failover, shared
with the React Native clients.

## Ownership

**The server serves facts; the client negotiates.** The server states what a
title is, what its streams are and what it can do. Core's chooser weighs that
against what the platform can decode and picks Direct Play, then remux, then
transcode, so every Macha client decides alike. The server performs the result.

**That includes which file.** An item can hold several files. The client
matches each file's facts to its capabilities and names the one to play
(`media_id`) on every session request. `src/App.tsx` hands core every file's
facts.

**Any node will do.** One endpoint registry, created in `src/App.tsx`, routes
every API. It is seeded in order: configured URLs, the page's own origin if it
is a Macha node and nothing is configured, then endpoints remembered from
earlier runs. The endpoint that last completed real work is tried first; on a
retryable failure the next working one takes over. Health probes update health
only and never change that order. A viewer's choice of node in the player is an
ordering preference, and playback moves there by starting a new stream on it.

**Cancellation is not health evidence.** An `AbortError` is local intent and
never demotes an endpoint. Node identity and API endpoint identity are separate:
one node may advertise several API addresses.

**Losing the whole cluster is an application state, not a screen error.** Only
the background health scan may declare it, after every endpoint fails its own
status request. While a player is up, recovery UI waits. Otherwise the app
shows only the Connection gate (`/settings/connection`) until an endpoint
answers; with no stored endpoints the same gate is first-run setup.

**One sign-in session.** Core's `SessionManager` holds it. Log out stops
playback first, because a playback session cannot be closed once its token is
revoked, then revokes and starts a fresh session.

**Every word a viewer sees is this client's.** Core supplies facts and codes;
`src/text/viewerText.ts` words them.

## Playback

```text
user intent ── play / pause / seek ───────────► active player, immediately
     └── needs a different stream? ───────────► server preparation
                                                     ▼
                                          newest stream ready
                                                     ▼
                                          apply the latest intent
```

`PlaybackRuntime` owns one platform `Player` and at most one
`PlaybackCoordinator`; the coordinator owns the server session and each
*generation* (one stream of one title from one node). React renders snapshots
and provides the surface. A route change may rebind the surface but never
creates or destroys a session.

A session belongs to the node that created it and counts against that node's
limits. A replacement generation waits for the previous coordinator's teardown.
Stored queue and progress are history, never proof of a live session.

Replacing a playing generation without interruption is covered in
[playback handover](playback-handover.md).

### Invariants

- `PlaybackRuntime.phase === 'idle'` means no coordinator, session or source.
- Viewer demand never queues behind caching, bookkeeping or speculative work.
- Play, pause and seeks within the active generation are local. A change that
  needs the server requests a new generation.
- Newer intent supersedes older intent while server work is in flight.
- Buffering is state to show, never a lock on the controls.
- Leaving the player deletes the session; server idle expiry is only the
  fallback for a crash or lost network.
- A media profile from the catalogue is advisory. The session response alone
  is always enough to play, and nothing waits for a profile.

### Web and Android TV

hls.js/MSE with a bounded forward buffer. Pause keeps filling the buffer so
Resume is local. Healthy playback holds no standby.

When HLS network errors suggest the node is failing, one alternate generation
is created and its manifest, init segment and first fragment are checked
without a second decoder. If the primary recovers the alternate is closed; if
it fails the alternate takes over. Decoder and unsupported-source failures are
terminal and do not mark a healthy node down.

Start, stall and segment timeouts come from the serving node
(`PlaybackSource.budgets`). The client's constants are the fallback, and a
missing value lengthens a timeout rather than shortening it.

### Direct Play

One session for as long as the source is healthy. The read-ahead Service Worker
keeps reading while paused, up to its cache limit; only new viewer demand, a
seek, a source change or a failure interrupts it. A failed read-ahead does not
stop playback: the client prepares at most one byte-identical alternate on
another node and releases the old session once replacement bytes are buffered.
If the Service Worker is not ready, playback uses the plain URL at once.

### Samsung

Native HLS with MPEG-TS segments, no standby, and a stall watchdog. A native
player given a playlist that is not ready reports a permanent failure, so the
player declares `needsProducedSource` and core withholds the source until the
node reports media produced.

## Catalogue

Pages load only what they show: a series its seasons, a season its episodes,
following `parent_id`.

Artwork is non-critical. Cards request it when near the viewport
(`IntersectionObserver`), identical requests are shared, and a node's `404`
tries the other nodes without marking that node unhealthy. Failures retry only
while the card is near the viewport and never surface as errors.

Each title carries an availability (`complete`, `partial`, `unavailable`,
`unknown`): how much of it reachable nodes hold. `src/components/Availability.tsx`
marks it; only `unavailable` titles cannot be played (core's `availableToPlay`).

## Routing

React Router owns the URLs; packaged builds use hash routing. Music, Import,
Status and Manage have secondary routes under one shared navigation row, and
records with their own page (a torrent, an unmatched file, a node) are reached
from their list. A static host must fall back to `index.html`.

## TV focus

Samsung and Android D-pad focus share one geometric model
(`src/hooks/useTvNavigation.ts`), judged from the focused element's edges. Left
and Right stay in the row and stop at its end; Up and Down go to the nearest
row. DOM order is the fallback where geometry is unusable. Text inputs, selects
and range controls keep their own keys, except that Up and Down always leave a
text input, since a D-pad has no other way out.

Every focusable control carries `data-tv-focusable="true"`.

## Managing records

One pattern for accounts, files, playlists and unmatched media:

- **Lists are read-only.** A row shows identity, a summary and an actions
  menu; its only input is a selection box. Shared parts are in
  `src/components/ListParts.tsx`, `ListSortControls.tsx`, `src/lists/` and
  `src/styles/lists.css`.
- **A record too big for a row gets its own page**, built from the same parts.
- **Every change opens a dialogue**: `FormModal` to edit, `ConfirmModal` to
  destroy. It stays open when the server refuses, so the reason is not lost.
- **The row is the edit control** (a television has no pointer); secondary and
  destructive actions go in its overflow menu.
- Acts with different consequences get different dialogues.
- No browser `alert`, `confirm` or `prompt`.

## Rules

- The client knows nothing of extents, replicas, peers or routing.
- The wire model mirrors the server's; no client-specific server API.
- The client never transcodes.
- Platform-specific code is limited to capabilities, playback, lifecycle and
  remote keys.
- React owns browsing, routes, focus and player chrome, not playback resources.
- Continue Watching is local to the installation, holds three unfinished
  items, and is never uploaded.
