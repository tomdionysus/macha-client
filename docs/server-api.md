# Macha server integration

The wire types and every HTTP adapter live in `@machafoundation/core`, not in
this repo: `CatalogueApi.ts` is the contract, `MachaCatalogueApi.ts` the
adapter, and the `Cluster*Api` classes route the same calls across endpoints.
React screens consume the higher-level `MediaApi` facade and never parse Macha
JSON directly.

## Catalogue

```text
GET /api/v1/catalogue/status
GET /api/v1/catalogue/items?type=show&parent=...
GET /api/v1/catalogue/search?q=<query>&limit=50
GET /api/v1/catalogue/items/{id}
GET /api/v1/catalogue/media/{media_id}/profile
GET /api/v1/catalogue/artwork/{sha256}
```

The server also exposes catalogue mutation and artwork upload endpoints, which
this client does not use.

List and search responses are wrapped as `{ "items": [] }`. An item is:

```json
{
  "id": "episode-id",
  "kind": "episode",
  "title": "Episode title",
  "sort_title": "Episode title",
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
  "artwork": [{ "role": "still", "id": "<sha256>", "mime_type": "image/jpeg" }],
  "revision": 1,
  "updated_ns": 0
}
```

Kinds are `movie`, `show`, `season`, `episode`, `artist`, `album` and `track`.

### Hierarchy

Hierarchy is expressed through `parent_id`. A series page retrieves the show and
lists seasons with `type=season&parent=<show-id>`; a season page retrieves that
season and lists episodes with `type=episode&parent=<season-id>`. No
client-specific nested response or Home endpoint is required.

### Dates

The catalogue wire model has `year` and no full release or air date. The UI
treats a full date as optional and shows a placeholder when absent. No
provisional wire field is assumed.

### Immutable media profiles

`GET /api/v1/catalogue/media/{media_id}/profile` is requested only for immutable
`macha:` identities. A positive schema-v1 response is checked against the
requested identity, coalesced, and cached by that identity; mutable paths are
never profile keys. `202 profile_pending`, `404 profile_not_available` and
generic route 404s are temporary negatives and are not cached. Detail screens
add duration, dimensions, codecs and bitrate asynchronously.

**A profile is never a playback-admission dependency.** The client performs no
profile preflight and begins session negotiation regardless of whether a profile
GET has returned. Session creation must proceed through the server's normal
planning fallback; a session response of `425 profile_pending` is non-conforming
and is treated as an endpoint failure, retried on another node under the same
`Idempotency-Key`, and never polled in the viewer path.

## Authentication

Where `catalogue.api.token_file` is configured on the node, every request
carries `Authorization: Bearer <token>`. The token is stored locally and sent
only to configured or cluster-advertised Macha API endpoints.

Artwork is fetched with `fetch()` and converted to an object URL rather than
placed in `<img src>`, because an image element cannot attach the header.

Stream and subtitle URLs returned on the session are capability URLs, taken
whole and loaded *without* the Bearer token. The client composes no stream or
segment path of its own, so the server moving streams under
`/api/v1/playback/sessions/{id}/stream/...` changes nothing here.

## Endpoints and discovery

Configured API URLs are bootstrap seeds, not an authoritative membership list.
The client keeps the last successful endpoint sticky and may refresh discovered
candidates without persisting them as user configuration.

Cluster transport addresses, such as the status `host` and `port` fields, are
not HTTP API advertisements, and the client never infers an API URL from them.

A client served from a node's own origin confirms that origin before offering an
endpoint form, and requires a JSON body whose `status` is `ok`, `starting` or
`failed` and whose `service`, when present, is `macha`. A `200` alone is not
sufficient, because a static host serving this bundle answers `200` for unknown
paths by design.

## Playback

```text
GET    /api/v1/playback/status
POST   /api/v1/playback/sessions
GET    /api/v1/playback/sessions/{id}
PATCH  /api/v1/playback/sessions/{id}
DELETE /api/v1/playback/sessions/{id}
```

Session creation sends the catalogue `item_id`, the resume or start position as
`seek_ms`, and the platform capability profile: direct containers and codecs,
fMP4 HLS support, and optional decoder resolution limits where a platform can
report real ones. The Web client does not use screen dimensions as decoder
limits.

**Positions on the wire are integer milliseconds.** The client rounds before
sending; sub-millisecond precision against a node that answers in whole
milliseconds cannot be reconciled and prevents activation entirely.

The response is authoritative and separates `preferences` (what the user
selected), top-level `mode` (what negotiation resolved), `source` (original
container and elementary streams), `output` (copy or transcode per selected
stream), `selection`, `stream`, and server-generated `options`.

### Where a generation begins

Three fields describe the relationship between what was asked for and what the
generation contains:

| field | meaning |
| --- | --- |
| `seek_ms` | where the generation's media begins — the first sample the client receives, and the generation's clock origin |
| `seek_offset_ms` | how far into that generation the requested position sits; never negative |
| `seek_requested_ms` | the position the server honoured, after clamping |

`seek_ms + seek_offset_ms == seek_requested_ms`, exactly. `seek_requested_ms`
exists so a client can distinguish a violation from an ordinary clamp near the
end of a title.

