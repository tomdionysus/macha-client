# Architecture

The [Macha principles and scheduling laws](principles-and-laws.md) are
non-negotiable constraints on this architecture. In particular, control and
viewer work must remain responsive independently of catalogue artwork, ingest,
diagnostics and speculative activity.

```text
                          Macha node
                 distributed media + catalogue
                             |
       /api/v1/catalogue       /api/v1/playback
          JSON + artwork       sessions + streams
                |                    |
       MachaCatalogueApi     MachaPlaybackResolver
                |                    |
          MachaMediaApi       PlaybackResolver
                |                    |
                |             PlaybackRuntime
                |              /          \
                |   PlaybackCoordinator   Player
                |                    |       |
                +---------+----------+-------+
                          |
                  React presentation
              + browser-history router
                          |
           +--------------+--------------+
           |              |              |
          Web          Android          Tizen
    video + hls.js     Media3 stub     AVPlay stub
```

The server owns playback negotiation and media transformation. The client owns controls and reports platform capabilities. Configured API URLs seed a client-owned endpoint registry; safe reads and disposable playback generations can use any suitable candidate. The client checks every known API endpoint immediately and at a bounded interval so alternate reachability is known before an active endpoint fails. Probe completion does not displace the endpoint made sticky by real work. Node identity and API endpoint identity remain separate because one node may advertise several reachable API bases. Demo mode still uses a local sample file through the same resolver/player seam.

## Catalogue loading

A series page loads its series record and direct season children only. A season page loads its direct episode children. This maps directly to Macha's `parent_id` hierarchy and avoids eagerly loading every episode when opening a series.

Season pages prefer season artwork and fall back to series artwork. Episode cards prefer `still`/thumbnail artwork.

## Routing

The shared React application owns URL routes. Browser Back/Forward therefore works on Web without special state handling, and the same navigation model can be driven by Android/Tizen host keys later.

Production web hosting must fall back to `index.html` for unknown application paths.

## Rules

- The client does not know about DHT extents, replicas, peers or routing.
- The catalogue wire model mirrors Macha rather than inventing a client-specific server API.
- The client never transcodes.
- The server chooses Direct Play first, Remux second and Transcode only when required.
- Platform-specific code is restricted to capabilities, playback, application lifecycle and remote-key integration.
- React owns catalogue browsing, routes, search, hierarchy, focus navigation and playback chrome; it does not own playback resources.
- Continue Watching is installation-local state, bounded to three unfinished items and never uploaded.
- There is no cloud service, account system, advertising, recommendations, social activity or global watchlist.

## Playback critical path

Playback is intentionally split into two planes:

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

`PlaybackRuntime` is the application-scoped resource owner and playback state machine. It owns one platform `Player` and at most one `PlaybackCoordinator`; the coordinator in turn owns the active server playback-session lease and source-generation transitions. React renders snapshots and provides presentation hosts only. Full-screen/mini-player route changes may rebind the existing player surface, but they cannot create, replace or destroy playback sessions.

Resource-changing generations are ordered: replacement cannot acquire a new server lease until the prior coordinator has completed teardown. Persisted queue/progress state is resumable history, not proof that a live playback lease exists. `PlaybackCoordinator` remains the sole owner of playback intent within the active generation, so transport controls stay independent from source preparation.

The invariants are:

- `PlaybackRuntime.phase === 'idle'` implies no owned coordinator/session/source acquisition.
- Viewer demand is never queued behind caching, session bookkeeping or speculative work.
- Play, pause and any seek representable by the active source generation are local transport commands.
- A server playback update is a request for a new source generation, not a transport operation.
- Newer user intent supersedes older intent while server work is in flight; intermediate generations are not needlessly attached.
- Modern Web transformed playback uses hls.js/MSE with a bounded forward buffer; Pause stops managed HLS acquisition and Resume restarts it. Fatal media recovery must demonstrate playback progress before another recovery is allowed, and fatal network restart is bounded before alternate-node recreation. Typed stream failures may trigger node failover; proven decoder or unsupported-source failures remain terminal without condemning a healthy endpoint. Samsung keeps its legacy native-HLS path.
- Direct Play read-ahead is optional. If its Service Worker is not already usable, playback takes the native URL immediately.
- Cluster Direct Play starts the primary source immediately and negotiates at most one byte-compatible standby in the background. The Service Worker retains one `video.src` and can continue an exact range at the next byte through that alternate after a retryable header or body failure; immutable media identity, size and MIME compatibility are required before registration.
- Buffering is observable state, never a lock that disables or serializes controls.
- Browser/app exit performs best-effort explicit session teardown; server idle expiry is only the crash/network-loss fallback.
