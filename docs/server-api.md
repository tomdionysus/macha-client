# Macha server integration

The wire types and every HTTP adapter live in `@machafoundation/core`, not in
this repo: `CatalogueApi.ts` is the contract, `MachaCatalogueApi.ts` the
adapter, and the `Cluster*Api` classes route the same calls across endpoints.
React screens consume the higher-level `MediaApi` facade and never parse Macha
JSON directly. The one exception is the subtitle segment manifest, which this
client parses itself (see Sessions and generations).

## Status codes and errors

From server 0.56.0 every JSON object response carries a top-level snake_case
`status`: `ok` on a success that does not state its own (the media profile's
`pending` is kept), and the error's code on an error. Errors keep the envelope
`{ "error": { "code", "message" } }`, with an optional `error.reason` and the
failure axes (`scope`, `node_healthy`, `alternative_may_succeed`); there is no
`error.detail`. The code is what a client acts on; the message is for people
and is never the only signal.

Ingest and torrent jobs, catalogue hints and status diagnostics carry
`error_code` beside `error`, a catalogue hint's `result` is a code rather than
a sentence, and a torrent submission that cannot be placed is `409
placement_failed` with `error.reason`. Core writes no viewer text; this client
words every one of these codes itself, in `src/text/viewerText.ts`.

## Catalogue

```text
GET    /api/v1/catalogue/status
GET    /api/v1/catalogue/items?type=show&parent=...
GET    /api/v1/catalogue/search?q=<query>&limit=50
GET    /api/v1/catalogue/items/{id}
GET    /api/v1/catalogue/media/{media_id}/profile
GET    /api/v1/catalogue/artwork/{sha256}?exp=...&sig=...
PUT    /api/v1/catalogue/items/{id}
DELETE /api/v1/catalogue/items/{id}/metadata
POST   /api/v1/catalogue/items/{id}/artwork?role=...&mime=...
```

