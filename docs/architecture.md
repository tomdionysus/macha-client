# Architecture

The [Macha principles and scheduling laws](principles-and-laws.md) are
non-negotiable constraints on this architecture. In particular, control and
viewer work must remain responsive independently of catalogue artwork, ingest,
diagnostics and speculative activity.

Destructive and security-sensitive actions use the application's reusable,
focus-managed confirmation modal. Browser `alert`, `confirm` and `prompt`
dialogs are not part of the client UI: they are visually inconsistent, block
the event loop and do not provide reliable Web/TV focus behaviour.

## Records are listed compactly and edited in a dialogue

This is the client's single idiom for anything the viewer manages — accounts,
files, playlists, unmatched media — and it is one design language rather than
a preference per screen.

A **list** presents records compactly and read-only: identity, a one-line
summary of the record's state, and an actions menu. **A row contains no
inputs.** An editable field sitting in a list is a control the viewer can
change without meaning to, it makes every row as tall as its longest form, and
it forces each row to carry its own busy state, dirty state and error slot —
which is how a management screen becomes a wall.

Every mutation opens a **dialogue**: `FormModal` for editing, `ConfirmModal`
for a destructive act. The dialogue owns the form, the busy state and the
failure. It stays open when the server refuses, because a dialogue that closes
on failure takes the only explanation with it. Field-level errors sit beside
the field that caused them — the dialogue's own error slot is for the failure
with no field to sit against.

Two rules follow from the television, where there is no pointer:

- The row itself is the edit control, not a separate "Edit" button beside a
  name that does nothing. Two adjacent targets for one idea costs a D-pad stop
  to reach the half that works. Secondary and destructive actions go in the
  row's overflow menu.
- Every control carries `data-tv-focusable="true"`, including the ones inside
  a dialogue.

Acts with different consequences get different dialogues rather than more
fields in one. Setting an account's password is not part of editing it: it
signs that account out everywhere, and burying it in the middle of an edit
form is how somebody does it by accident.

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

The endpoint registry, health monitoring and failover sit alongside the API
layer in `@machafoundation/core` and are shared with the React Native clients, which
reuse none of this repo's presentation.

The server owns media transformation and obeys; the client negotiates. The client reports what its platform can actually decode and chooses Direct Play, remux or transcode from that — a decision made in `@machafoundation/core` so that every Macha client makes it identically. Configured API URLs seed a client-owned endpoint registry and one shared router used by catalogue, status, management, import and playback. The endpoint that most recently completed real work is the client's authoritative API endpoint and is tried first. On retryable failure, the first working alternative becomes authoritative for subsequent work. The client checks every known API endpoint immediately and at a bounded interval, but probe completion updates health only and never displaces authority. Health-probe HTTP requests are never wired to playback, component-lifecycle or client timeout cancellation; an obsolete monitor may ignore its eventual result, but cancellation itself is never node-health evidence. The same rule applies to routed work: `AbortError` represents local client intent and cannot demote an endpoint or trigger cluster-unreachable state. Node identity and API endpoint identity remain separate because one node may advertise several reachable API bases.

The Android TV package is a thin full-screen WebView shell around the Android-mode shared bundle. It uses hash routing, the common deterministic D-pad model, and hls.js/MSE — WebView 151 has MediaSource, and the managed path is also the only one that reports degradation, so it is the only one that can prepare a warm standby. The shell holds `AUDIOFOCUS_GAIN` and `FLAG_KEEP_SCREEN_ON` for as long as it is in front. A future Media3 host would sit behind the existing `Platform`/`Player` boundary and would not require a second UI. It is under consideration for one measured reason: Chromium ships no AC-3/E-AC-3 decoder, so 5.1 sources are force-transcoded and the channel layout is lost on the way to AudioFlinger — see `TODO/ACTIVE.md`.

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
- The client chooses Direct Play first, remux second and transcode only when required, from its own measured capabilities; the server supplies the facts and performs the work.
- Anything a non-DOM client would also need belongs in `@machafoundation/core`, not in this repo.
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
- Modern Web transformed playback uses hls.js/MSE with a bounded forward buffer. Pause freezes presentation without stopping acquisition: in-flight fragments finish and managed HLS continues filling to its configured buffer ceiling so Resume remains local whenever possible. Healthy playback owns no standby session. HLS network evidence may open a 30-second recovery window in which one alternate generation is created and its manifest, initialization data and first segment are preflighted without attaching a second decoder. If the primary continues, the unused alternate is closed; if it fails, the prepared generation is promoted permanently. Fatal media recovery must demonstrate playback progress before another recovery is allowed. Proven decoder or unsupported-source failures remain terminal without condemning a healthy endpoint. Samsung keeps its legacy native-HLS path with MPEG-TS segments, and therefore has no degradation channel and prepares no standby; a stall watchdog is what stands in for one there.
- Direct Play read-ahead is optional. If its Service Worker is not already usable, playback takes the native URL immediately.
- Cluster Direct Play starts and retains exactly one session while its source is healthy. Its rolling read-ahead worker treats Pause as an acquisition-active state: it preserves in-flight ranges and continues contiguous reads up to the bounded cache frontier. Only new viewer demand, seeking, source replacement, release or failure may interrupt speculative work. A failed speculative TCP/range read is non-terminal node-health evidence: buffered playback continues while the client creates at most one byte-compatible alternate for a 30-second recovery window. If unused it is closed; if promoted it remains the source. Cleanup of the superseded node-local session starts only after replacement bytes are buffered and retries with exponential backoff. Immutable media identity, size and MIME compatibility are required before any handoff.
- Buffering is observable state, never a lock that disables or serializes controls.
- Browser/app exit performs best-effort explicit session teardown; server idle expiry is only the crash/network-loss fallback.
