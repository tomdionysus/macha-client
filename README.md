# Macha Client

Macha Client is a small React/TypeScript television and web client for Macha.
It browses the catalogue exposed by a Macha node and keeps platform-specific playback behind a narrow adapter.

The web client is implemented against the Macha 0.9.1 catalogue and playback APIs, including Direct Play, remux/transcode HLS, seeking and stream selection. Android/Google TV and Samsung Tizen remain wired as later platform-player targets behind the same playback boundary.

The product is intentionally narrow. It exists to browse and play your own media. There are no accounts, cloud dependencies, adverts, recommendations, social features, other-viewer activity or global watchlists.

Developed with substantial use of AI-assisted implementation

## What it does

- 1 second Macha logo-mask splash on initial load, with only the moving highlight visible through the logo.
- Home screen with Movies, TV Shows and Music.
- Movie detail pages with prominent poster artwork and circular Play / Play from start controls.
- Per-client Continue Watching, limited to the last three unfinished items.
- Proper browser-history routes for movies, series, seasons and episodes.
- Separate series and season pages.
- Season-specific artwork where the catalogue provides it, with series artwork as fallback.
- Interactive horizontal episode browsing with still artwork, title, date slot and synopsis; the complete still is a direct link to the player route.
- First-class Movie, TV and Music libraries, including artist → album → track navigation.
- Catalogue search.
- Macha artwork retrieval, including authenticated artwork requests.
- Optional Macha catalogue Bearer token.
- Keyboard and television D-pad focus navigation.
- Mouse, trackpad and touch episode scrolling.
- Shared React UI with Web, Android and Tizen platform/player interfaces.
- Subtle centred Macha watermark behind normal application screens, excluded from playback.
- Persistent application-level player with full-screen and bottom Now Playing presentations, auto-hiding full-player chrome, uniform transport controls, Play from start and transactional progress scrubbing.
- Client-local persisted playback queue. Albums queue their ordered tracks, seasons queue their ordered episodes, and playback advances automatically to the next queued item.
- Macha 0.9.1 playback-session negotiation with Direct Play, remux and transcode modes.
- In-session quality, audio, subtitle and media-representation switching.
- Browser HLS playback through native HLS where available or hls.js otherwise.
- Android Media3 and Samsung AVPlay host stubs.

Continue Watching and the playback queue are local browser/application state. They are never sent to Macha.

## Requirements

- Node.js 20 or later.
- npm.
- Macha 0.9.1 with the catalogue and streaming HTTP APIs enabled, or demo mode.

## Build

```sh
npm install
npm test
npm run build
```

The production web bundle is written to `dist/`.

Roboto Variable is pulled at build time through Fontsource and bundled with the application. Roboto is released under the Apache License 2.0. The running client does not fetch fonts from a cloud service.

## Development

For a Macha API on `127.0.0.1:7438`:

```sh
cp .env.example .env.local
npm install
npm run dev
```

`.env.example` configures Vite to proxy same-origin `/api` requests to the Macha node. Macha 0.9.1 also emits CORS headers, so a separately hosted client may talk to the API directly.

For the self-contained UI/playback demo:

```sh
VITE_DEMO=true npm run dev
```

## Routes

```text
/
/movies
/movies/:id
/series
/series/:id
/series/:id/seasons/:seasonId
/episodes/:id
/music
/music/artists/:id
/music/albums/:id
/music/tracks/:id
/play/:id
/search
/settings
```

The web deployment must serve `index.html` for unknown application paths so directly opening a route such as `/series/.../seasons/...` reaches React Router. Vite does this during development; the eventual Macha static-file integration must provide the same SPA fallback.

## UI timing settings

Small presentation delays live in `src/settings.ts`:

```ts
export const uiSettings = {
  splashDurationMs: 1_000,
  loadingIndicatorDelayMs: 1_000,
  playerControlsHideDelayMs: 3_500,
  playerSeekSpinnerDelayMs: 750,
} as const;
```

The splash runs before React is mounted. `src/bootSplash.ts` measures its lifetime with `performance.now()` and does not create the React application until at least `splashDurationMs` has elapsed. The visible masked sweep occupies almost all of that configured lifetime, moves linearly, starts within the right side of the mask and exits fully beyond the left edge. The ordinary loading spinner is not shown unless an async screen remains loading beyond `loadingIndicatorDelayMs`. Server-backed seeks use the shorter `playerSeekSpinnerDelayMs` grace period: the old picture pauses immediately, fast replacement streams resume without a spinner, and slower replacements show it until playback starts.

