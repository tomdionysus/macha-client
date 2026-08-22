import { createClientLogger } from '../diagnostics/ClientLog';
import { WebPlatform } from './WebPlatform';
/**
 * Samsung's 2017 Tizen browser is deliberately treated as an old Web target,
 * not as an AVPlay target. Keep the decoder contract narrower than the TV's
 * native capabilities because playback is through Chromium 47 HTMLMediaElement.
 */
export class SamsungWebPlatform {
    name = 'tizen';
    web = new WebPlatform({
        directPlayReadAhead: false,
        legacyMediaElement: true,
    });
    log = createClientLogger('playback.capabilities.samsung');
    initialVolume() {
        // TV volume is owned by the television/remote. Keep the HTML media
        // element itself at unity and do not inherit the Web client's persisted
        // per-client volume (including a stale muted value).
        return 1;
    }
    async capabilities() {
        const detected = await this.web.capabilities();
        const capabilities = {
            ...detected,
            platform: 'tizen',
        };
        this.log.info('detected-html5-profile', {
            platform: capabilities.platform,
            containers: capabilities.containers.join(', '),
            videoCodecs: capabilities.videoCodecs.join(', '),
            audioCodecs: capabilities.audioCodecs.join(', '),
            hlsFmp4: capabilities.hls,
            decoderResolutionLimit: 'none',
            hdr: capabilities.hdr.length > 0 ? capabilities.hdr.join(', ') : 'not-advertised',
        });
        return capabilities;
    }
    createPlayer() {
        return this.web.createPlayer();
    }
    exitApplication() {
        const tizen = window.tizen;
        tizen?.application?.getCurrentApplication?.().exit?.();
    }
}
