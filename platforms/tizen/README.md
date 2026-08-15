# Samsung Tizen host stub

Tizen runs the same compiled React application as a TV web app. The host will:

1. install `window.__MACHA_TIZEN__`;
2. report AVPlay/device playback capabilities;
3. implement `Player` on `webapis.avplay`;
4. map Samsung Back/media keys into the shared navigation/player actions;
5. package the same web assets into the `.wgt` application.

There is no separate Samsung catalogue UI.
