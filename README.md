# Macha Client

Macha Client is the React/TypeScript television and web client for **Macha**, a
self-hosted, clustered media system. It browses the catalogue a Macha node
exposes, negotiates how each title should be delivered, and plays it — with
everything platform-specific kept behind one narrow adapter.

The product is deliberately narrow. It exists to browse and play your own
media. There are no accounts, no cloud dependency, no advertising,
recommendations, social features, other-viewer activity or global watchlists.

Developed with substantial use of AI-assisted implementation.

## Where this repo sits

Macha is several repositories, and the split matters more than any single one
of them:

| Repository | What it is |
| --- | --- |
| `macha` | The server. C++, clustered — any node can answer for the catalogue and serve or transform media. |
| `macha-ts` → **`@machafoundation/core`** | The shared TypeScript core. Consumed here as `file:../macha-ts`. |
| `macha-client` | **This repo.** The DOM client: web browsers, Samsung Tizen, Android TV. |
| React Native clients | Phone and Android TV apps that share `@machafoundation/core` but not this UI. |

**`@machafoundation/core` owns everything that is not presentation:** the HTTP API layer,
the cluster endpoint registry and health monitoring, playback-session
negotiation, the `PlaybackCoordinator` state machine, failover, and the media
start/stall watchdogs. This repo owns the React UI, the `Platform`/`Player`
adapters, TV focus navigation, and the three build targets. If a phone client
would need it too, it belongs in core rather than here — the API layer and the
playback chooser both started in this repo and moved for exactly that reason.

**The server serves facts; the client negotiates.** The server states what a
title is and what it can do. The client decides between Direct Play, remux and
transcode from its own platform capabilities. That chooser lives in
`@machafoundation/core`, so every client makes the same decision from the same facts.

**Any node will do.** Configured endpoints seed a client-owned registry; the
endpoint that most recently completed real work is tried first, and playback
fails over to another node mid-stream. A local `404` or a cancelled request is
never evidence that a node is unhealthy.

## Build targets

One codebase, one React tree, three bundles:

| Target | Command | Engine | Notes |
| --- | --- | --- | --- |
| Web | `npm run build` | current browsers | hls.js/MSE for transformed HLS |
| Samsung Tizen | `npm run build-samsung` | **Chromium 47** (Tizen 3, 2017) | legacy bundle, hash routing, packaged as a signed `.wgt` |
| Android TV | `npm run build-android` | WebView 151 | full-screen WebView shell, hash routing |

**The Samsung target is the constraint that shapes the shared UI.** Chromium 47
has no CSS grid, no flex `gap`, no `inset` shorthand, no custom properties and
no `:focus-visible`. The `samsungCssCompatibility` plugin in `vite.config.ts`
downlevels the stylesheets for that build; it does not remove the constraint,
so anything relying on modern CSS semantics must be checked on the set. That
target also lacks `AbortController` entirely — `src/platform/AbortControllerPolyfill.ts`
supplies one from `main.tsx` before anything else runs, and it is load-bearing
for every bounded request in the app.

Playback carriage differs by target and is a measured decision, not a
preference: Samsung takes native HLS with **MPEG-TS** segments (fMP4 carriage
breaks HEVC and all audio on that panel), while Web and Android TV use
hls.js/MSE, which also gives them a degradation channel the native path does
not have.

## Build and run

```sh
npm install
npm test
npm run build          # web bundle → dist/
```

Requires Node.js 20 or later and a reachable Macha node with the catalogue and
streaming HTTP APIs enabled.

For development against an API on `127.0.0.1:7438`:

```sh
cp .env.example .env.local
npm run dev
```

Macha emits CORS headers, so the Vite dev server does not proxy API requests.

With a Samsung certificate profile and a development TV provisioned,
`npm run install-samsung` builds, signs, installs and launches the widget;
`TV_SERIAL` and `CERT_PROFILE` override the defaults in `install-samsung.sh`.

The web deployment must serve `index.html` for unknown application paths, or
opening a route such as `/series/:id/seasons/:seasonId` directly will not reach
React Router.

Roboto Variable is bundled at build time through Fontsource (Apache-2.0). The
running client never fetches fonts from a cloud service.

## Layout

```text
src/screens/     one module per route
src/components/  shared presentation
src/app/         the React-side wiring: router, services, playback and session hooks
src/platform/    Platform/Player adapters — Web, Samsung, Android, plus stubs for native hosts
src/playback/    the Direct Play read-ahead worker (browser-only, not in core)
src/cluster/     the React binding for core's endpoint health monitor
src/hooks/       including useTvNavigation, the D-pad spatial model
src/styles/      plain CSS, kept within Chromium 47's vocabulary
src/diagnostics/ the console bridge and the failure-trail setting
platforms/android/  the WebView shell (Java)
platforms/tizen/    stubs for a future AVPlay host
docs/            architecture, principles and laws, server API
TODO/            ACTIVE.md is the live backlog; COMPLETED.md is the record
```

`src/api/` is an empty leftover from the move of the API layer into
`@machafoundation/core`; git does not track it, so it exists only in working copies that
predate the move.

## Diagnostics

Playback diagnostics are written to the console with a `[macha ...]` prefix and
retained in a bounded in-memory ring buffer owned by `@machafoundation/core`. After
reproducing a problem:

```js
machaDiagnostics.dump()       // newline-delimited JSON
machaDiagnostics.snapshot()   // the same entries as objects
await machaDiagnostics.copy() // to the clipboard
machaDiagnostics.clear()
```

Capability tokens and authentication-like fields are redacted before output.
The buffer is memory-only and is lost on reload. On a television, where there
is no console, Settings has a **Show extended playback logging on errors**
switch (default off) that puts the last warnings and errors on the failure
screen itself.

Presentation timings live in `src/settings.ts`.

## Reading further

- [`docs/architecture.md`](docs/architecture.md) — how the pieces fit and what each layer may not do.
- [`docs/principles-and-laws.md`](docs/principles-and-laws.md) — the non-negotiable constraints.
- [`docs/server-api.md`](docs/server-api.md) — the Macha endpoints this client uses.
- [`TODO/ACTIVE.md`](TODO/ACTIVE.md) — current backlog, open questions and superseded theories, kept with their evidence.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.

## License

GPL-3.0-or-later.
