# Macha Client

Macha Client is a small React/TypeScript television and web client for Macha.
It browses the catalogue exposed by a Macha node and keeps platform-specific playback behind a narrow adapter.

The web client is implemented against the Macha 0.9.1 catalogue and playback APIs, including Direct Play, remux/transcode HLS, seeking and stream selection. Samsung Tizen is packaged as a legacy Web target behind the same playback boundary; Android/Google TV remains a later native-player target.

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
- Browser HLS playback through hls.js/MSE on modern Web, with native HLS retained for the Samsung legacy target.
- Android Media3 host stubs plus a Samsung Tizen legacy-Web target using the shared HTML5 player.

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

For the Samsung Tizen development target:

```sh
npm run build-samsung
```

This is a separate Vite mode. It emits a Chromium 47-compatible legacy bundle, uses hash routing, sets the current development server endpoint from `.env.samsung`, and generates `dist/config.xml`. The normal `npm run build` remains the modern web build and does not load the legacy plugin.

With a Samsung TV certificate profile and development TV already provisioned, `npm run install-samsung` builds, signs, installs and launches the widget. `TV_SERIAL` and `CERT_PROFILE` may override the development defaults in `install-samsung.sh`.

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

Macha 0.7.2 has one application-scoped `PlaybackRuntime` state machine. It is the sole owner of the platform `Player`, `PlaybackCoordinator`, and active server playback-session lease. React owns presentation only: `/play/:id` selects the full-screen presentation, while navigating back into the catalogue presents the same owned playback as the bottom Now Playing overlay. Full/mini transitions and transient React host remounts therefore do not create/delete a session, recreate the platform player, reload the media source, seek, or renegotiate playback.

Resource-changing transitions are generation-ordered. Starting another item first closes the old coordinator and awaits its session teardown before the replacement is allowed to create a new server session; if an initial session POST completes after Stop, that late lease is deleted and never activated. Transport operations that do not change the source generation remain local and immediate. The server still selects Direct Play, remux or transcode from the platform capability profile, and the coordinator can update the owned logical session for transformed seeks, playback mode/quality, audio/subtitles, or media representation changes.

The playback queue and progress checkpoints are client-local and persisted per client ID, but persistence no longer implies ownership of live playback resources. An ordinary startup on a catalogue route loads resumable queue/history only and does not create a server session. Reloading an explicit `/play/:id` route reconstructs that requested playback from route state, the persisted queue/current item and position checkpoint. Reaching final queue EOF ends the runtime lease; where another queue item exists, the runtime performs an ordered generation replacement.

Direct streams use the platform player directly. On modern Web, transformed fragmented-MP4 HLS is managed by hls.js/MSE with a bounded forward buffer so ordinary seeks can stay in browser memory; pausing also stops hls.js source loading, and resume explicitly restarts it. Fatal managed-HLS media recovery is source-generation scoped and bounded: one recovery may be attempted immediately, another is permitted only after observable timeline progress, and an exhausted/no-progress recovery becomes a terminal player failure that flows through the coordinator/runtime failed state and tears down the owned generation. Samsung keeps the TV browser native-HLS path. Permanent API Bearer authentication is used only for playback-session control; the returned stream/subtitle capability URLs are loaded directly by the player. Browser `pagehide` sends best-effort keepalive teardown for the currently owned lease, while server idle expiry remains crash/network-loss recovery rather than the normal lifecycle.

`PlaybackRuntime` depends only on `PlaybackResolver` and `Platform.Player`, so future native platform players can implement the same ownership/state-machine contract without changing the UI.


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

`SamsungWebPlatform` keeps the Samsung build on the shared HTML5/Web player and advertises only the conservative H.264/AAC, MP4/HLS, 1080p capability profile used by the 2017 Tizen 3 target. The generic `TizenPlatform` boundary remains available for a future native player target, but the Samsung package does not use AVPlay.

## Deliberate omissions

There is no account model, cloud login, content discovery service, advertising, recommendation engine, other-viewer activity, telemetry framework, global watchlist or plugin ecosystem.

## License

GPL-3.0-or-later.
