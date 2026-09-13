# Macha server integration

The client matches Macha's current catalogue HTTP API. **The wire types and every HTTP adapter live in `@machafoundation/core`** (`macha-ts/src/api/`), not in this repo: `CatalogueApi.ts` is the contract, `MachaCatalogueApi.ts` the adapter, and the `Cluster*Api` classes route the same calls across endpoints. React screens consume the higher-level `MediaApi` facade and never parse Macha JSON directly.

## Current endpoints

```text
GET /api/v1/catalogue/status
GET /api/v1/catalogue/items?type=show&parent=...
GET /api/v1/catalogue/search?q=expanse&limit=50
GET /api/v1/catalogue/items/{id}
GET /api/v1/catalogue/media/{media_id}/profile
GET /api/v1/catalogue/artwork/{sha256}
```

The server also exposes catalogue mutation and artwork upload endpoints, but the television client does not need them.

List and search responses are wrapped:

```json
{
  "items": []
}
```

A catalogue item is:

```json
{
  "id": "episode-id",
  "kind": "episode",
  "title": "Cooking the Books",
  "sort_title": "Cooking the Books",
  "synopsis": "...",
  "parent_id": "season-id",
  "year": 2000,
  "season_number": 1,
  "episode_number": 1,
  "disc_number": null,
  "track_number": null,
  "aliases": [],
  "external_ids": {},
  "media_ids": ["logical-media-id"],
  "artwork": [
    {
      "role": "still",
      "id": "<sha256>",
      "mime_type": "image/jpeg"
    }
  ],
  "revision": 1,
  "updated_ns": 0
}
```

Supported catalogue kinds are `movie`, `show`, `season`, `episode`, `artist`, `album` and `track`.

## Immutable media profiles

Server support for `GET /api/v1/catalogue/media/{media_id}/profile` is deployed
on the tested 0.22 nodes as of 2026-09-01. The client requests it
only for immutable `macha:` identities. A positive schema-v1 response is checked
against the requested identity, coalesced, and cached by that identity; mutable
paths are never profile keys. `202 profile_pending`, `404 profile_not_available` and generic route 404s
from older nodes are temporary negatives and are not cached. Detail screens add
the resulting duration, dimensions, codecs, and bitrate asynchronously, so
profile rollout cannot delay or disable existing playback-session negotiation.

Immutable profile state is not a playback-admission dependency. The client never
performs a profile preflight: it begins ordinary session negotiation regardless
of whether an independent profile GET returns `200`, `202 profile_pending`, a
temporary `404`, or remains in flight. Profile completion may update detail UI
later. Session creation must proceed through the server's normal media-engine
planning fallback and must not return `425 profile_pending`; asynchronous
profile-pending responses belong only to the optional profile GET (currently
`202 Accepted`). As mixed-version protection, the cluster client
treats such a non-conforming session response as an endpoint failure and may
continue on another node with the same logical `Idempotency-Key`; it never polls
the bad response in the viewer path.

## Hierarchy

Macha stores hierarchy through `parent_id`.

The series page retrieves the show and lists seasons with `type=season&parent=<show-id>`. It does not fetch episode lists.

The separate season page retrieves that season and lists episodes with `type=episode&parent=<season-id>`. This keeps the amount of catalogue work proportional to what is actually on screen.

The server therefore does not need a client-specific nested show response or a special Home endpoint.

## Dates

The current catalogue wire model has `year`, but no full release/air date. The UI deliberately treats `releaseDate` as optional and shows a placeholder when it is absent.

Server/provider TODO: add an optional full date to the catalogue model and populate it from TMDB movie `release_date`, series `first_air_date`, season `air_date` and episode `air_date`. No provisional wire field is assumed by this client until the server contract is changed. This work is tracked in the [active client roadmap](../TODO/ACTIVE.md).

## Authentication

If `catalogue.api.token_file` is configured on the node, every request uses:

```text
Authorization: Bearer <token>
```

Artwork is fetched with `fetch()` and converted to a local object URL. It is not placed directly in `<img src>`, because a normal image element cannot attach the Bearer header.

The token is stored locally by this client. It is sent only to configured or
cluster-advertised Macha API endpoints.

## Bootstrap and endpoint discovery

The configured API URLs are bootstrap seeds, not an authoritative membership
list. With the current server, the client tries those seeds directly and keeps
the last successful endpoint sticky. A future successful bootstrap response may
advertise durable node IDs and one or more browser-reachable API base URLs per
node; the client registry can refresh those discovered candidates without
persisting them as user configuration.

Cluster transport addresses such as the current status `host` and `port` fields
are not HTTP API advertisements. The client never guesses an API URL from them.
The future wire contract must explicitly identify client-facing HTTP(S) bases,
including any LAN/WAN or address-family alternatives and their validity period.

## Browser deployment

Macha does not currently serve the web application itself. The client talks to
explicitly configured Macha HTTP(S) API bases using the server's CORS support.
Blank or same-origin endpoint entries are invalid: the Web/Vite origin serves
only the client and is never probed as a Macha API.

