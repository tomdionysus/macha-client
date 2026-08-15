# Macha Client

Macha Client is a small React/TypeScript television and web client for Macha.
It browses the catalogue exposed by a Macha node and keeps platform-specific playback behind a narrow adapter.

The web catalogue client is implemented. The current Macha server catalogue API does not yet expose media streaming, remuxing or transcoding, so production playback is deliberately not faked: the playback resolver is present as an interface and the web demo supplies a local implementation. Android/Google TV and Samsung Tizen are wired as later platform targets.

The product is intentionally narrow. It exists to browse and play your own media. There are no accounts, cloud dependencies, adverts, recommendations, social features, other-viewer activity or global watchlists.

Developed with substantial use of AI-assisted implementation

## What it does

- 3 second Macha logo-mask splash on initial load, with only the moving highlight visible through the logo.
- Home screen with Movies, TV Shows and Music.
- Per-client Continue Watching, limited to the last three unfinished items.
- Proper browser-history routes for movies, series, seasons and episodes.
- Separate series and season pages.
- Season-specific artwork where the catalogue provides it, with series artwork as fallback.
- Interactive horizontal episode browsing with still artwork, title, date slot and synopsis.
- First-class Movie, TV and Music libraries, including artist → album → track navigation.
- Catalogue search.
- Macha artwork retrieval, including authenticated artwork requests.
- Optional Macha catalogue Bearer token.
- Keyboard and television D-pad focus navigation.
- Mouse, trackpad and touch episode scrolling.
- Shared React UI with Web, Android and Tizen platform/player interfaces.
- Routable player page with auto-hiding lower chrome, transport controls and progress scrubbing; it runs as an interactive preview until the server-side playback resolver exists.
- Android Media3 and Samsung AVPlay host stubs.

Continue Watching is local browser/application state. It is never sent to Macha.

## Requirements

- Node.js 20 or later.
- npm.
- A Macha node with the catalogue HTTP API enabled, or demo mode.

## Build

```sh
npm install
npm test
npm run build
```

The production web bundle is written to `dist/`.

Source Sans 3 Variable is pulled at build time through Fontsource and bundled with the application. Source Sans 3 is released under the SIL Open Font License 1.1. The running client does not fetch fonts from a cloud service.

## Development

For a Macha API on `127.0.0.1:7438`:

```sh
cp .env.example .env.local
npm install
npm run dev
```

`.env.example` configures Vite to proxy same-origin `/api` requests to the Macha node. This avoids requiring CORS support from the deliberately small Macha HTTP server.

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
  splashDurationMs: 3_000,
  loadingIndicatorDelayMs: 1_000,
  playerControlsHideDelayMs: 3_500,
} as const;
```

The splash runs before React is mounted. `src/bootSplash.ts` measures its lifetime with `performance.now()` and does not create the React application until at least `splashDurationMs` has elapsed. The visible masked sweep occupies most of that configured lifetime, so the transparent logo does not collapse perceptually into a sub-second flash. The loading spinner is a transparent full-page overlay and is not shown unless an async screen remains loading beyond `loadingIndicatorDelayMs`.

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

## Playback boundary

Macha's current catalogue API exposes `media_ids`, but it does not expose a media byte-stream or playback negotiation endpoint. `src/playback/PlaybackResolver.ts` is therefore an interface, not an invented HTTP contract.

The intended later server path remains:

```text
catalogue item + media_ids
        |
playback resolver
        |
Direct Play -> Remux -> Transcode
        |
HTTP media/HLS
        |
Platform Player
```

The player page already exists and uses the same platform/player boundary. Until that server API is added it renders interactive preview controls rather than inventing a streaming endpoint. The React application and Android/Tizen platform adapters do not need structural changes when real playback is wired in.

## Platform targets

### Web

`WebPlatform` uses the browser's native video element and reports browser codec/container capabilities. It is complete as the client-side player; production playback waits only for the Macha streaming resolver.

### Android TV / Google TV

`AndroidPlatform` and `platforms/android/` define a small native host boundary. Media3/ExoPlayer should own video playback while the same React bundle remains the UI.

### Samsung Tizen

`TizenPlatform` and `platforms/tizen/` define the corresponding AVPlay boundary. The same React assets become the Tizen application UI.

## Deliberate omissions

There is no account model, cloud login, content discovery service, advertising, recommendation engine, other-viewer activity, telemetry framework, global watchlist or plugin ecosystem.

## License

GPL-3.0-or-later.
