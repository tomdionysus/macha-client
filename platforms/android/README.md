# Android TV / Google TV

This directory contains the thin Android TV host for the shared Macha React client. It packages the Android-mode Vite output into a full-screen WebView and uses the same API routing, playback negotiation, failover, and deterministic D-pad navigation as the shared client.

## Build

From the repository root:

```sh
npm run build-android
```

The deployment artifact is written to `artifacts/Macha-Android-TV-0.8.1-debug.apk`. It is debug-signed and ready for ADB installation. The application ID is `media.macha.client`.

## Deploy

With network debugging enabled on the television:

```sh
adb connect TV_ADDRESS:5555
adb -s TV_ADDRESS:5555 install -r artifacts/Macha-Android-TV-0.8.1-debug.apk
adb -s TV_ADDRESS:5555 shell am start -n media.macha.client/.MainActivity
```

The current host deliberately uses WebView's media pipeline. The planned Media3 bridge can replace playback later without duplicating catalogue or navigation logic.
