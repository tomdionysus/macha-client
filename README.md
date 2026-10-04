# Macha Client

_v0.20.1_

The web and television client for **Macha**, a self-hosted, clustered media
system. It browses a Macha node's catalogue, decides how each title should be
delivered, and plays it. React and TypeScript; one codebase for browsers,
Samsung Tizen and Android TV.

It browses and plays your own media, and nothing else: no cloud service,
advertising, recommendations, social activity or global watchlist.

## Related repositories

| Repository | What it is |
| --- | --- |
| [`macha`](https://github.com/tomdionysus/macha) | The server (C++). Any node answers for the catalogue and serves or transforms media. |
| [`macha-ts`](https://github.com/tomdionysus/macha-core-npm) | [`@machafoundation/core`](https://www.npmjs.com/package/@machafoundation/core): everything that is not presentation. API layer, endpoint registry and health, session, playback negotiation and state machine, failover. |
| `macha-client` | This repo: the React UI and its wording, the `Platform`/`Player` adapters, TV focus navigation, the Direct Play read-ahead worker, and the three build targets. |
| [`macha-client-rn`](https://github.com/tomdionysus/macha-client-rn), [`macha-client-rn-tv`](https://github.com/tomdionysus/macha-client-rn-android-tv) | React Native phone and Android TV clients. They share core, not this UI. |

If a client without a DOM would need it too, it belongs in core.

## Install

Requires Node.js 20 or later and a reachable Macha node.

```sh
npm install
npm run dev          # Vite dev server
npm test             # vitest
npm run typecheck    # tsc, both project configs
npm run build        # web bundle in dist/
```

Point the client at a node in `.env.local` (see `.env.example`):

```sh
VITE_MACHA_SERVER=http://127.0.0.1:7438
# or several: VITE_MACHA_SERVERS=http://node-a:7438,http://node-b:7438
```

With none configured, a client served by a Macha node uses that node, and
otherwise asks for an address on first run.

**Core is linked or published.** `main` resolves `@machafoundation/core` from
npm. A development branch may link core's working tree instead
(`"file:../macha-ts"`, cloned beside this repo); restart with
`npm run dev -- --force` after rebuilding core. Never release while linked:
`test -L node_modules/@machafoundation/core` must fail first, because
`npm install` keeps an existing symlink silently.

## Build targets

| Target | Command | Engine | Playback |
| --- | --- | --- | --- |
| Web | `npm run build` | current browsers | hls.js/MSE |
| Samsung Tizen | `npm run build-samsung` | Chromium 47 (Tizen 3) | native HLS, MPEG-TS segments |
| Android TV | `npm run build-android` | WebView | hls.js/MSE |

Packaged targets load from `file:` and use hash routing.

- **Samsung:** `npm run install-samsung` builds, packages and installs with
  the Tizen CLI (`TV_SERIAL`, `CERT_PROFILE`). Chromium 47 has no CSS grid,
  flex `gap`, custom properties or `:focus-visible`; `vite.config.ts`
  downlevels the stylesheets, which narrows the gap without closing it, so
  check CSS and focus changes on the set. It uses MPEG-TS because fMP4 breaks
  HEVC and all audio on that panel.
- **Android TV:** see [`platforms/android/README.md`](platforms/android/README.md).

## Deploy

A Macha node serves the client from `web.root` in `/etc/macha/macha.yaml`:

```sh
npm run build
rsync -a --omit-dir-times --chown=1000:50 dist/ root@<node>:<web.root>/
```

**Never `--delete`.** A session on the previous build still fetches its hashed
chunks, and the `hls` chunk loads at first playback, so removing it breaks
playback for a viewer mid-session.

Any static host works if unknown paths fall back to `index.html`. Fonts are
bundled; the client fetches nothing from third parties.

## Layout

```text
src/screens/        one module per route
src/components/     shared presentation
src/app/            router, services, playback and session hooks
src/platform/       Platform/Player adapters: Web, Samsung, Android
src/playback/       Direct Play read-ahead Service Worker, per-node start costs
src/cluster/        React bindings for core's endpoint registry and health monitor
src/hooks/          shared hooks, including useTvNavigation (D-pad focus)
src/text/           viewerText.ts: every word a viewer sees
src/lists/          list sorting and paging
src/state/          client configuration and volume
src/styles/         plain CSS, within Chromium 47's vocabulary
src/diagnostics/    console bridge and failure-trail setting
platforms/          Android WebView shell; Tizen host stubs
docs/               architecture, principles, server API, playback handover
TODO/               ACTIVE.md is the backlog; COMPLETED.md the record
```

## Diagnostics

Playback diagnostics go to the console with a `[macha ...]` prefix and to a
bounded in-memory buffer, redacted of tokens and lost on reload:

```js
machaDiagnostics.dump()       // newline-delimited JSON
machaDiagnostics.snapshot()   // the same entries as objects
await machaDiagnostics.copy() // to the clipboard
machaDiagnostics.clear()
```

On a television, Settings has **Show extended playback logging on errors**,
which puts recent warnings and errors on the failure screen.

## Contributing

- Keep the boundary: what a non-DOM client would also need goes to core.
- Check changes against the review gates in
  [`docs/principles-and-laws.md`](docs/principles-and-laws.md).
- `npm run typecheck` and `npm test` must pass.
- Test the Samsung build on the set when touching CSS or focus. It fails
  silently there.
- Add coverage before changing a mechanism you cannot describe precisely.

## Further reading

- [`docs/architecture.md`](docs/architecture.md): layers, ownership and the playback model.
- [`docs/principles-and-laws.md`](docs/principles-and-laws.md): the constraints and review gates.
- [`docs/server-api.md`](docs/server-api.md): how this client uses the Macha API.
- [`docs/playback-handover.md`](docs/playback-handover.md): replacing a playing stream without interruption.
- [`CHANGELOG.md`](CHANGELOG.md): release history.

## Licence

GPL-3.0-or-later.
