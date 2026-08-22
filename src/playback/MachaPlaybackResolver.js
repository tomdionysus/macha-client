import { mergeRequestHeaders } from '../api/httpCompat';
import { createClientLogger } from '../diagnostics/ClientLog';
import { parseErrorEnvelope } from '../api/errorEnvelope';
export class MachaPlaybackError extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
function normalizeBaseUrl(value) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '/')
        return '';
    return trimmed.replace(/\/+$/, '');
}
function mapStream(stream) {
    return {
        index: stream.index,
        type: stream.type,
        codec: stream.codec,
        profile: stream.profile,
        language: stream.language,
        default: stream.default,
        forced: stream.forced,
        width: stream.width,
        height: stream.height,
        channels: stream.channels,
        sampleRate: stream.sample_rate,
        bitDepth: stream.bit_depth,
        bitrate: stream.bitrate,
    };
}
function wirePreferences(preferences) {
    if (!preferences)
        return undefined;
    const out = {};
    if (preferences.mode !== undefined)
        out.mode = preferences.mode;
    if (preferences.maxHeight !== undefined)
        out.max_height = preferences.maxHeight;
    if (preferences.maxBitrate !== undefined)
        out.max_bitrate = preferences.maxBitrate;
    if (preferences.audioStream !== undefined)
        out.audio_stream = preferences.audioStream;
    if (preferences.subtitleStream !== undefined)
        out.subtitle_stream = preferences.subtitleStream;
    if (preferences.audioLanguage !== undefined)
        out.audio_language = preferences.audioLanguage;
    if (preferences.subtitleLanguage !== undefined)
        out.subtitle_language = preferences.subtitleLanguage;
    return out;
}
export class MachaPlaybackResolver {
    bearerToken;
    available = true;
    baseUrl;
    log = createClientLogger('playback.api');
    requestSequence = 0;
    constructor(baseUrl, bearerToken) {
        this.bearerToken = bearerToken;
        this.baseUrl = normalizeBaseUrl(baseUrl);
    }
    async resolve(media, capabilities) {
        this.log.info('session-create', {
            mediaId: media.id,
            mediaKind: media.kind,
            platform: capabilities.platform,
            containers: capabilities.containers.join(', '),
            videoCodecs: capabilities.videoCodecs.join(', '),
            audioCodecs: capabilities.audioCodecs.join(', '),
            hlsFmp4: capabilities.hls,
            maxWidth: capabilities.maxWidth ?? 'none',
            maxHeight: capabilities.maxHeight ?? 'none',
            hdr: capabilities.hdr.length > 0 ? capabilities.hdr.join(', ') : 'not-advertised',
        });
        const wireCapabilities = {
            containers: capabilities.containers,
            video_codecs: capabilities.videoCodecs,
            audio_codecs: capabilities.audioCodecs,
            hls_fmp4: capabilities.hls,
        };
        if (capabilities.maxWidth !== undefined)
            wireCapabilities.max_width = capabilities.maxWidth;
        if (capabilities.maxHeight !== undefined)
            wireCapabilities.max_height = capabilities.maxHeight;
        const body = {
            item_id: media.id,
            capabilities: wireCapabilities,
            preferences: {
                mode: 'auto',
            },
        };
        const session = this.mapSession(await this.request('/api/v1/playback/sessions', {
            method: 'POST',
            body: JSON.stringify(body),
        }));
        this.log.info('session-created', this.sessionSummary(session));
        return session;
    }
    async update(sessionId, update) {
        this.log.info('session-update', { sessionId, update });
        const body = {};
        const preferences = wirePreferences(update.preferences);
        if (preferences)
            body.preferences = preferences;
        if (update.seekMs !== undefined)
            body.seek_ms = Math.max(0, Math.round(update.seekMs));
        if (update.mediaId !== undefined)
            body.media_id = update.mediaId;
        const session = this.mapSession(await this.request(`/api/v1/playback/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        }));
        this.log.info('session-updated', this.sessionSummary(session));
        return session;
    }
    async stop(sessionId) {
        this.log.info('session-stop', { sessionId });
        try {
            await this.request(`/api/v1/playback/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
            this.log.info('session-stopped', { sessionId });
        }
        catch (error) {
            // Session expiry and explicit cleanup are equivalent from the client's point of view.
            if (error instanceof MachaPlaybackError && error.status === 404) {
                this.log.debug('session-stop-already-gone', { sessionId });
                return;
            }
            this.log.error('session-stop-failed', { sessionId, error });
            throw error;
        }
    }
    mapSession(wire) {
        const options = {
            modes: wire.options.modes,
            qualityHeights: wire.options.quality_heights,
            mediaIds: wire.options.media_ids,
            audioStreams: wire.options.audio_streams.map(mapStream),
            subtitleStreams: wire.options.subtitle_streams.map(mapStream),
            canSeek: wire.options.can_seek,
            canChangeQuality: wire.options.can_change_quality,
            canSwitchMedia: wire.options.can_switch_media,
        };
        const source = {
            mediaId: wire.media_id,
            url: this.streamUrl(wire.stream.url),
            subtitleUrl: wire.stream.subtitle_url ? this.streamUrl(wire.stream.subtitle_url) : undefined,
            mimeType: wire.stream.mime_type,
            mode: wire.mode,
            durationMs: wire.duration_ms,
            sizeBytes: wire.source.size,
        };
        return {
            sessionId: wire.session_id,
            itemId: wire.item_id,
            mediaId: wire.media_id,
            mode: wire.mode,
            mimeType: wire.stream.mime_type,
            source,
            durationMs: wire.duration_ms,
            seekMs: wire.seek_ms,
            preferences: {
                mode: wire.preferences.mode,
                maxHeight: wire.preferences.max_height,
                maxBitrate: wire.preferences.max_bitrate,
                audioStream: wire.preferences.audio_stream,
                subtitleStream: wire.preferences.subtitle_stream,
                audioLanguage: wire.preferences.audio_language,
                subtitleLanguage: wire.preferences.subtitle_language,
            },
            sourceInfo: {
                path: wire.source.path,
                format: wire.source.format,
                size: wire.source.size,
                bitrate: wire.source.bitrate,
                streams: wire.source.streams.map(mapStream),
            },
            output: {
                format: wire.output.format,
                bitrate: wire.output.bitrate,
                video: wire.output.video ? {
                    sourceStream: wire.output.video.source_stream,
                    transform: wire.output.video.transform,
                    codec: wire.output.video.codec,
                    profile: wire.output.video.profile,
                    width: wire.output.video.width,
                    height: wire.output.video.height,
                    bitrate: wire.output.video.bitrate,
                } : undefined,
                audio: wire.output.audio ? {
                    sourceStream: wire.output.audio.source_stream,
                    transform: wire.output.audio.transform,
                    codec: wire.output.audio.codec,
                    profile: wire.output.audio.profile,
                    channels: wire.output.audio.channels,
                    sampleRate: wire.output.audio.sample_rate,
                    bitDepth: wire.output.audio.bit_depth,
                    bitrate: wire.output.audio.bitrate,
                } : undefined,
            },
            selected: {
                videoStream: wire.selection.video_stream,
                audioStream: wire.selection.audio_stream,
                subtitleStream: wire.selection.subtitle_stream,
            },
            transform: {
                video: wire.output.video?.transform ?? 'omit',
                audio: wire.output.audio?.transform ?? 'omit',
            },
            options,
        };
    }
    sessionSummary(session) {
        return {
            sessionId: session.sessionId,
            itemId: session.itemId,
            mediaId: session.mediaId,
            mode: session.mode,
            mimeType: session.mimeType,
            durationMs: session.durationMs,
            seekMs: session.seekMs,
            preferenceMode: session.preferences.mode,
            sourceFormat: session.sourceInfo.format,
            sourceBitrate: session.sourceInfo.bitrate,
            sourceUrl: session.source.url,
            subtitleUrl: session.source.subtitleUrl,
            selected: session.selected,
            transform: session.transform,
            options: {
                modes: session.options.modes,
                canSeek: session.options.canSeek,
                canChangeQuality: session.options.canChangeQuality,
                canSwitchMedia: session.options.canSwitchMedia,
            },
        };
    }
    streamUrl(path) {
        if (/^https?:\/\//i.test(path))
            return path;
        if (this.baseUrl)
            return `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
        if (typeof window !== 'undefined')
            return new URL(path, window.location.origin).toString();
        return path;
    }
    async request(path, init) {
        const requestId = ++this.requestSequence;
        const method = init.method ?? 'GET';
        const started = performance.now();
        const token = this.bearerToken?.trim();
        const headers = mergeRequestHeaders(init.headers, {
            Accept: 'application/json',
            'Content-Type': init.body !== undefined ? 'application/json' : undefined,
            Authorization: token ? `Bearer ${token}` : undefined,
        });
        this.log.debug('http-request', { requestId, method, path, body: this.parseRequestBody(init.body) });
        try {
            const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
            const elapsedMs = Math.round((performance.now() - started) * 10) / 10;
            this.log.debug('http-response', {
                requestId,
                method,
                path,
                status: response.status,
                statusText: response.statusText,
                elapsedMs,
                contentType: response.headers.get('content-type'),
                contentLength: response.headers.get('content-length'),
                retryAfter: response.headers.get('retry-after'),
            });
            if (!response.ok)
                await this.throwResponseError(response, { requestId, method, path, elapsedMs });
            if (response.status === 204)
                return undefined;
            return await response.json();
        }
        catch (error) {
            if (!(error instanceof MachaPlaybackError)) {
                this.log.error('http-failed', {
                    requestId,
                    method,
                    path,
                    elapsedMs: Math.round((performance.now() - started) * 10) / 10,
                    error,
                });
            }
            throw error;
        }
    }
    parseRequestBody(body) {
        if (typeof body !== 'string')
            return body === undefined || body === null ? undefined : '<non-string-body>';
        try {
            return JSON.parse(body);
        }
        catch {
            return body;
        }
    }
    async throwResponseError(response, request) {
        let body;
        try {
            body = await response.json();
        }
        catch {
            // Keep the HTTP status if the response is not JSON.
        }
        const parsed = parseErrorEnvelope(body, `${response.status} ${response.statusText}`);
        this.log.error('http-error-response', {
            ...request,
            status: response.status,
            statusText: response.statusText,
            body,
        });
        throw new MachaPlaybackError(`Macha playback request failed: ${parsed.message}`, response.status, parsed.code);
    }
}
