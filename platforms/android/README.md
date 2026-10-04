# Android TV host

A thin full-screen WebView around the shared client's Android-mode bundle.
Playback uses the WebView's media pipeline (hls.js/MSE).

## Build

From the repository root:

```sh
npm run build-android
```

This writes `artifacts/Macha-Android-TV-<version>-debug.apk`, debug-signed.
The version is the client's, from `package.json`; `versionCode` is
`major * 10000 + minor * 100 + patch`. The application ID is
`media.macha.client`.

## Install

With network debugging enabled on the television:

```sh
adb connect <tv>:5555
adb -s <tv>:5555 install -r artifacts/Macha-Android-TV-<version>-debug.apk
adb -s <tv>:5555 shell am start -n media.macha.client/.MainActivity
```

`INSTALL_FAILED_UPDATE_INCOMPATIBLE` means the installed copy was signed with
a different debug key. Uninstall it first; that clears the set's sign-in,
Continue Watching and queue.
