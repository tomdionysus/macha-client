import { AndroidPlatform } from './AndroidPlatform';
import { TizenPlatform } from './TizenPlatform';
import { WebPlatform } from './WebPlatform';
export function detectPlatform() {
    if (window.__MACHA_ANDROID__)
        return new AndroidPlatform(window.__MACHA_ANDROID__);
    if (window.__MACHA_TIZEN__)
        return new TizenPlatform(window.__MACHA_TIZEN__);
    return new WebPlatform();
}
