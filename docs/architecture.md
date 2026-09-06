# Architecture

The [Macha principles and scheduling laws](principles-and-laws.md) are
non-negotiable constraints on this architecture. In particular, control and
viewer work must remain responsive independently of catalogue artwork, ingest,
diagnostics and speculative activity.

Destructive and security-sensitive actions use the application's reusable,
focus-managed confirmation modal. Browser `alert`, `confirm` and `prompt`
dialogs are not part of the client UI: they are visually inconsistent, block
the event loop and do not provide reliable Web/TV focus behaviour.

Cluster transport exhaustion is an application-level state, not a screen-level
error. Only the dedicated background health scan may publish that transition,
and only after every configured endpoint fails its independent status request;
an exhausted foreground catalogue, profile, artwork or management operation
cannot infer a cluster-wide outage. While a player owns playback, connection
recovery UI is deferred so neither playing nor paused presentation is unmounted.
Recovery is cancelled if any endpoint responds before playback ends. Otherwise,
after playback closes the application mounts only the Connection gate at
`/manage/settings/connection`; normal API consumers remain unmounted until at
least one proposed endpoint passes a bounded check. With no stored endpoints,
the same locked gate is presented as first-run Welcome setup.

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
          Web          Android             Tizen
    video + hls.js  WebView HTML media   AVPlay stub