Per mode: **transcode** begins on the requested frame with a zero offset;
**remux** begins at the last keyframe at or before the request and carries the
remainder as the offset, because a stream copy has no decoder and an fMP4
fragment must begin on a sync sample; **direct** has no generation.

The offset is fetched but never presented — the client attaches *at* the offset.
`seek_offset_ms` and `seek_requested_ms` are optional, and absent means the node
cannot say rather than zero. Core consumes all three and hands the player a
generation-local position; the client does not apply the offset a second time.

### Budgets

Per-node entries of `GET /api/v1/status` carry a `playback` object beside
`runtime`:

```json
"playback": {
  "startup_timeout_ms": 15000, "segment_timeout_ms": 6000,
  "session_idle_ms": 1800000, "pipeline_idle_ms": 60000,
  "transcode_entitlement_idle_ms": 300000,
  "max_sessions": 64, "max_sessions_per_account": 32
}
```

`startup_timeout_ms` is how long that node may take to bring a transformed
generation's first fragment up; `segment_timeout_ms` is how long it holds a
request for a fragment not yet ready. Each is that node's statement about
itself. Absence means the node cannot say, never a default, and a client must
not shorten a budget on a missing field or substitute another node's figure.
The rest of the object (server 0.48.2) states the node's idle reaping and its
caps; core reads the two timeouts and deliberately not `session_idle_ms`.

Core derives per-endpoint budgets from these and passes them to the player on
`PlaybackSource.budgets`.

### Sessions and generations

A session is bound to the node that created it: the session map is in-process
and node-local, with no replication and no control-call forwarding, so a move
to another node is create-there, promote, release-here. Admission is per bearer
token against the creating node's `max_sessions_per_account` (server 0.48.0;
`429 account_session_limit`, which core walks to the next node and charges to
nobody), its node-wide `max_sessions` and its transcode limits (`429
resource_limit`, which is the node being full). A session's transcode
entitlement is released after `transcode_entitlement_idle_ms` without stream
activity; the session record lives until `session_idle_ms` and answers `404`
after that. Core no longer sends `Macha-Viewer-Session`, which the server has
retired and does not read, nor `Idempotency-Key`.

`PATCH` performs source-generation changes: mode, quality limits, audio stream,
subtitle stream, media representation, and a transformed seek whose target lies
outside the active generation. Direct seeks and transformed seeks *inside* the
active generation are local player operations and never reach the server. A
subtitle-only PATCH returns an authoritative session whose A/V stream and
generation are unchanged, and the client replaces only `stream.subtitle_url`;
that URL is a segmented WebVTT manifest, and the player fetches only the
segments around its current position.

Direct mode is handed to the platform player. Remux and transcode return fMP4
HLS. Web and Android TV use hls.js/MSE so the client controls a bounded forward
buffer and nearby seeks stay in browser memory; Samsung uses native HLS with
MPEG-TS segments.

The client deletes the session explicitly when leaving the player.

### Controls

Quality availability is not derived locally. `quality_heights`,
`audio_streams`, `subtitle_streams` and `media_ids` drive those controls, and
`options.modes` drives Remux and Transcode availability. Direct is always
offered beside Auto as an explicit override and is sent even when capability
negotiation omitted it from `options.modes`.

Source and copied elementary-stream bitrates are displayed when supplied.
Transcoded output is displayed from the actual output description, and an
unknown CRF video bitrate is left unknown rather than inferred.

Audio controls expose server-advertised tracks and display the independently
resolved `output.audio.transform`. A session reports `transcode` when any stream
is encoded, so video copy with audio transcode is a legitimate combination and
is displayed as negotiated; the preference schema has no per-stream transform
override and the client does not invent one.

## Continue Watching

Deliberately not a server API. It is local client state: at most three items, an
item appears after 30 seconds, it is removed at 92% completion, and there is no
account, identity or progress upload.

## Cluster status and management

```text
GET  /api/v1/status
GET  /api/v1/status/nodes/{node_id}
POST /api/v1/status/connectivity/check
POST /api/v1/status/nodes/{node_id}/connectivity/check
```

Node observations distinguish `live`, `stale` and `last_known`. Cluster storage
and cache totals distinguish known capacity from currently online capacity.

Administrative mutations use the management namespace:

```text
GET  /api/v1/manage
POST /api/v1/manage/identity-associations/reset
POST /api/v1/manage/nodes/{node_id}/identity-association/reset
```

The general reset requires only a host or IP; port and node ID are optional, so
an obsolete association can be cleared after the node identity is unknown, and
omitting the port clears all ports on that host. It deletes no persisted node
state or MachaDFS data and is guarded by an explicit confirmation.

## Roles

Roles are capabilities, not a ladder: `media_viewer`, `importer`, `manager`,
`manage_users`. They are resolved server-side when a session is minted, so the
array is closed and the client neither expands nor infers it. A capability the
server did not name is one the session does not have.

Protected accounts are identified by the per-record `mutable` block — `rename`,
`delete`, `set_password`, `set_roles` — never by username. An absent `mutable`
block means the node did not say, which is not the same as refused.

`401` means re-mint; `403` is terminal and must never trigger a re-mint.
