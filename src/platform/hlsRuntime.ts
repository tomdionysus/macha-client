import type Hls from 'hls.js';

type HlsModule = typeof Hls;

let pending: Promise<HlsModule> | undefined;
let loaded: HlsModule | undefined;

/**
 * hls.js, fetched only when a stream actually needs it.
 *
 * It is 518 KB of the client's 1,172 KB legacy bundle — 44% of everything a
 * TV must download, parse and execute before it can show anything — and the
 * app needs none of it to boot, browse, or play a direct or native-HLS
 * stream. On the Samsung build, which forces the native player, it is never
 * fetched at all.
 */
export function loadHls(): Promise<HlsModule> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= import('hls.js').then((module) => {
    loaded = module.default;
    return loaded;
  }).catch((error: unknown) => {
    // A failed load must not poison every later attempt: a second play can
    // legitimately succeed where the first hit a dropped connection.
    pending = undefined;
    throw error;
  });
  return pending;
}

/**
 * Start fetching without waiting for it. Called once a playback session is
 * being negotiated, so the download overlaps the session POST rather than
 * landing in front of the first frame.
 */
export function warmHls(): void {
  void loadHls().catch(() => undefined);
}

/**
 * Whether hls.js could drive playback here, answered without loading it.
 *
 * Mirrors hls.js's own `isSupported()`: Media Source Extensions plus the
 * baseline codecs it needs to build a SourceBuffer. Kept local so that merely
 * asking what this device supports — which the capability probe does on every
 * session create, and the Status screen does on view — never drags in half a
 * megabyte.
 */
export function managedHlsSupported(): boolean {
  const mediaSource = typeof window === 'undefined'
    ? undefined
    : (window.MediaSource ?? (window as { WebKitMediaSource?: typeof MediaSource }).WebKitMediaSource);
  if (!mediaSource?.isTypeSupported) return false;
  try {
    return mediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
  } catch {
    return false;
  }
}
