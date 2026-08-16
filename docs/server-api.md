# Macha server integration

The client matches Macha's current catalogue HTTP API. The exact wire types live in `src/api/CatalogueApi.ts`; `MachaCatalogueApi.ts` is the HTTP adapter. Screens do not parse Macha JSON directly.

## Current endpoints

```text
GET /api/v1/catalogue/status
GET /api/v1/catalogue/items?type=show&parent=...
GET /api/v1/catalogue/search?q=expanse&limit=50
GET /api/v1/catalogue/items/{id}
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

## Hierarchy

Macha stores hierarchy through `parent_id`.

The series page retrieves the show and lists seasons with `type=season&parent=<show-id>`. It does not fetch episode lists.

The separate season page retrieves that season and lists episodes with `type=episode&parent=<season-id>`. This keeps the amount of catalogue work proportional to what is actually on screen.

The server therefore does not need a client-specific nested show response or a special Home endpoint.

## Dates

The current catalogue wire model has `year`, but no full release/air date. The UI deliberately treats `releaseDate` as optional and shows a placeholder when it is absent.

Server/provider TODO: add an optional full date to the catalogue model and populate it from TMDB movie `release_date`, series `first_air_date`, season `air_date` and episode `air_date`. No provisional wire field is assumed by this client until the server contract is changed.

## Authentication

If `catalogue.api.token_file` is configured on the node, every request uses:

```text
Authorization: Bearer <token>
```

Artwork is fetched with `fetch()` and converted to a local object URL. It is not placed directly in `<img src>`, because a normal image element cannot attach the Bearer header.

The token is stored locally by this client. It is sent only to the configured Macha API endpoint.

## Browser deployment

Macha does not currently serve the web application itself. Same-origin proxying remains a convenient deployment:

```text
browser -> web server /api/* -> Macha catalogue API :7438
```

Vite development supports this with `MACHA_API_TARGET`.

Because the client now uses browser-history routes, a production static server must also return the application `index.html` for paths such as `/movies/<id>` and `/series/<id>/seasons/<id>`. This is a static-hosting concern, not a new catalogue endpoint.

## Continue Watching

Continue Watching is intentionally not a server API. It is local client state:

- maximum three items;
- item appears after 30 seconds;
- item is removed at 92% completion;
- no account or user identity;
- no progress upload.
## Playback (Macha 0.7)

The player uses the server playback-session API rather than constructing media URLs itself:

```text
GET    /api/v1/playback/status
POST   /api/v1/playback/sessions
GET    /api/v1/playback/sessions/{id}
PATCH  /api/v1/playback/sessions/{id}
DELETE /api/v1/playback/sessions/{id}
```

Session creation sends the catalogue `item_id` and the platform capability profile: direct containers/codecs and fragmented-MP4 HLS support, plus optional decoder resolution limits when a platform can report real limits. The Web client deliberately does not use screen dimensions as decoder limits. The server response supplies the selected media representation, actual mode, stream URL, selected streams, available controls, probe data and duration.

`PATCH` is used for server-side seeks of transformed streams and for changing mode, quality limits, audio stream, subtitle stream or media representation. A transformed seek/change may replace the HLS generation while retaining the same logical session. The client therefore treats every PATCH response as authoritative and reloads the returned stream URL.

Direct mode is handed straight to the platform player. Remux/transcode mode returns fragmented-MP4 HLS. The Web platform uses native HLS where available and hls.js otherwise.

The API Bearer token is attached to session create/control requests. Returned `/api/v1/playback/stream/...` and subtitle URLs are capability URLs and are loaded without the permanent Bearer token.

The client explicitly deletes the playback session when leaving the player.
