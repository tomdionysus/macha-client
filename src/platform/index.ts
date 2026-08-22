import type { Platform } from './Platform';
import { AndroidPlatform, type AndroidBridge } from './AndroidPlatform';
import { TizenPlatform, type TizenBridge } from './TizenPlatform';
import { WebPlatform } from './WebPlatform';
import { SamsungWebPlatform } from './SamsungWebPlatform';

declare global {
  interface Window {
    __MACHA_ANDROID__?: AndroidBridge;
    __MACHA_TIZEN__?: TizenBridge;
  }
}

export function detectPlatform(): Platform {
  if (import.meta.env.MODE === 'samsung') return new SamsungWebPlatform();
  if (window.__MACHA_ANDROID__) return new AndroidPlatform(window.__MACHA_ANDROID__);
  if (window.__MACHA_TIZEN__) return new TizenPlatform(window.__MACHA_TIZEN__);
  return new WebPlatform();
}