```

The server owns playback negotiation and media transformation. The client owns controls and reports platform capabilities. Configured API URLs seed a client-owned endpoint registry and one shared router used by catalogue, status, management, import and playback. The endpoint that most recently completed real work is the client's authoritative API endpoint and is tried first. On retryable failure, the first working alternative becomes authoritative for subsequent work. The client checks every known API endpoint immediately and at a bounded interval, but probe completion updates health only and never displaces authority. Health-probe HTTP requests are never wired to playback, component-lifecycle or client timeout cancellation; an obsolete monitor may ignore its eventual result, but cancellation itself is never node-health evidence. The same rule applies to routed work: `AbortError` represents local client intent and cannot demote an endpoint or trigger cluster-unreachable state. Node identity and API endpoint identity remain separate because one node may advertise several reachable API bases.

The Android TV package is a thin full-screen WebView shell around the Android-mode shared bundle. It uses hash routing, the common deterministic D-pad model and WebView's HTML media pipeline. The future Media3 host remains behind the existing `Platform`/`Player` boundary and does not require a second UI.

## Catalogue loading

A series page loads its series record and direct season children only. A season page loads its direct episode children. This maps directly to Macha's `parent_id` hierarchy and avoids eagerly loading every episode when opening a series.

Season pages prefer season artwork and fall back to series artwork. Episode cards prefer `still`/thumbnail artwork.

Artwork is a non-critical, content-addressed data plane. Near-viewport requests
are triggered by the browser's own IntersectionObserver rather than hand-rolled
scroll/resize polling, so a card revealed by any layout change is never missed.
Demand for the same immutable artwork ID is coalesced and successful Blobs
remain cached across ordinary authoritative-endpoint changes. There is no
client-side concurrency cap on artwork transfers; the browser's own connection
management governs that. Each node attempt has a bounded deadline, and a
node-local `404` searches the remaining nodes without changing API authority or
declaring the responding node unhealthy. Exhausted network and browser-decode
failures cool down and re-arm only while the card is again near the viewport.
These transitions are diagnostic events, not global UI errors.

## Routing

The shared React application owns URL routes. Browser Back/Forward works on Web without special state handling; packaged Android and Samsung clients use hash routing so navigation remains inside the application asset.

Music, Status and Manage expose first-class secondary routes through one shared
shell navigation row styled and focused like the primary navigation. Status is
partitioned into Overview, Client, Connectivity and Nodes rather than one long
document; the Client route is strictly local and neither waits for nor polls
cluster status. Node detail routes remain within the Nodes navigation context.

Production web hosting must fall back to `index.html` for unknown application paths.

## TV focus navigation

Samsung and Android D-pad focus use the shared geometry-based spatial model.
Candidates must lie in the requested direction and are scored by primary-axis
distance, secondary-axis distance and an increased penalty for leaving the
current visual lane. If a constrained browser has not produced usable geometry,
DOM order is the fallback. The newer row/group and per-route focus-memory model
was removed after on-device UAT found it materially worse.

Visible full-player chrome is scoped independently from the current page.
Active, selected and explicit default focus are preferred before the first
control. Text editors, selects and focused playback ranges retain native key
ownership rather than participating in spatial movement.

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

The runtime also creates one opaque logical-viewer identity for its persistent
player. Every session admission associated with that player—including recovery
and failover admissions—carries the same `Macha-Viewer-Session` value so the
cluster retains one transcode entitlement through physical pipeline and node
changes. This identity is runtime-local and has no management/auth semantics.
Idempotency remains operation-scoped: a distinct POST receives a new key, while
endpoint retries of that POST retain it.

Local player preparation consumes one normalized technical profile regardless of
where its facts originated. An immutable catalogue profile may arrive while the
detail screen is open; it opportunistically constructs and wires the reusable
media element and starts the runtime's single cached platform-capability probe.
The session response always supplies the authoritative fallback and augments the
same preparation with negotiated mode, MIME type, output format and source size.
Neither path waits for the other, and catalogue profile absence never delays the
session POST. Source-specific acquisition still begins only after the session
returns its capability URL.

Profile consumers are cancellable. Leaving or replacing a detail view detaches
that consumer immediately so a stale result cannot prepare the wrong media. Up
to two consumerless immutable-profile requests may continue as a bounded
corpus-building tail and populate the positive client cache; further abandonment
aborts the oldest tail request. Cancellation halts cluster endpoint traversal
without treating a deliberately cancelled request as node failure.

Resource-changing generations are ordered: replacement cannot acquire a new server lease until the prior coordinator has completed teardown. Persisted queue/progress state is resumable history, not proof that a live playback lease exists. `PlaybackCoordinator` remains the sole owner of playback intent within the active generation, so transport controls stay independent from source preparation.

The invariants are:

- `PlaybackRuntime.phase === 'idle'` implies no owned coordinator/session/source acquisition.
- Viewer demand is never queued behind caching, session bookkeeping or speculative work.
- Catalogue-derived local preparation is idempotent and advisory; session-derived preparation is always sufficient on its own.
- Play, pause and any seek representable by the active source generation are local transport commands.
- A server playback update is a request for a new source generation, not a transport operation.
- Newer user intent supersedes older intent while server work is in flight; intermediate generations are not needlessly attached.
- Modern Web transformed playback uses hls.js/MSE with a bounded forward buffer. Pause freezes presentation without stopping acquisition: in-flight fragments finish and managed HLS continues filling to its configured buffer ceiling so Resume remains local whenever possible. Healthy playback owns no standby session. HLS network evidence may open a 30-second recovery window in which one alternate generation is created and its manifest, initialization data and first segment are preflighted without attaching a second decoder. If the primary continues, the unused alternate is closed; if it fails, the prepared generation is promoted permanently. Fatal media recovery must demonstrate playback progress before another recovery is allowed. Proven decoder or unsupported-source failures remain terminal without condemning a healthy endpoint. Samsung keeps its legacy native-HLS path.
- Direct Play read-ahead is optional. If its Service Worker is not already usable, playback takes the native URL immediately.
- Cluster Direct Play starts and retains exactly one session while its source is healthy. Its rolling read-ahead worker treats Pause as an acquisition-active state: it preserves in-flight ranges and continues contiguous reads up to the bounded cache frontier. Only new viewer demand, seeking, source replacement, release or failure may interrupt speculative work. A failed speculative TCP/range read is non-terminal node-health evidence: buffered playback continues while the client creates at most one byte-compatible alternate for a 30-second recovery window. If unused it is closed; if promoted it remains the source. Cleanup of the superseded node-local session starts only after replacement bytes are buffered and retries with exponential backoff. Immutable media identity, size and MIME compatibility are required before any handoff.
- Buffering is observable state, never a lock that disables or serializes controls.
- Browser/app exit performs best-effort explicit session teardown; server idle expiry is only the crash/network-loss fallback.
