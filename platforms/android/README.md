# Android TV / Google TV host stub

The React application remains the product UI. Android is a thin native shell, not a second application.

The host will:

1. load the built React application in a full-screen web surface;
2. install `window.__MACHA_ANDROID__`;
3. report display/codec capabilities;
4. implement `Player` with Media3/ExoPlayer and a native video surface;
5. forward Back and media remote keys consistently;
6. package/sign the Android TV application.

Catalogue, navigation, search and Continue Watching remain in the shared TypeScript application. No Macha DHT logic belongs in the Android shell.
