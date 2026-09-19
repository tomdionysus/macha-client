# Macha Client

The React/TypeScript television and web client for **Macha**, a self-hosted,
clustered media system. It browses the catalogue a Macha node exposes,
negotiates how each title should be delivered, and plays it, with everything
platform-specific behind one adapter interface.

The product is deliberately narrow: it browses and plays your own media. There
is no cloud service, advertising, recommendation engine, social activity or
global watchlist.

Developed with substantial use of AI-assisted implementation.

## Where this repo sits

| Repository | What it is |
| --- | --- |
| `macha` | The server. C++, clustered; any node can answer for the catalogue and serve or transform media. |
| `macha-ts` → **`@machafoundation/core`** | The shared TypeScript core, consumed here from npm. |
| `macha-client` | **This repo.** The DOM client: web browsers, Samsung Tizen, Android TV. |
| React Native clients | Phone and TV apps sharing `@machafoundation/core` but not this UI. |

**`@machafoundation/core` owns everything that is not presentation:** the HTTP
API layer, the cluster endpoint registry and health monitoring,
playback-session negotiation, the `PlaybackCoordinator` state machine, failover,
and the media start and stall watchdogs.

**This repo owns** the React UI, the `Platform`/`Player` adapters, TV focus
navigation, the Direct Play read-ahead worker, and the three build targets.

The dividing question is whether a non-DOM client would need the same thing. If
it would, it belongs in core.

## Requirements

- Node.js 20 or later.
- A reachable Macha node with the catalogue and streaming HTTP APIs enabled.

`@machafoundation/core` is published to npm, so a clone and an `npm install` are
the whole setup. The development cycle resolves it exactly as a user's install
does; there is no `npm link` step and no `file:` override. When core needs a
change in front of this client before a release, it publishes a prerelease under
a dist-tag and this client installs `@machafoundation/core@next`.

`npm install` will silently keep an existing symlink rather than fetch a
tarball, and the version string can agree while it does. `test -L
node_modules/@machafoundation/core` is the check that cannot lie.

## Build and run

```sh
npm install
npm run dev            # Vite dev server
npm test               # vitest
npm run typecheck      # tsc, both project configs
npm run build          # web bundle → dist/
```

## Build targets

One codebase, one React tree, three bundles.

| Target | Command | Engine | Playback path |
| --- | --- | --- | --- |
| Web | `npm run build` | current browsers | hls.js/MSE |
| Samsung Tizen | `npm run build-samsung` | Chromium 47 (Tizen 3) | native HLS, MPEG-TS segments |
| Android TV | `npm run build-android` | WebView 151 | hls.js/MSE |

**The Samsung target constrains the shared UI.** Chromium 47 has no CSS grid, no
flex `gap`, no `inset` shorthand, no custom properties and no `:focus-visible`.
The `samsungCssCompatibility` plugin in `vite.config.ts` downlevels stylesheets
for that build and emits a legacy layout sheet; it narrows the gap rather than
closing it, so anything depending on modern CSS semantics must be checked on the
set. That target also has no `AbortController`;
`src/platform/AbortControllerPolyfill.ts` installs one from `main.tsx` before
anything else runs, and every bounded request depends on it.

Samsung uses MPEG-TS rather than fMP4 because fMP4 carriage breaks HEVC and all
audio on that panel. Web and Android TV use hls.js/MSE, which also provides a
degradation channel the native path does not have.

Packaged targets load from `file:` and use hash routing.

## Deployment

A Macha node serves the built client from the directory named by `web.root` in
`/etc/macha/macha.yaml`. Build, then sync `dist/` into it:

```sh
npm run build
rsync -a --omit-dir-times --chown=1000:50 dist/ root@<node>:<web.root>/
```

**Deploy additively; do not use `--delete`.** Hashed assets from the previous
build must remain so that a session still running it does not 404 on a
lazily-loaded chunk. The `hls` chunk matters most: it is fetched at first
playback rather than at boot, so removing it under a watching viewer breaks
playback rather than the page. Prune deliberately and separately.

Any other static host works, with one requirement: **unknown application paths
must fall back to `index.html`**, or routes such as
`/series/:id/seasons/:seasonId` will not reach React Router.

Roboto Variable is bundled at build time through Fontsource (Apache-2.0). The
running client never fetches fonts from a third party.

## Layout

```text
src/screens/        one module per route
src/components/     shared presentation
src/app/            router, services, playback and session hooks
src/platform/       Platform/Player adapters: Web, Samsung, Android
src/playback/       Direct Play read-ahead Service Worker
src/cluster/        React binding for core's endpoint health monitor
src/hooks/          including useTvNavigation, the D-pad spatial model
src/styles/         plain CSS, within Chromium 47's vocabulary
src/diagnostics/    console bridge and failure-trail setting
platforms/android/  WebView shell (Java)
platforms/tizen/    stubs for a future AVPlay host
docs/               architecture, principles, server API, playback handover
TODO/               ACTIVE.md is the backlog; COMPLETED.md the record
```

## Diagnostics

Playback diagnostics are written to the console with a `[macha ...]` prefix and
retained in a bounded in-memory ring buffer owned by `@machafoundation/core`:

```js
machaDiagnostics.dump()       // newline-delimited JSON
machaDiagnostics.snapshot()   // the same entries as objects
await machaDiagnostics.copy() // to the clipboard
machaDiagnostics.clear()
```

Capability tokens and authentication-like fields are redacted before output. The
buffer is memory-only and is lost on reload.

On a television there is no console, so Settings has a **Show extended playback
logging on errors** switch (default off) which puts recent warnings and errors
on the failure screen itself.

Presentation timings live in `src/settings.ts`.

## Contributing

- **Keep the boundary.** Anything a non-DOM client would also need goes to
  `@machafoundation/core`. Platform-specific code is limited to capabilities,
  playback, application lifecycle and input integration.
- **Check changes against the review gates** in
  [`docs/principles-and-laws.md`](docs/principles-and-laws.md). They are
  constraints, not aspirations.
- **Run `npm run typecheck` and `npm test`.** Both must pass; the typecheck
  covers two project configs.
- **Test the Samsung build on the set** when touching CSS, focus behaviour or
  anything relying on modern browser semantics. The legacy bundle is where such
  changes fail, and they fail silently.
- **Add coverage before changing a mechanism** whose behaviour you cannot state
  precisely.

## Reading further

- [`docs/architecture.md`](docs/architecture.md) — layers, ownership and the playback model.
- [`docs/principles-and-laws.md`](docs/principles-and-laws.md) — the constraints and the review gates.
- [`docs/server-api.md`](docs/server-api.md) — the Macha endpoints this client uses.
- [`docs/playback-handover.md`](docs/playback-handover.md) — how a playing generation is replaced.
- [`TODO/ACTIVE.md`](TODO/ACTIVE.md) — current backlog.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.

## License

GPL-3.0-or-later.
