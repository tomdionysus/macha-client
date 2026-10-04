# Using the Macha API

The route reference is the server's, in the
[`macha`](https://github.com/tomdionysus/macha) repo's `docs/`: `catalogue.md`,
`streaming.md`, `management.md`, `acquisition.md`, `files.md`, `cluster.md`.
This page records what this client relies on.

The wire types and HTTP adapters live in `@machafoundation/core`
(`CatalogueApi`, `ManageApi`, `AcquisitionApi`, and the `Cluster*Api` classes
that route calls across nodes). Screens use core's higher-level `MediaApi` and
never parse Macha JSON, with one exception: the subtitle segment manifest
(`src/platform/WebSubtitles.ts`).

## Errors

Errors are `{ "error": { "code", "message", "reason"? } }`. The client acts on
the code and words it in `src/text/viewerText.ts`; the message is for people.
Jobs, catalogue hints and status diagnostics carry `error_code` beside `error`.
A code this client does not know shows the server's sentence.

## Authentication and roles

Every request carries `Authorization: Bearer <token>` from the session core
mints (`POST /api/v1/session`) and validates (`GET /api/v1/session`). A session
is valid on every node. `401` means mint again; `403` is final.

Signed URLs carry no token: artwork (`url` on each artwork entry, valid on
every node, used directly as `<img src>`) and the stream and subtitle URLs a
playback session returns. The client builds no stream path itself, except
subtitle segments (`segment-<n>.vtt`, relative to the manifest).

Roles are capabilities, not a ladder: `view_status`, `media_viewer`,
`importer`, `manager`, `manage_users`. The server resolves them when it mints
the session; the client shows only what the session's roles allow and infers
none. Protected accounts are identified by each record's `mutable` block, never
by username.

## Endpoints

Configured URLs are seeds, not the membership list. Core discovers the rest
from each node's `api_endpoint` in `GET /api/v1/status` and probes
`GET /api/v1/health`. A client served from a node checks that origin's
`/api/v1/health` for a Macha JSON body before trusting it, because a static
host answers `200` to anything.

## Catalogue

Kinds are `movie`, `show`, `season`, `episode`, `artist`, `album`, `track`,
linked by `parent_id`. Lists and searches are `{ "items": [] }`. There is a
`year` but no full release date. Edits send `If-Match: "rev-<revision>"`; the
metadata editor uses `PATCH`, so a field it does not send is never lost.

Items carry `availability` and, for a series, season, artist or album,
`availability_members` (counts of the items beneath it). See
[architecture](architecture.md#catalogue).

A media profile (`GET /api/v1/catalogue/media/{media_id}/profile`) adds
duration, codecs and bitrate to detail pages. It is never required to start
playback.

## Playback

The client decides; the server performs. Before a session, core reads
`GET /api/v1/playback/media?item_id=`: one entry per file with its container,
streams and what the node can do with it. Core chooses a file and a mode and
sends `item_id`, `media_id`, `seek_ms` and `preferences` (`mode` of `direct`,
`remux` or `transcode`, per-stream `video` and `audio` transforms, segment
`container`, and any quality, audio and subtitle choices). Always send
`media_id`.

- **Positions are integer milliseconds.** Round before sending.
- **A session belongs to the node that created it.** Moving node means create
  there, switch, release here. One `idempotency_key` per start, reused across
  the nodes that attempt tries.
- **`PATCH` changes the stream**: mode, quality, audio, subtitle, file, or a
  seek outside the current generation. Seeks inside it are local. A
  subtitle-only `PATCH` changes only `stream.subtitle_url`.
- **Where a generation begins:** `seek_ms` is its first sample;
  `seek_offset_ms` is how far in the requested position sits;
  `seek_ms + seek_offset_ms == seek_requested_ms`. A transcode starts on the
  requested frame; a remux starts on the keyframe before it. Core hands the
  player a position local to the generation, so do not apply the offset again.
- **Timeouts come from the node:** `playback.startup_timeout_ms` and
  `segment_timeout_ms` in `GET /api/v1/status`. A missing value means the node
  cannot say; never shorten on it.
- **Limits are per node:** `429 account_session_limit` tries the next node;
  `429 resource_limit` means the node is full.
- **Controls come from the session's `options`** (`quality_heights`,
  `audio_streams`, `subtitle_streams`, `media_ids`, `modes`), never from local
  guesses. The server refuses `remux` with a transcoded stream, so a Remux
  press that cannot copy the audio is sent as `transcode` with video copied
  (`src/screens/player/modeTransforms.ts`).
- **Subtitles** are a segmented WebVTT manifest (`format`
  `macha-webvtt-segments`, `version` 1); the player fetches only segments near
  the playhead. A URL ending `.vtt` is a single file from an older server.

## Management and acquisition

Changes under `/api/v1/manage` need `manager`; ingest and torrent changes need
`importer`; account routes need `manage_users`, except `/api/v1/users/me`.
Core sends a change to one node and never retries it elsewhere.

Matching an unmatched file is applied through core's `identifyUnmatched`,
which chooses the route: an existing catalogue item, a TMDB or MusicBrainz
record, or metadata entered by hand.

## Continue Watching

Not a server API. Core keeps it locally: three items, added after 30 seconds
of playback, removed at 92%.
