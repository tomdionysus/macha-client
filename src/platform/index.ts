import { noStoreFetch, type HlsWalkFetch, type Platform } from '@machafoundation/core';
import { AndroidPlatform, type AndroidBridge } from './AndroidPlatform';
import { AndroidWebPlatform } from './AndroidWebPlatform';
import { TizenPlatform, type TizenBridge } from './TizenPlatform';
import { WebPlatform } from './WebPlatform';
import { SamsungWebPlatform } from './SamsungWebPlatform';

declare global {
  interface Window {
    __MACHA_ANDROID__?: AndroidBridge;
    __MACHA_TIZEN__?: TizenBridge;
  }
}

type HostKind = 'samsung' | 'android-web' | 'android-shell' | 'tizen-shell' | 'browser';

/** One answer to "what is this running in", so every choice made from it agrees. */
function hostKind(): HostKind {
  if (import.meta.env.MODE === 'samsung') return 'samsung';
  if (import.meta.env.MODE === 'android') return 'android-web';
  if (window.__MACHA_ANDROID__) return 'android-shell';
  if (window.__MACHA_TIZEN__) return 'tizen-shell';
  return 'browser';
}

export function detectPlatform(): Platform {
  switch (hostKind()) {
    case 'samsung': return new SamsungWebPlatform();
    case 'android-web': return new AndroidWebPlatform();
    case 'android-shell': return new AndroidPlatform(window.__MACHA_ANDROID__!);
    case 'tizen-shell': return new TizenPlatform(window.__MACHA_TIZEN__!);
    case 'browser': return new WebPlatform();
  }
}

/**
 * The fetch core measures generation starts with, where the default fails.
 *
 * A browser page talks to nodes cross-origin, and core's probe marks itself
 * uncacheable with `Cache-Control` and `Pragma`, which the nodes do not allow:
 * the browser blocked every probe (measured 2026-09-23), so core never
 * recorded a start cost. `noStoreFetch` drops those headers for
 * `cache: 'no-store'`, which the browser honours without asking the node.
 *
 * **The browser only, because it is the only host where that was measured.**
 * Core keeps the headers as its default because the fetch option rewrites a
 * signed URL on React Native and is dropped on Tizen 3. The television builds
 * keep core's default until someone measures what their webviews do
 * cross-origin, rather than inheriting a fix proven somewhere else.
 */
export function readinessFetchForHost(): HlsWalkFetch | undefined {
  return hostKind() === 'browser' ? noStoreFetch((url, init) => fetch(url, init)) : undefined;
}