Because the client now uses browser-history routes, a production static server must also return the application `index.html` for paths such as `/movies/<id>` and `/series/<id>/seasons/<id>`. This is a static-hosting concern, not a new catalogue endpoint.

## Continue Watching

Continue Watching is intentionally not a server API. It is local client state:

- maximum three items;
- item appears after 30 seconds;
- item is removed at 92% completion;
- no account or user identity;
- no progress upload.
## Playback

The player uses the server playback-session API rather than constructing media URLs itself:

```text
GET    /api/v1/playback/status
POST   /api/v1/playback/sessions
GET    /api/v1/playback/sessions/{id}
PATCH  /api/v1/playback/sessions/{id}
DELETE /api/v1/playback/sessions/{id}
```

Session creation sends the catalogue `item_id`, the latest resume/start position as `seek_ms`, and the platform capability profile: direct containers/codecs and fragmented-MP4 HLS support, plus optional decoder resolution limits when a platform can report real limits. The returned keyframe-aligned `seek_ms` is accepted as the immutable transformed generation origin; the client does not create a second startup generation merely to force exact alignment. The Web client deliberately does not use screen dimensions as decoder limits. The server response is authoritative and separates `preferences` (what the user selected), top-level `mode` (what negotiation resolved), `source` (original container and elementary-stream metadata), `output` (copy/transcode result for selected video/audio), `selection`, `stream`, and server-generated `options`.

Every playback-session `POST` carries `Macha-Viewer-Session`, an opaque identity
created once by the application-scoped persistent `PlaybackRuntime`. The value
is retained across source reloads, seeks, retries, representation changes,
standby preparation and node failover. It identifies one logical viewer and its
single transcode entitlement; it is not an account, authorization credential or
progress identity. Each distinct admission operation creates a fresh
`Idempotency-Key`, while retries of that same operation across endpoints retain
the key and exact request body. `PATCH` and `DELETE` continue to address the
returned playback session ID.

The client does not derive quality availability locally. `quality_heights`, `audio_streams`, `subtitle_streams` and `media_ids` drive those controls. `options.modes` drives Remux and Transcode availability, while Direct is always exposed next to Auto as an explicit user override and is sent to the server when selected even if capability negotiation omitted it from `options.modes`. Source and copied elementary-stream bitrates are displayed when supplied; transcoded output is displayed from the actual output description, and an unknown CRF video bitrate is left unknown rather than inferred.

The Audio controls always expose server-advertised audio tracks and display the independently resolved `output.audio.transform`. The current server preference schema does not expose a per-stream transform override, so mixed cases such as video copy + audio transcode are displayed when the server negotiates them but the client does not invent an unsupported “transcode audio only” PATCH field.

`PATCH` is used for source-generation changes: mode, quality limits, audio stream, subtitle stream, media representation, and the exceptional transformed seek whose target predates the active immutable HLS generation. Direct seeks and transformed seeks inside the active generation are local player operations and never PATCH transport state back to the server. A transformed source-generation change may replace the HLS generation while retaining the same logical session. Macha server 0.12 adds an in-place subtitle-only PATCH: the returned session is still authoritative, but its A/V stream URL/generation is unchanged and the client replaces only `stream.subtitle_url`. Current servers expose that URL as a Macha segmented-WebVTT manifest; the Web player fetches only subtitle segments around its current playback position.

Direct mode is handed straight to the platform player. Remux/transcode mode returns fragmented-MP4 HLS. Modern Web deliberately uses hls.js/MSE first so Macha controls a bounded forward VOD buffer and nearby seeks stay in browser memory; Samsung's legacy Chromium target keeps its native-HLS compatibility path.

The API Bearer token is attached to session create/control requests. Returned `/api/v1/playback/stream/...` and subtitle URLs are capability URLs and are loaded without the permanent Bearer token.

The client explicitly deletes the playback session when leaving the player.

## Cluster status and management

The Status section consumes the cluster status API rather than inferring server health from playback:

```text
GET  /api/v1/status
GET  /api/v1/status/nodes/{node_id}
POST /api/v1/status/connectivity/check
POST /api/v1/status/nodes/{node_id}/connectivity/check
```

Node observations explicitly distinguish `live`, `stale`, and `last_known`. Cluster storage/cache totals distinguish known capacity from currently online capacity.

Administrative mutations use the separate management namespace. The Status UI currently exposes the cluster-wide stale identity-association reset:

```text
GET  /api/v1/manage
POST /api/v1/manage/identity-associations/reset
POST /api/v1/manage/nodes/{node_id}/identity-association/reset
```

The general reset requires only a host/IP. Port and NodeId are optional so an obsolete association can still be cleared after the node identity is unknown; omitting the port clears stale associations for all ports on that host. The operation does not delete persisted node state or MachaDFS data and is guarded by an explicit confirmation in the UI.