## Macha integration

The client uses the actual Macha catalogue endpoints under `/api/v1/catalogue`. The wire representation is isolated in `src/api/CatalogueApi.ts` and `src/api/MachaCatalogueApi.ts`; React screens use the higher-level `MediaApi` facade.

The client derives its Home screen from `type=movie`, `type=show` and `type=album` catalogue queries. Music uses the existing `artist → album → track` parent hierarchy. Series and season pages use the server's existing parent hierarchy:

```text
series page
  -> GET items?type=season&parent=<show-id>

season page
  -> GET items?type=episode&parent=<season-id>
```

Opening a series therefore no longer downloads all of its episode metadata.

Artwork is fetched through the API rather than placed directly in `<img src>`. This is necessary because a Macha API configured with `token_file` requires the Bearer token on artwork requests too.

The client reserves an optional full date field for season/episode presentation, but the current Macha catalogue API exposes only `year`. See [`TODO.md`](TODO.md) for the provider/server work required to populate TMDB dates later.

See [`docs/server-api.md`](docs/server-api.md).

## Playback

Macha 0.9.1 playback is implemented through `MachaPlaybackResolver`. Playback is owned by one persistent `PlayerHost` mounted outside React Router. `/play/:id` now means that the host should use its full-screen presentation; navigating back into the catalogue collapses the same host into the bottom Now Playing overlay. That presentation change does not detach the platform player, reload the media URL, recreate the media element, seek or renegotiate the server session.

Starting a different item creates the normal Macha playback session with the platform capability profile. The server selects Direct Play, remux or transcode and returns a capability URL for the media. The player can update the same logical session to seek, change playback mode or quality, select audio/subtitles, or switch media representation. Transformed seeks and option changes may return a new HLS generation; the client reloads it while preserving the absolute media position. Explicitly stopping Now Playing deletes the active session.

The playback queue is client-local and persisted per client ID. Album track clicks initialise the queue from the album order; season episode clicks initialise it from season order. Previous/Next operate on that queue and reaching the end of an item advances automatically where another item exists. A hard browser reload cannot preserve a live server capability/session URL, so the client reconstructs a fresh session from the persisted queue/current item and position checkpoint instead.

Direct streams use the platform player directly. On Web, transformed fragmented-MP4 HLS uses native HLS where the browser provides it and hls.js otherwise. Permanent API Bearer authentication is used only for playback-session control; the returned stream/subtitle capability URLs are loaded directly by the player.

The persistent React player depends only on `PlaybackResolver` and `Platform.Player`, so Android Media3 and Tizen AVPlay can implement the same session/control model without changing the UI.


### Playback diagnostics

Playback diagnostics are enabled in this development-stage client and written to the browser console with a `[macha ...]` prefix. The same structured entries are retained in a bounded in-memory ring buffer.

After reproducing a playback problem, use the browser console:

```js
machaDiagnostics.dump()       // newline-delimited JSON
await machaDiagnostics.copy() // copy the same trace to the clipboard
machaDiagnostics.clear()      // start a fresh trace
```

The trace includes playback-session POST/PATCH/DELETE timing and status, autoplay results, starting/resume position, media ready/network state, buffered and seekable ranges, `waiting`/`stalled`/seek events, HLS manifest/fragment activity and hls.js recovery/error events. Playback capability tokens and authentication-like fields are redacted before console/export output.

Diagnostic verbosity is configured in `src/settings.ts` with `diagnosticsSettings`. The buffer is deliberately memory-only and is lost on a full page reload.

## Platform targets

### Web

`WebPlatform` reports browser codec/container capabilities, uses the browser video element for direct/native-HLS playback, and uses hls.js for fragmented-MP4 HLS when native HLS is unavailable.

### Android TV / Google TV

`AndroidPlatform` and `platforms/android/` define a small native host boundary. Media3/ExoPlayer should own video playback while the same React bundle remains the UI.

### Samsung Tizen

`TizenPlatform` and `platforms/tizen/` define the corresponding AVPlay boundary. The same React assets become the Tizen application UI.

## Deliberate omissions

There is no account model, cloud login, content discovery service, advertising, recommendation engine, other-viewer activity, telemetry framework, global watchlist or plugin ecosystem.

## License

GPL-3.0-or-later.
