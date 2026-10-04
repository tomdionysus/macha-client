import type Hls from 'hls.js';

type HlsModule = typeof Hls;

let pending: Promise<HlsModule> | undefined;
let loaded: HlsModule | undefined;

/**
 * hls.js, fetched only when a stream needs it: it is nearly half the legacy bundle, and
 * boot, browsing, and direct or native-HLS playback need none of it.
 */
export function loadHls(): Promise<HlsModule> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= import('hls.js').then((module) => {
    loaded = module.default;
    return loaded;
  }).catch((error: unknown) => {
    // Cleared so a later play can retry the load.
    pending = undefined;
    throw error;
  });
  return pending;
}

/** Starts the fetch without waiting, so the download overlaps session negotiation. */
export function warmHls(): void {
  void loadHls().catch(() => undefined);
}

/** Whether hls.js could drive playback here, mirroring its `isSupported()` without loading it. */
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