The three mutations belong to the metadata editor and manual matching, and
need the `manager` role. `PUT` and `DELETE .../metadata` send `If-Match:
"rev-<revision>"`; a stale revision is `409 conflict`.

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
  "artwork": [{
    "role": "still", "id": "<sha256>", "mime_type": "image/jpeg",
    "url": "/api/v1/catalogue/artwork/<sha256>?exp=...&sig=..."
  }],
  "effective_artwork": [],
  "revision": 1,
  "updated_ns": 0
}
```

Kinds are `movie`, `show`, `season`, `episode`, `artist`, `album` and `track`.
`effective_artwork` is the server's resolved display artwork, derived and never
canonical metadata. Core makes each artwork `url` absolute against the node
that answered.

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
never profile keys. A node with no stored profile normally probes in the
foreground and answers `200`; `202` with `status: pending` and any `404` are
temporary negatives and are not cached, and the next node is asked. `422
profile_failed` means the file could not be probed on that node. Detail screens
add duration, dimensions, codecs and bitrate asynchronously.

**A profile is never a playback-admission dependency.** The client performs no
profile preflight and begins session negotiation regardless of whether a profile
GET has returned; the instruction chooser reads the playback facts endpoint
instead (see Playback). A session response of `202` with code `profile_pending`
is non-conforming, and no current server sends one; core treats it as an
endpoint failure, retries on another node under the same `idempotency_key`, and
never polls it in the viewer path.

## Authentication

```text
GET    /api/v1/health
POST   /api/v1/session
GET    /api/v1/session
DELETE /api/v1/session
```

Every API request carries `Authorization: Bearer <token>`, where the token is a
session core mints and holds. It is sent only to configured or
cluster-advertised Macha API endpoints.

`POST /api/v1/session` is the one call without the header. Its body is `{}` for
the anonymous account or `{ "credentials": { "username", "password" } }`, and
it answers `201` with `token`, `expires_unix_ms`, `roles`, `username` and the
`password_policy`. Refusals are `401 invalid_credentials`, `403
anonymous_disabled`, and `429 try_later` or `too_many_sessions`. A mint creates
a session, so it is never hedged: on a fresh sign-in or a cold start with no
endpoint evidence, core first asks `/api/v1/health` (no token, no role) which
node answers, and mints there. A session minted on any node is valid
cluster-wide.

`GET /api/v1/session` validates a cached token and returns the session record,
roles included; it is the one route that needs a valid session and no role.
Core hedges it across nodes, and `401` or `403` means the token is unusable and
a fresh mint follows. `DELETE /api/v1/session` revokes the token (`204`) and is
what sign-out does; dropping the token locally is not a logout.

Catalogue artwork is loaded from the signed capability URL on each artwork
entry, placed directly in `<img src>` and sent *without* the Bearer token. The
signature covers the artwork id and expiry, never the host, so one URL is good
on every node, and core keeps asking whichever node last served artwork so a
pre-emptive endpoint swap does not rename every poster. The expiry is quantised
to the capability TTL, 30 days by default from server 0.54.1, and the response
is `Cache-Control: public, max-age=<ttl>, immutable` with the artwork id as
`ETag`; a matching `If-None-Match` is answered `304` without reading the
artwork. Only the metadata editor fetches artwork by id with the header, via
`fetch()` and an object URL.

Stream and subtitle URLs returned on the session are capability URLs, taken
whole and loaded *without* the Bearer token. The client composes no stream path
of its own, so the server moving streams under
`/api/v1/playback/sessions/{id}/stream/...` changes nothing here. Subtitle
segments are the one derived path: `segment-<n>.vtt`, resolved relative to the
manifest URL.

## Endpoints and discovery

Configured API URLs are bootstrap seeds, not an authoritative membership list.
The client keeps the last successful endpoint sticky and may refresh discovered
candidates without persisting them as user configuration.

Discovery reads each online node's `api_endpoint` from `GET /api/v1/status`,
the whole URL the node says to dial. Cluster transport addresses, such as the
status `host` and `port` fields, are not HTTP API advertisements, and the client
never infers an API URL from them.

Every 10 seconds core probes each endpoint's `GET /api/v1/health`, which needs
no token and no role, falling back to `/api/v1/catalogue/status` for a node too
old to have the route. `200` is serving; a `503` is a node that answered, not
an unreachable one.

A client served from a node's own origin confirms that origin against
`/api/v1/health` before offering an endpoint form, and requires a JSON body
whose `status` is `ok`, `starting`, `failed` or `busy` (server 0.43.0, with
`Retry-After`) and whose `service`, when present, is `macha`. A `200` alone is
not sufficient, because a static host serving this bundle answers `200` for
unknown paths by design.

## Playback

```text
GET    /api/v1/playback/status
GET    /api/v1/playback/media?item_id=...
POST   /api/v1/playback/sessions?idempotency_key=...
GET    /api/v1/playback/sessions/{id}
PATCH  /api/v1/playback/sessions/{id}
DELETE /api/v1/playback/sessions/{id}
```

The server does not ask what a client can play (server 0.32.16); the client
decides and the server performs. Before creating a session, core reads
`GET /api/v1/playback/media` for the item: its container and streams, and the
node's `operations`, meaning whether it can serve direct, copy video or audio
into fMP4 or MPEG-TS, and transcode video or audio. It weighs those against the
platform's capabilities, including decoder resolution limits where a platform
can report real ones; the Web client does not use screen dimensions as decoder
limits. With no facts, core asks for `transcode`.

Session creation sends the catalogue `item_id`, the resume or start position as
`seek_ms`, and `preferences`. `preferences.mode` is required and is `direct`,
`remux` or `transcode`; beside it go the per-stream `video` and `audio`
transforms (`copy` or `transcode`), the HLS segment `container` (`fmp4` or
`mpegts`), and any quality, audio and subtitle choices.

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
to another node is create-there, promote, release-here. Admission is per account
against the creating node's `max_sessions_per_account` (server 0.48.0;
`429 account_session_limit`, which core walks to the next node and charges to
nobody), its node-wide `max_sessions` and its transcode limits (`429
resource_limit`, which is the node being full). A session's transcode
entitlement is released after `transcode_entitlement_idle_ms` without stream
activity; the session record lives until `session_idle_ms` and answers `404`
after that. The idempotency key is the `idempotency_key` query parameter on
creation: one per start or regeneration, reused across every node that attempt
walks, and scoped per account by the server.

`PATCH` performs source-generation changes: mode, quality limits, audio stream,
subtitle stream, media representation, and a transformed seek whose target lies
outside the active generation. Direct seeks and transformed seeks *inside* the
active generation are local player operations and never reach the server. A
subtitle-only PATCH returns an authoritative session whose A/V stream and
generation are unchanged, and the client replaces only `stream.subtitle_url`.

That URL is a segmented WebVTT manifest, parsed by this client
(`validSubtitleManifest` in `src/platform/WebSubtitles.ts`): `format`
`macha-webvtt-segments`, `version` 1, an integer `stream_index` and a non-empty
`segment_durations_ms` of positive values. Anything else is refused as an
invalid manifest. The player fetches only the segments around its current
position. A URL ending in `.vtt` is an older server's single WebVTT file and is
loaded whole.

Direct mode is handed to the platform player. Remux and transcode return HLS,
in fMP4 segments or in MPEG-TS where `preferences.container` asks for it. Web
and Android TV use hls.js/MSE so the client controls a bounded forward buffer
and nearby seeks stay in browser memory; Samsung uses native HLS with MPEG-TS
segments.

The client deletes the session explicitly when leaving the player.

### Controls

Quality availability is not derived locally. `quality_heights`,
`audio_streams`, `subtitle_streams` and `media_ids` drive those controls, and
`options.modes` drives Remux and Transcode availability: the node always lists
`direct`, and adds `remux` and `transcode` where it can plan them. Direct is
always offered beside Auto as an explicit override.

Source and copied elementary-stream bitrates are displayed when supplied.
Transcoded output is displayed from the actual output description, and an
unknown CRF video bitrate is left unknown rather than inferred.

Audio controls expose server-advertised tracks and display the independently
resolved `output.audio.transform`. A session reports `transcode` when any stream
is encoded, so video copy with audio transcode is a legitimate combination and
is displayed as negotiated. The per-stream `video` and `audio` preferences come
from the instruction, not from a control of their own: core's chooser for Auto,
and `src/screens/player/modeTransforms.ts` for a mode press. The server refuses
`remux` with either stream transcoded, so a Remux press that cannot copy the
audio is sent as `transcode` with the video copied.

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

Reading status needs `view_status`; a connectivity check makes the node dial
its peers, so it needs `manager`. Node observations distinguish `live`, `stale`,
`last_known` and `unavailable`. Cluster storage and cache totals distinguish
known capacity from currently online capacity.

Library and node management use the management namespace:

```text
GET    /api/v1/manage/unmatched
GET    /api/v1/manage/unmatched/{id}
GET    /api/v1/manage/unmatched/{id}/matches?q=...
POST   /api/v1/manage/unmatched/{id}/retry
POST   /api/v1/manage/unmatched/{id}/match
POST   /api/v1/manage/unmatched/{id}/manual
DELETE /api/v1/manage/unmatched/{id}
GET    /api/v1/manage/filesystem?path=...
POST   /api/v1/manage/filesystem/mkdir
POST   /api/v1/manage/filesystem/rename
DELETE /api/v1/manage/filesystem?path=...
POST   /api/v1/manage/nodes/{node_id}/identity-association/reset
```

Every mutating call under `/api/v1/manage` needs the `manager` role, which is
what gates this client's library management and the node reset on Status. A
rename sends `no_replace: true`.

The node reset is offered from a Status node card, behind an explicit
confirmation, and sends that node's `host` and `port`. It commits a small local
tombstone for the stale endpoint-to-identity association and answers `202`,
with propagation and the metadata audit queued; it deletes no persisted node
state or MachaDFS data. The server also has a general
`/api/v1/manage/identity-associations/reset` that needs no node ID; this client
does not call it.

## Acquisition

```text
GET  /api/v1/ingest/status
GET  /api/v1/ingest/jobs
POST /api/v1/ingest/jobs
POST /api/v1/ingest/jobs/{id}/{pause|resume|cancel|clear}
GET  /api/v1/torrents/status
GET  /api/v1/torrents/jobs
POST /api/v1/torrents/jobs
POST /api/v1/torrents/jobs/{id}/{pause|resume|retry|cancel|clear}
```

An ingest is submitted as `{ "path", "remove_source": false }` and a torrent
as `{ "magnet" }`; both answer with the job `id`. Every mutation needs the
`importer` role. Jobs carry `error_code` beside `error`, and a torrent
submission the cluster cannot place is `409 placement_failed` with
`error.reason`.

## Accounts and roles

```text
GET    /api/v1/users
POST   /api/v1/users
PATCH  /api/v1/users/{id}
DELETE /api/v1/users/{id}
GET    /api/v1/users/me
PATCH  /api/v1/users/me
```

The account routes need `manage_users`, except `/api/v1/users/me`, which needs
only `media_viewer` and is how an account reads itself and changes its own
password.

Roles are capabilities, not a ladder: `view_status`, `media_viewer`,
`importer`, `manager`, `manage_users`. The only implications are the server's:
every other capability implies `media_viewer`, and every capability implies
`view_status`. They are resolved server-side when a session is minted, so the
array is closed and the client neither expands nor infers it. A capability the
server did not name is one the session does not have.

Protected accounts are identified by the per-record `mutable` block — `rename`,
`delete`, `set_password`, `set_roles` — never by username. An absent `mutable`
block means the node did not say, which is not the same as refused.

`401` means re-mint; `403` is terminal and must never trigger a re-mint. The
one exception is validating a cached token against `GET /api/v1/session`, where
a `403` (a session minted by an older build whose roles the newer one refuses)
means the token is unusable, and core mints afresh.
