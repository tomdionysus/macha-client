import Hls from 'hls.js';
import { createClientLogger } from '../diagnostics/ClientLog';
import { detectWebMediaCodecCapabilities } from './WebMediaCapabilities';
function isHls(source) {
    return source.mimeType === 'application/vnd.apple.mpegurl' || /\.m3u8(?:$|[?#])/i.test(source.url);
}
function nativeHlsSupported(video) {
    return video.canPlayType('application/vnd.apple.mpegurl') !== '' || video.canPlayType('application/x-mpegURL') !== '';
}
function ranges(rangesValue) {
    const out = [];
    for (let index = 0; index < rangesValue.length; index += 1) {
        out.push({
            start: Math.round(rangesValue.start(index) * 1000) / 1000,
            end: Math.round(rangesValue.end(index) * 1000) / 1000,
        });
    }
    return out;
}
function readyStateName(value) {
    return ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'][value] ?? String(value);
}
function networkStateName(value) {
    return ['NETWORK_EMPTY', 'NETWORK_IDLE', 'NETWORK_LOADING', 'NETWORK_NO_SOURCE'][value] ?? String(value);
}
function mediaError(video) {
    const error = video.error;
    if (!error)
        return undefined;
    return { code: error.code, message: error.message };
}
function videoState(video) {
    return {
        currentTime: Math.round(video.currentTime * 1000) / 1000,
        duration: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) / 1000 : video.duration,
        paused: video.paused,
        ended: video.ended,
        seeking: video.seeking,
        readyState: readyStateName(video.readyState),
        networkState: networkStateName(video.networkState),
        buffered: ranges(video.buffered),
        seekable: ranges(video.seekable),
        playbackRate: video.playbackRate,
        currentSrc: video.currentSrc,
        error: mediaError(video),
    };
}
function objectValue(value) {
    return value && typeof value === 'object' ? value : {};
}
function hlsEventSummary(value) {
    const data = objectValue(value);
    const frag = objectValue(data.frag);
    const response = objectValue(data.response);
    const stats = objectValue(data.stats ?? frag.stats);
    return {
        type: data.type,
        details: data.details,
        fatal: data.fatal,
        level: data.level ?? frag.level,
        sn: frag.sn,
        start: frag.start,
        duration: frag.duration,
        url: data.url ?? frag.url,
        response: Object.keys(response).length > 0 ? {
            code: response.code,
            text: response.text,
            url: response.url,
        } : undefined,
        stats: Object.keys(stats).length > 0 ? {
            loaded: stats.loaded,
            total: stats.total,
            aborted: stats.aborted,
            loading: stats.loading,
            parsing: stats.parsing,
            buffering: stats.buffering,
        } : undefined,
    };
}
let webPlayerSequence = 0;
class WebPlayer {
    host;
    video;
    hls;
    listeners = new Set();
    playerId = ++webPlayerSequence;
    log = createClientLogger('playback.web', { playerId: this.playerId });
    lastTimeLogMs = 0;
    lastProgressLogMs = 0;
    pendingInitialPositionMs = 0;
    attach(host) {
        this.host = host;
        this.log.debug('attach');
    }
    detach() {
        this.log.debug('detach');
        this.stop();
        this.host = undefined;
    }
    async play(source, positionMs = 0) {
        if (!this.host)
            throw new Error('Player must be attached before playback');
        this.log.info('source-load-begin', {
            mode: source.mode,
            mimeType: source.mimeType,
            mediaId: source.mediaId,
            url: source.url,
            subtitleUrl: source.subtitleUrl,
            requestedPositionMs: positionMs,
            hls: isHls(source),
        });
        this.pendingInitialPositionMs = positionMs;
        this.hls?.destroy();
        this.hls = undefined;
        let video = this.video;
        if (video) {
            // Keep the media element itself across transformed seek generations.
            // Recreating it forces the browser to rebuild the entire playback DOM
            // and can also drop element-scoped state such as fullscreen/PiP.
            video.pause();
            video.querySelectorAll('track').forEach((track) => track.parentNode?.removeChild(track));
            video.removeAttribute('src');
            video.load();
            this.log.debug('media-element-reused');
        }
        else {
            video = document.createElement('video');
            video.className = 'native-video';
            video.autoplay = true;
            video.controls = false;
            video.playsInline = true;
            video.preload = 'auto';
            video.crossOrigin = 'anonymous';
            this.attachMediaDiagnostics(video);
            const publish = () => this.publish(video);
            video.addEventListener('timeupdate', publish);
            video.addEventListener('pause', publish);
            video.addEventListener('play', publish);
            video.addEventListener('ended', publish);
            video.addEventListener('loadedmetadata', () => {
                const requestedPositionMs = this.pendingInitialPositionMs;
                if (requestedPositionMs > 0) {
                    this.log.info('initial-local-seek', { requestedPositionMs, before: videoState(video) });
                    video.currentTime = requestedPositionMs / 1000;
                }
                publish();
            });
            this.video = video;
            while (this.host.firstChild)
                this.host.removeChild(this.host.firstChild);
            this.host.appendChild(video);
        }
        const publish = () => this.publish(video);
        if (source.subtitleUrl) {
            const track = document.createElement('track');
            track.kind = 'subtitles';
            track.label = 'Selected subtitles';
            track.src = source.subtitleUrl;
            track.default = true;
            track.addEventListener('load', () => {
                track.track.mode = 'showing';
                this.log.debug('subtitle-loaded', { url: source.subtitleUrl });
            });
            track.addEventListener('error', () => this.log.warn('subtitle-error', { url: source.subtitleUrl }));
            video.appendChild(track);
        }
        if (isHls(source)) {
            if (nativeHlsSupported(video)) {
                this.log.info('hls-native-selected', { url: source.url });
                video.src = source.url;
            }
            else if (Hls.isSupported()) {
                this.log.info('hls-js-selected', { url: source.url });
                await this.attachHls(video, source.url);
            }
            else {
                this.log.error('hls-unsupported', { url: source.url });
                throw new Error('This browser cannot play fragmented-MP4 HLS.');
            }
        }
        else {
            this.log.info('direct-source-selected', { url: source.url, mimeType: source.mimeType });
            video.src = source.url;
        }
        const playStarted = performance.now();
        try {
            await video.play();
            this.log.info('autoplay-started', {
                elapsedMs: Math.round((performance.now() - playStarted) * 10) / 10,
                state: videoState(video),
            });
        }
        catch (error) {
            if (error instanceof DOMException && error.name === 'NotAllowedError') {
                this.log.warn('autoplay-blocked', {
                    elapsedMs: Math.round((performance.now() - playStarted) * 10) / 10,
                    error,
                    state: videoState(video),
                });
                publish();
                return false;
            }
            this.log.error('autoplay-failed', { error, state: videoState(video) });
            throw error;
        }
        return !video.paused;
    }
    pause() {
        this.log.info('pause-request', this.video ? videoState(this.video) : undefined);
        this.video?.pause();
    }
    resume() {
        const video = this.video;
        if (!video) {
            this.log.warn('resume-request-without-media');
            return;
        }
        this.log.info('resume-request', videoState(video));
        void video.play()
            .then(() => this.log.info('resume-started', videoState(video)))
            .catch((error) => this.log.error('resume-failed', { error, state: videoState(video) }));
    }
    seek(positionMs) {
        if (!this.video) {
            this.log.warn('local-seek-without-media', { positionMs });
            return;
        }
        this.log.info('local-seek-request', { positionMs, state: videoState(this.video) });
        this.video.currentTime = Math.max(0, positionMs / 1000);
    }
    stop() {
        this.log.debug('stop', this.video ? videoState(this.video) : undefined);
        this.hls?.destroy();
        this.hls = undefined;
        const video = this.video;
        if (!video)
            return;
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.parentNode?.removeChild(video);
        this.video = undefined;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    attachHls(video, url) {
        return new Promise((resolve, reject) => {
            const hls = new Hls({ enableWorker: true });
            this.hls = hls;
            let settled = false;
            const attachedAt = performance.now();
            const fail = (message) => {
                if (settled)
                    return;
                settled = true;
                this.log.error('hls-startup-failed', { message, elapsedMs: Math.round((performance.now() - attachedAt) * 10) / 10 });
                hls.destroy();
                if (this.hls === hls)
                    this.hls = undefined;
                reject(new Error(message));
            };
            hls.on(Hls.Events.MEDIA_ATTACHED, () => this.log.debug('hls-media-attached'));
            hls.on(Hls.Events.MANIFEST_LOADING, (_event, data) => this.log.debug('hls-manifest-loading', hlsEventSummary(data)));
            hls.on(Hls.Events.MANIFEST_LOADED, (_event, data) => this.log.debug('hls-manifest-loaded', hlsEventSummary(data)));
            hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
                this.log.info('hls-manifest-parsed', {
                    elapsedMs: Math.round((performance.now() - attachedAt) * 10) / 10,
                    data: hlsEventSummary(data),
                });
                if (settled)
                    return;
                settled = true;
                resolve();
            });
            hls.on(Hls.Events.LEVEL_SWITCHING, (_event, data) => this.log.debug('hls-level-switching', hlsEventSummary(data)));
            hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => this.log.debug('hls-level-switched', hlsEventSummary(data)));
            hls.on(Hls.Events.FRAG_LOADING, (_event, data) => this.log.debug('hls-fragment-loading', hlsEventSummary(data)));
            hls.on(Hls.Events.FRAG_LOADED, (_event, data) => this.log.debug('hls-fragment-loaded', hlsEventSummary(data)));
            hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => this.log.debug('hls-fragment-buffered', { data: hlsEventSummary(data), state: videoState(video) }));
            hls.on(Hls.Events.ERROR, (_event, data) => {
                const payload = { data: hlsEventSummary(data), state: videoState(video) };
                if (!data.fatal) {
                    this.log.warn('hls-error-nonfatal', payload);
                    return;
                }
                this.log.error('hls-error-fatal', payload);
                if (!settled) {
                    fail(`HLS startup error: ${data.details}`);
                    return;
                }
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    this.log.warn('hls-recovery-network-start-load', payload);
                    hls.startLoad();
                }
                else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    this.log.warn('hls-recovery-media', payload);
                    hls.recoverMediaError();
                }
                else {
                    this.log.error('hls-unrecoverable-destroy', payload);
                    hls.destroy();
                }
            });
            this.log.debug('hls-load-source', { url });
            hls.loadSource(url);
            hls.attachMedia(video);
        });
    }
    attachMediaDiagnostics(video) {
        const stateEvents = [
            'loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'play', 'pause',
            'waiting', 'stalled', 'suspend', 'seeking', 'seeked', 'ended', 'durationchange', 'ratechange', 'emptied',
            'abort', 'error',
        ];
        for (const name of stateEvents) {
            video.addEventListener(name, () => {
                const state = videoState(video);
                if (name === 'waiting' || name === 'stalled' || name === 'error' || name === 'abort')
                    this.log.warn(`media-${name}`, state);
                else
                    this.log.debug(`media-${name}`, state);
            });
        }
        video.addEventListener('progress', () => {
            const now = performance.now();
            if (now - this.lastProgressLogMs < 1_000)
                return;
            this.lastProgressLogMs = now;
            this.log.debug('media-progress', videoState(video));
        });
        video.addEventListener('timeupdate', () => {
            const now = performance.now();
            if (now - this.lastTimeLogMs < 2_000)
                return;
            this.lastTimeLogMs = now;
            this.log.debug('media-time', videoState(video));
        });
    }
    publish(video) {
        const duration = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
        const event = {
            positionMs: video.currentTime * 1000,
            durationMs: duration,
            paused: video.paused,
            ended: video.ended,
        };
        this.listeners.forEach((listener) => listener(event));
    }
}
function supportedMime(media, mime) {
    if (media.canPlayType(mime) !== '')
        return true;
    return typeof MediaSource !== 'undefined'
        && typeof MediaSource.isTypeSupported === 'function'
        && MediaSource.isTypeSupported(mime);
}
export class WebPlatform {
    name = 'web';
    log = createClientLogger('playback.capabilities');
    async capabilities() {
        const video = document.createElement('video');
        const probe = (mime) => supportedMime(video, mime);
        const { videoCodecs, audioCodecs, containers } = detectWebMediaCodecCapabilities(probe);
        const capabilities = {
            platform: 'web',
            videoCodecs,
            audioCodecs,
            containers,
            hls: nativeHlsSupported(video) || Hls.isSupported(),
            dash: false,
            // Do not claim HDR profiles merely because the display is HDR-capable.
            // The server needs a defined codec/profile contract before we advertise them.
            hdr: [],
        };
        this.log.info('detected', {
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
        return new WebPlayer();
    }
}
