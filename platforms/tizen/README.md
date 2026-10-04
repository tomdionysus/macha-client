# Samsung Tizen host (stub)

The Samsung build shipped today is the shared client as a TV web app
(`npm run install-samsung`), playing through the browser's native HLS.

These stubs sketch a possible AVPlay host, which would:

1. install `window.__MACHA_TIZEN__`, which `src/platform/index.ts` detects;
2. report AVPlay and device playback capabilities;
3. implement `Player` on `webapis.avplay`;
4. map Samsung Back and media keys to the shared navigation and player actions.

It would reuse the same UI; there is no separate Samsung catalogue interface.
