# Android TV / Google TV

This directory contains the thin Android TV host for the shared Macha React client. It packages the Android-mode Vite output into a full-screen WebView and uses the same API routing, playback negotiation, failover, and deterministic D-pad navigation as the shared client.

## Build

From the repository root:

```sh
npm run build-android
```

The deployment artifact is written to `artifacts/Macha-Android-TV-<version>-debug.apk`, where the version is the client's own from `package.json` — the host has no version of its own, and states none. The `versionName` and `versionCode` in the manifest come from the same place, the code as `major * 10000 + minor * 100 + patch` (0.10.7 is 1007), so an upgrade always presents Android with a higher number than the copy it replaces. It is debug-signed and ready for ADB installation. The application ID is `media.macha.client`.

## Deploy

With network debugging enabled on the television:

```sh
adb connect TV_ADDRESS:5555
adb -s TV_ADDRESS:5555 install -r artifacts/Macha-Android-TV-<version>-debug.apk
adb -s TV_ADDRESS:5555 shell am start -n media.macha.client/.MainActivity
```

An install that fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` means the copy on
the television was signed with a different debug key. There is no flag around a
signature change: the package has to be uninstalled first, and that takes the
WebView's local storage with it — the API token, Continue Watching and the
playback queue on that set.

The current host deliberately uses WebView's media pipeline. The planned Media3 bridge can replace playback later without duplicating catalogue or navigation logic.
