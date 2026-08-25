import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlayIcon, RestartIcon } from '../components/PlaybackIcons';
import { Loading } from '../components/Status';
import { createClientLogger } from '../diagnostics/ClientLog';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { requestTvDefaultFocus } from '../hooks/useTvNavigation';
import { uiSettings } from '../settings';
import { describePlaybackSession } from '../playback/PlaybackStatus';
import { DirectSeekSessionSync } from '../playback/DirectSeekSync';
import { nextDesiredSeekPosition, preserveSeekSubtitleState } from '../playback/SeekState';
function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${minutes}:${String(seconds).padStart(2, '0')}`;
}
function PlayerIcon({ name }) {
    const common = {
        width: 22,
        height: 22,
        viewBox: '0 0 24 24',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': true,
    };
    switch (name) {
        case 'back':
            return _jsx("svg", { ...common, children: _jsx("path", { d: "M14.5 5 7.5 12l7 7M8 12h9", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }) });
        case 'previous':
            return _jsx("svg", { ...common, children: _jsx("path", { d: "M6 5h2v14H6V5Zm12 1-8 6 8 6V6Z", fill: "currentColor" }) });
        case 'rewind':
            return _jsx("svg", { ...common, children: _jsx("path", { d: "M10.5 6 4.5 12l6 6V6Zm8 0-6 6 6 6V6Z", fill: "currentColor" }) });
        case 'pause':
            return _jsx("svg", { ...common, children: _jsx("path", { d: "M7.5 6h3v12h-3V6Zm6 0h3v12h-3V6Z", fill: "currentColor" }) });
        case 'forward':
            return _jsx("svg", { ...common, children: _jsx("path", { d: "m13.5 6 6 6-6 6V6Zm-8 0 6 6-6 6V6Z", fill: "currentColor" }) });
        case 'next':
            return _jsx("svg", { ...common, children: _jsx("path", { d: "M16 5h2v14h-2V5ZM6 6l8 6-8 6V6Z", fill: "currentColor" }) });
        case 'options':
            return _jsxs("svg", { ...common, children: [_jsx("circle", { cx: "6", cy: "12", r: "1.5", fill: "currentColor" }), _jsx("circle", { cx: "12", cy: "12", r: "1.5", fill: "currentColor" }), _jsx("circle", { cx: "18", cy: "12", r: "1.5", fill: "currentColor" })] });
        case 'expand':
            return _jsx("svg", { ...common, children: _jsx("path", { d: "M8.5 4.5h-4v4M15.5 4.5h4v4M8.5 19.5h-4v-4M15.5 19.5h4v-4", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }) });
        case 'close':
            return _jsx("svg", { ...common, children: _jsx("path", { d: "m6 6 12 12M18 6 6 18", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" }) });
        case 'fullscreen':
            return _jsx("svg", { ...common, children: _jsx("path", { d: "M8.5 4.5h-4v4M15.5 4.5h4v4M8.5 19.5h-4v-4M15.5 19.5h4v-4", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }) });
        case 'fullscreen-exit':
            return _jsx("svg", { ...common, children: _jsx("path", { d: "M9 4.5v4.5H4.5M15 4.5V9h4.5M9 19.5V15H4.5M15 19.5V15h4.5", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }) });
        case 'volume':
            return _jsxs("svg", { ...common, children: [_jsx("path", { d: "M4 10v4h3l4 3V7l-4 3H4Z", fill: "currentColor" }), _jsx("path", { d: "M14 9.2a4 4 0 0 1 0 5.6M16.6 6.8a7.3 7.3 0 0 1 0 10.4", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" })] });
        case 'mute':
            return _jsxs("svg", { ...common, children: [_jsx("path", { d: "M4 10v4h3l4 3V7l-4 3H4Z", fill: "currentColor" }), _jsx("path", { d: "m15 9 5 6M20 9l-5 6", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round" })] });
    }
}
function VolumeControl({ volume, onChange, compact = false }) {
    const lastAudibleRef = useRef(volume > 0 ? volume : 1);
    useEffect(() => {
        if (volume > 0)
            lastAudibleRef.current = volume;
    }, [volume]);
    return (_jsxs("div", { className: `player-volume-control${compact ? ' compact' : ''}`, children: [_jsx("button", { type: "button", "data-tv-focusable": "true", "aria-label": volume > 0 ? 'Mute' : 'Unmute', title: volume > 0 ? 'Mute' : 'Unmute', onClick: () => onChange(volume > 0 ? 0 : lastAudibleRef.current), children: _jsx(PlayerIcon, { name: volume > 0 ? 'volume' : 'mute' }) }), _jsx("input", { className: "player-volume-slider", type: "range", min: 0, max: 1, step: 0.05, value: volume, "data-tv-focusable": "true", "aria-label": "Volume", onChange: (event) => onChange(Number(event.target.value)) })] }));
}
function canPlay(media) {
    return media.kind === 'movie' || media.kind === 'episode' || media.kind === 'track';
}
function shouldTrackProgress(media) {
    return media.kind === 'movie' || media.kind === 'episode';
}
function streamLabel(stream, fallback) {
    const parts = [stream.language ? stream.language.toUpperCase() : fallback, stream.codec.toUpperCase()];
    if (stream.channels)
        parts.push(`${stream.channels}ch`);
    if (stream.forced)
        parts.push('forced');
    return parts.join(' · ');
}
function qualityChoices(session) {
    return session.options.qualityHeights;
}
export function webSeekDeltaForKey(key) {
    if (key === 'ArrowLeft')
        return -10_000;
    if (key === 'ArrowRight')
        return 10_000;
    return undefined;
}
export function webArrowTargetOwnsKey(target) {
    if (!(target instanceof Element))
        return false;
    // Left/right are transport controls everywhere in the Web player, including
    // while range inputs have focus. Preserve native arrow editing only for
    // controls where horizontal cursor/selection movement is the likely intent.
    return Boolean(target.closest('textarea, select, [contenteditable="true"], input:not([type="range"])'));
}
export function appendQueuedPlaybackControl(queue, next) {
    const previous = queue.at(-1);
    if (previous?.kind === 'seek' && next.kind === 'seek') {
        return [...queue.slice(0, -1), next];
    }
    if (previous?.kind === 'update' && next.kind === 'update') {
        return [
            ...queue.slice(0, -1),
            {
                kind: 'update',
                update: {
                    ...previous.update,
                    ...next.update,
                    preferences: previous.update.preferences || next.update.preferences
                        ? { ...previous.update.preferences, ...next.update.preferences }
                        : undefined,
                },
            },
        ];
    }
    return [...queue, next];
}
export function webSeekHasResumed(event, targetMs, resumeAfterSeek) {
    if (Math.abs(event.positionMs - targetMs) > 1_500)
        return false;
    if (event.seeking)
        return false;
    if (!resumeAfterSeek)
        return true;
    return !event.paused && !event.buffering;
}
export function webTransformedLocalSeekPosition(session, absolutePositionMs) {
    if (session.mode === 'direct')
        return undefined;
    if (!session.mimeType.toLowerCase().includes('mpegurl'))
        return undefined;
    const generationStartMs = Math.max(0, session.seekMs);
    if (absolutePositionMs < generationStartMs)
        return undefined;
    return absolutePositionMs - generationStartMs;
}
export function startupTransformedServerSeekTarget(session, desiredPositionMs, preparedPositionMs, webControls) {
    // The server may align a transformed generation to a keyframe after the
    // requested seek position. That session is still the completed result of
    // the request we just made; never PATCH the same request repeatedly trying
    // to make session.seekMs equal the unaligned target.
    if (Math.round(desiredPositionMs) === Math.round(preparedPositionMs))
        return undefined;
    // If the user changed the target while the server request was in flight, a
    // Web HLS generation can absorb any newer target at/after its actual start.
    if (webControls && webTransformedLocalSeekPosition(session, desiredPositionMs) !== undefined)
        return undefined;
    return desiredPositionMs;
}
export function isSubtitleOnlyUpdate(update) {
    if (update.seekMs !== undefined || update.mediaId !== undefined || !update.preferences)
        return false;
    const keys = Object.entries(update.preferences)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key);
    return keys.length > 0 && keys.every((key) => key === 'subtitleStream' || key === 'subtitleLanguage');
}
function PlayerOptions({ session, onApply, }) {
    const selectedAudio = session.selected.audioStream;
    const selectedSubtitle = session.selected.subtitleStream;
    const qualities = qualityChoices(session);
    const mode = (value) => onApply({ preferences: { mode: value } });
    const preferences = (update) => onApply({ preferences: update });
    return (_jsxs("div", { className: "player-options", "aria-label": "Playback options", children: [_jsxs("div", { className: "player-option-group", children: [_jsx("span", { children: "Mode" }), _jsxs("div", { children: [_jsx("button", { type: "button", "data-tv-focusable": "true", className: session.preferences.mode === 'auto' ? 'selected' : undefined, onClick: () => mode('auto'), children: "Auto" }), session.options.modes.map((candidate) => (_jsx("button", { type: "button", "data-tv-focusable": "true", className: session.preferences.mode === candidate ? 'selected' : undefined, onClick: () => mode(candidate), children: candidate === 'direct' ? 'Direct' : candidate === 'remux' ? 'Remux' : 'Transcode' }, candidate)))] })] }), session.options.canChangeQuality && (_jsxs("div", { className: "player-option-group", children: [_jsx("span", { children: "Quality" }), _jsxs("div", { children: [_jsx("button", { type: "button", "data-tv-focusable": "true", className: session.preferences.maxHeight === null && session.preferences.maxBitrate === null ? 'selected' : undefined, onClick: () => preferences({ maxHeight: null, maxBitrate: null }), children: "Original" }), qualities.map((height) => (_jsxs("button", { type: "button", "data-tv-focusable": "true", className: session.preferences.maxHeight === height ? 'selected' : undefined, onClick: () => preferences({ maxHeight: height }), children: [height, "p"] }, height)))] })] })), session.options.audioStreams.length > 0 && (_jsxs("div", { className: "player-option-group", children: [_jsx("span", { children: "Audio" }), _jsx("div", { children: session.options.audioStreams.map((stream) => (_jsx("button", { type: "button", "data-tv-focusable": "true", className: selectedAudio === stream.index ? 'selected' : undefined, onClick: () => preferences({ audioStream: stream.index, audioLanguage: '' }), children: streamLabel(stream, `Audio ${stream.index}`) }, stream.index))) }), _jsx("small", { className: "player-option-note", children: session.transform.audio === 'transcode'
                            ? `Server processing: transcode${session.output.audio?.codec ? ` → ${session.output.audio.codec.toUpperCase()}` : ''}`
                            : session.transform.audio === 'copy' ? 'Server processing: copy' : 'Server processing: omitted' })] })), session.options.subtitleStreams.length > 0 && (_jsxs("div", { className: "player-option-group", children: [_jsx("span", { children: "Subtitles" }), _jsxs("div", { children: [_jsx("button", { type: "button", "data-tv-focusable": "true", className: selectedSubtitle < 0 ? 'selected' : undefined, onClick: () => preferences({ subtitleStream: null, subtitleLanguage: '' }), children: "Off" }), session.options.subtitleStreams.map((stream) => (_jsx("button", { type: "button", "data-tv-focusable": "true", className: selectedSubtitle === stream.index ? 'selected' : undefined, onClick: () => preferences({ subtitleStream: stream.index, subtitleLanguage: '' }), children: streamLabel(stream, `Subtitle ${stream.index}`) }, stream.index)))] })] })), session.options.canSwitchMedia && session.options.mediaIds.length > 1 && (_jsxs("div", { className: "player-option-group", children: [_jsx("span", { children: "Source" }), _jsx("div", { children: session.options.mediaIds.map((mediaId, index) => (_jsxs("button", { type: "button", "data-tv-focusable": "true", className: session.mediaId === mediaId ? 'selected' : undefined, title: mediaId, onClick: () => onApply({ mediaId }), children: ["Source ", index + 1] }, mediaId))) })] }))] }));
}
function PlayerSession({ api, media, platform, playbackResolver, startPositionMs, presentation, onProgress, onPosition, onMinimize, onExpand, onStop, onPrevious, onNext, onEnded, canPrevious, canNext, queuePosition, volume, onVolumeChange, initialFatalError }) {
    const pageRef = useRef(null);
    const hostRef = useRef(null);
    const chromeRef = useRef(null);
    const player = useMemo(() => platform.createPlayer(), [platform]);
    const log = useMemo(() => createClientLogger('playback.screen', { mediaId: media.id }), [media.id]);
    const initialStartPositionMs = useRef(Math.max(0, startPositionMs)).current;
    const initialEvent = useMemo(() => ({
        positionMs: initialStartPositionMs,
        durationMs: media.durationMs ?? 0,
        paused: true,
        ended: false,
    }), [initialStartPositionMs, media.durationMs]);
    const latestRef = useRef(initialEvent);
    const sessionRef = useRef(undefined);
    const streamOffsetRef = useRef(0);
    const reloadingRef = useRef(false);
    const lastReportRef = useRef(0);
    const lastPositionPersistRef = useRef(0);
    const hideTimerRef = useRef(undefined);
    const scrubValueRef = useRef(undefined);
    const committedSeekRef = useRef(undefined);
    const desiredSeekRef = useRef(undefined);
    const pendingStartupPositionRef = useRef(initialStartPositionMs);
    const desiredPausedRef = useRef(false);
    const queuedControlsRef = useRef([]);
    const controlBusyRef = useRef(false);
    const seekActionRef = useRef(async () => false);
    const updateActionRef = useRef(async () => undefined);
    const directSeekDispatchTimerRef = useRef(undefined);
    const directSeekLastDispatchRef = useRef(0);
    const directSeekSyncRef = useRef(undefined);
    const directSeekResumeRef = useRef(undefined);
    const mountedRef = useRef(true);
    const endedHandledRef = useRef(false);
    const [event, setEvent] = useState(initialEvent);
    const [session, setSession] = useState();
    const [starting, setStarting] = useState(!initialFatalError);
    const [fatalError, setFatalError] = useState(initialFatalError);
    const [playbackNotice, setPlaybackNotice] = useState();
    const webControls = platform.name === 'web';
    const samsungControls = import.meta.env.MODE === 'samsung';
    const html5Player = webControls || samsungControls;
    const interactionControlled = webControls || samsungControls;
    const [controlsVisible, setControlsVisible] = useState(!interactionControlled);
    const [fullscreen, setFullscreen] = useState(false);
    const [optionsVisible, setOptionsVisible] = useState(false);
    const [controlBusy, setControlBusy] = useState(false);
    const [queuedControlGeneration, setQueuedControlGeneration] = useState(0);
    const [desiredPaused, setDesiredPaused] = useState(false);
    const [seekInFlight, setSeekInFlight] = useState(false);
    const [seekFeedbackGeneration, setSeekFeedbackGeneration] = useState(0);
    const [scrubValue, setScrubValue] = useState();
    const backdrop = useArtworkUrl(api, media.artwork?.backdrop ?? media.artwork?.thumbnail ?? media.artwork?.poster);
    const cover = useArtworkUrl(api, media.kind === 'track' ? media.artwork?.poster ?? media.artwork?.thumbnail : undefined);
    useEffect(() => {
        player.setVolume(samsungControls ? 1 : volume);
    }, [player, samsungControls, volume]);
    useEffect(() => {
        const sync = new DirectSeekSessionSync((sessionId, positionMs) => playbackResolver.update(sessionId, { seekMs: positionMs }), (next, request) => {
            if (!mountedRef.current)
                return;
            const current = sessionRef.current;
            if (!current || current.sessionId !== request.sessionId || current.mode !== 'direct')
                return;
            const preserved = preserveSeekSubtitleState(current, next);
            sessionRef.current = preserved;
            setSession(preserved);
            log.info('seek-direct-session-synced', {
                sessionId: request.sessionId,
                positionMs: request.positionMs,
                sequence: request.sequence,
            });
        }, (error, request) => {
            log.warn('seek-direct-session-sync-failed', {
                sessionId: request.sessionId,
                positionMs: request.positionMs,
                sequence: request.sequence,
                error,
            });
        });
        directSeekSyncRef.current = sync;
        return () => {
            sync.dispose();
            if (directSeekSyncRef.current === sync)
                directSeekSyncRef.current = undefined;
        };
    }, [log, playbackResolver]);
    const beginSeekFeedback = useCallback(() => {
        setSeekFeedbackGeneration((generation) => generation + 1);
        setSeekInFlight(true);
    }, []);
    const publish = useCallback((next) => {
        const previous = latestRef.current;
        latestRef.current = next;
        if (previous.paused !== next.paused || previous.ended !== next.ended) {
            log.debug('playback-state', { previous, next, streamOffsetMs: streamOffsetRef.current });
        }
        setEvent(next);
        const now = Date.now();
        if (next.paused || next.ended || now - lastPositionPersistRef.current >= 5_000) {
            lastPositionPersistRef.current = now;
            onPosition(media, next.positionMs, next.durationMs);
        }
        if (!shouldTrackProgress(media))
            return;
        if (next.ended || now - lastReportRef.current >= 10_000) {
            lastReportRef.current = now;
            onProgress({
                mediaId: media.id,
                positionMs: next.positionMs,
                durationMs: next.durationMs,
                updatedAt: now,
                media,
            });
        }
    }, [log, media, onPosition, onProgress]);
    useEffect(() => {
        if (!event.ended) {
            endedHandledRef.current = false;
            return;
        }
        if (endedHandledRef.current)
            return;
        endedHandledRef.current = true;
        onEnded();
    }, [event.ended, onEnded]);
    const hideControls = useCallback(() => {
        if (hideTimerRef.current !== undefined) {
            window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = undefined;
        }
        if (fatalError)
            return;
        setControlsVisible(false);
        setOptionsVisible(false);
        // Do not leave Samsung focus parked on invisible player controls.
        const chrome = chromeRef.current;
        if (!chrome)
            return;
        for (const selected of chrome.querySelectorAll('[data-tv-selected]')) {
            selected.removeAttribute('data-tv-selected');
        }
        const active = document.activeElement;
        if (active instanceof HTMLElement && chrome.contains(active))
            active.blur();
    }, [fatalError]);
    const armControlsHide = useCallback(() => {
        if (hideTimerRef.current !== undefined)
            window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = undefined;
        if (fatalError)
            return;
        // Web and Samsung always auto-hide. Preserve the older pause/options
        // behaviour for any other platform adapter.
        if (!interactionControlled && (latestRef.current.paused || optionsVisible || controlBusy))
            return;
        hideTimerRef.current = window.setTimeout(hideControls, uiSettings.playerControlsHideDelayMs);
    }, [controlBusy, fatalError, hideControls, interactionControlled, optionsVisible]);
    const showControls = useCallback(() => {
        setControlsVisible(true);
        armControlsHide();
    }, [armControlsHide]);
    const focusSamsungControls = useCallback(() => {
        const chrome = chromeRef.current;
        if (!chrome)
            return;
        const elements = Array.from(chrome.querySelectorAll('[data-tv-focusable="true"]:not([disabled])'));
        if (elements.length === 0)
            return;
        for (const element of elements)
            element.removeAttribute('data-tv-selected');
        const preferred = elements.find((element) => element.getAttribute('data-tv-default-focus') === 'true') ?? elements[0];
        preferred.setAttribute('data-tv-selected', 'true');
        preferred.focus();
    }, []);
    const noteWebPointerMovement = useCallback((clientY) => {
        if (presentation !== 'full' || !webControls)
            return;
        const chrome = chromeRef.current;
        if (!chrome)
            return;
        const bounds = chrome.getBoundingClientRect();
        if (clientY < bounds.top || clientY > bounds.bottom)
            return;
        showControls();
    }, [presentation, showControls, webControls]);
    const setScrubPosition = useCallback((positionMs) => {
        scrubValueRef.current = positionMs;
        setScrubValue(positionMs);
    }, []);
    const clearCommittedSeek = useCallback(() => {
        committedSeekRef.current = undefined;
        setScrubPosition(undefined);
    }, [setScrubPosition]);
    const clearDesiredSeek = useCallback(() => {
        desiredSeekRef.current = undefined;
        directSeekResumeRef.current = undefined;
        if (directSeekDispatchTimerRef.current !== undefined) {
            window.clearTimeout(directSeekDispatchTimerRef.current);
            directSeekDispatchTimerRef.current = undefined;
        }
        setScrubPosition(undefined);
    }, [setScrubPosition]);
    const setDesiredSeek = useCallback((positionMs) => {
        desiredSeekRef.current = positionMs;
        setScrubPosition(positionMs);
    }, [setScrubPosition]);
    const setPausedIntent = useCallback((paused) => {
        desiredPausedRef.current = paused;
        setDesiredPaused(paused);
    }, []);
    const setControlsBusy = useCallback((busy) => {
        controlBusyRef.current = busy;
        setControlBusy(busy);
    }, []);
    const queueControl = useCallback((control) => {
        queuedControlsRef.current = appendQueuedPlaybackControl(queuedControlsRef.current, control);
        setQueuedControlGeneration((generation) => generation + 1);
    }, []);
    const loadSession = useCallback(async (next, absolutePositionMs, resumeAfterLoad) => {
        if (resumeAfterLoad !== undefined)
            setPausedIntent(!resumeAfterLoad);
        const bounded = Math.max(0, Math.min(next.durationMs || Number.MAX_SAFE_INTEGER, absolutePositionMs));
        const serverSeek = Math.max(0, Math.min(next.durationMs || Number.MAX_SAFE_INTEGER, next.seekMs));
        const transformedLocalPosition = webControls ? webTransformedLocalSeekPosition(next, bounded) : undefined;
        const effectivePosition = next.mode === 'direct' || transformedLocalPosition !== undefined ? bounded : serverSeek;
        const localPosition = next.mode === 'direct' ? bounded : transformedLocalPosition ?? 0;
        streamOffsetRef.current = next.mode === 'direct' ? 0 : serverSeek;
        sessionRef.current = next;
        setSession(next);
        reloadingRef.current = true;
        const startedAt = performance.now();
        log.info('session-load-begin', {
            sessionId: next.sessionId,
            mode: next.mode,
            mediaId: next.mediaId,
            absolutePositionMs,
            boundedPositionMs: bounded,
            serverSeekMs: next.seekMs,
            effectivePositionMs: effectivePosition,
            localPlayerPositionMs: localPosition,
            streamOffsetMs: streamOffsetRef.current,
            source: next.source,
        });
        try {
            const started = await player.play(next.source, localPosition);
            const resumeNow = !desiredPausedRef.current;
            if (!resumeNow && started)
                player.pause();
            log.info('session-load-ready', {
                sessionId: next.sessionId,
                mode: next.mode,
                started,
                resumeAfterLoad: resumeNow,
                elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
                absolutePositionMs: effectivePosition,
            });
            publish({
                positionMs: effectivePosition,
                durationMs: next.durationMs,
                paused: resumeNow ? !started : true,
                ended: false,
            });
        }
        catch (error) {
            log.error('session-load-failed', {
                sessionId: next.sessionId,
                mode: next.mode,
                elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
                error,
            });
            throw error;
        }
        finally {
            reloadingRef.current = false;
        }
    }, [log, player, publish, setPausedIntent, webControls]);
    useEffect(() => {
        mountedRef.current = true;
        const host = hostRef.current;
        if (!host)
            return;
        log.info('player-mount', {
            itemId: media.id,
            mediaKind: media.kind,
            startPositionMs: initialStartPositionMs,
            catalogueDurationMs: media.durationMs,
            platform: platform.name,
        });
        player.attach(host);
        const unsubscribe = player.subscribe((next) => {
            if (!mountedRef.current || reloadingRef.current)
                return;
            const activeSession = sessionRef.current;
            const durationMs = activeSession?.durationMs || next.durationMs;
            const absolutePositionMs = next.positionMs + streamOffsetRef.current;
            const committedSeek = committedSeekRef.current;
            if (committedSeek !== undefined) {
                // Native and transformed seeks still use a committed target because the
                // old generation may publish stale events while it is being replaced.
                if (Math.abs(absolutePositionMs - committedSeek) > 1_500)
                    return;
                clearCommittedSeek();
            }
            const absoluteEvent = {
                ...next,
                positionMs: absolutePositionMs,
                durationMs,
            };
            const pendingDirectSeek = directSeekResumeRef.current;
            const desiredSeek = desiredSeekRef.current;
            if (pendingDirectSeek && desiredSeek !== undefined
                && webSeekHasResumed(absoluteEvent, desiredSeek, pendingDirectSeek.resumeAfterSeek)) {
                const targetMs = desiredSeek;
                clearDesiredSeek();
                setSeekInFlight(false);
                log.info(activeSession?.mode === 'direct' ? 'seek-direct-resumed' : 'seek-hls-local-resumed', {
                    sessionId: sessionRef.current?.sessionId,
                    positionMs: absolutePositionMs,
                    targetMs,
                    buffering: absoluteEvent.buffering,
                });
            }
            publish(absoluteEvent);
        });
        void (async () => {
            if (initialFatalError) {
                setStarting(false);
                return;
            }
            let resolved;
            try {
                const capabilitiesStartedAt = performance.now();
                const capabilities = await platform.capabilities();
                log.debug('capabilities-ready', { elapsedMs: Math.round((performance.now() - capabilitiesStartedAt) * 10) / 10, capabilities });
                const resolveStartedAt = performance.now();
                let preparedStartupPosition = pendingStartupPositionRef.current;
                resolved = await playbackResolver.resolve(media, capabilities, preparedStartupPosition);
                log.info('session-resolved', {
                    elapsedMs: Math.round((performance.now() - resolveStartedAt) * 10) / 10,
                    sessionId: resolved.sessionId,
                    mode: resolved.mode,
                    durationMs: resolved.durationMs,
                    startPositionMs: initialStartPositionMs,
                });
                if (!mountedRef.current) {
                    await playbackResolver.stop(resolved.sessionId);
                    return;
                }
                let absolutePosition = Math.min(pendingStartupPositionRef.current, resolved.durationMs || pendingStartupPositionRef.current);
                if (absolutePosition > 0 && resolved.mode !== 'direct' && !resolved.options.canSeek) {
                    setPlaybackNotice('This stream cannot seek; starting from the beginning.');
                    absolutePosition = 0;
                    pendingStartupPositionRef.current = 0;
                    setScrubPosition(0);
                }
                if (resolved.mode !== 'direct' && resolved.options.canSeek) {
                    // The initial resume position is sent with session creation. On Web,
                    // a transformed HLS generation is a complete VOD presentation from
                    // resolved.seekMs onward, so any newer forward seek intent can be
                    // satisfied locally. Only a target before the generation start needs
                    // a replacement server generation. Other platforms retain their
                    // established server-backed transformed seek behaviour.
                    while (mountedRef.current) {
                        absolutePosition = Math.min(pendingStartupPositionRef.current, resolved.durationMs || pendingStartupPositionRef.current);
                        const serverSeekTarget = startupTransformedServerSeekTarget(resolved, absolutePosition, preparedStartupPosition, webControls);
                        if (serverSeekTarget === undefined)
                            break;
                        preparedStartupPosition = serverSeekTarget;
                        const initialSeekStartedAt = performance.now();
                        log.info('initial-server-seek-begin', { sessionId: resolved.sessionId, positionMs: serverSeekTarget, mode: resolved.mode });
                        resolved = await playbackResolver.update(resolved.sessionId, { seekMs: serverSeekTarget });
                        log.info('initial-server-seek-complete', {
                            sessionId: resolved.sessionId,
                            positionMs: absolutePosition,
                            mode: resolved.mode,
                            elapsedMs: Math.round((performance.now() - initialSeekStartedAt) * 10) / 10,
                        });
                        if (!mountedRef.current) {
                            await playbackResolver.stop(resolved.sessionId).catch(() => undefined);
                            return;
                        }
                    }
                }
                await loadSession(resolved, absolutePosition);
            }
            catch (error) {
                log.error('player-startup-failed', error);
                if (!mountedRef.current)
                    return;
                const failedSessionId = sessionRef.current?.sessionId ?? resolved?.sessionId;
                sessionRef.current = undefined;
                setSession(undefined);
                try {
                    player.stop();
                }
                catch (stopError) {
                    log.warn('failed-native-player-stop-failed', { error: stopError });
                }
                if (failedSessionId) {
                    await playbackResolver.stop(failedSessionId).catch((stopError) => {
                        log.warn('failed-session-stop-failed', { sessionId: failedSessionId, error: stopError });
                    });
                }
                setFatalError(error instanceof Error ? error : new Error(String(error)));
            }
            finally {
                if (mountedRef.current)
                    setStarting(false);
            }
        })();
        return () => {
            log.info('player-unmount', { sessionId: sessionRef.current?.sessionId, latest: latestRef.current });
            mountedRef.current = false;
            if (directSeekDispatchTimerRef.current !== undefined)
                window.clearTimeout(directSeekDispatchTimerRef.current);
            directSeekDispatchTimerRef.current = undefined;
            unsubscribe();
            player.detach();
            const activeSession = sessionRef.current;
            if (activeSession)
                void playbackResolver.stop(activeSession.sessionId).catch(() => undefined);
        };
    }, [clearCommittedSeek, clearDesiredSeek, initialFatalError, initialStartPositionMs, loadSession, log, media, platform, playbackResolver, player, publish, webControls]);
    useEffect(() => {
        if (presentation === 'full') {
            if (hideTimerRef.current !== undefined)
                window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = undefined;
            setOptionsVisible(false);
            setControlsVisible(!interactionControlled);
        }
        return () => {
            if (hideTimerRef.current !== undefined)
                window.clearTimeout(hideTimerRef.current);
        };
    }, [interactionControlled, presentation]);
    useEffect(() => {
        if (!fatalError)
            return;
        setControlsVisible(true);
        setOptionsVisible(false);
        if (hideTimerRef.current !== undefined)
            window.clearTimeout(hideTimerRef.current);
    }, [fatalError]);
    useEffect(() => () => {
        if (!shouldTrackProgress(media))
            return;
        const latest = latestRef.current;
        if (!latest.durationMs)
            return;
        onProgress({
            mediaId: media.id,
            positionMs: latest.positionMs,
            durationMs: latest.durationMs,
            updatedAt: Date.now(),
            media,
        });
    }, [media, onProgress]);
    const setPaused = useCallback((paused) => {
        setPausedIntent(paused);
        const activeSession = sessionRef.current;
        if (!activeSession) {
            if (fatalError) {
                setPlaybackNotice(fatalError.message);
                return;
            }
            log.info('pause-intent-queued', { paused, positionMs: pendingStartupPositionRef.current });
            publish({ ...latestRef.current, paused });
        }
        else {
            log.info(paused ? 'pause-ui-request' : 'play-ui-request', { sessionId: activeSession.sessionId, positionMs: latestRef.current.positionMs });
            if (paused)
                player.pause();
            else
                player.resume();
            publish({ ...latestRef.current, paused });
        }
        if (!interactionControlled) {
            if (paused) {
                setControlsVisible(true);
                if (hideTimerRef.current !== undefined)
                    window.clearTimeout(hideTimerRef.current);
            }
            else {
                showControls();
            }
        }
    }, [fatalError, interactionControlled, log, player, publish, setPausedIntent, showControls]);
    const seek = useCallback(async (positionMs) => {
        const activeSession = sessionRef.current;
        if (!activeSession) {
            if (fatalError) {
                setPlaybackNotice(fatalError.message);
                return false;
            }
            const knownDuration = media.durationMs || latestRef.current.durationMs || Number.MAX_SAFE_INTEGER;
            const bounded = Math.max(0, Math.min(knownDuration, positionMs));
            pendingStartupPositionRef.current = bounded;
            setScrubPosition(bounded);
            publish({ ...latestRef.current, positionMs: bounded, ended: false });
            log.info('seek-intent-queued-before-session', { requestedPositionMs: positionMs, boundedPositionMs: bounded });
            return true;
        }
        if (!activeSession.options.canSeek) {
            setPlaybackNotice('This stream cannot seek.');
            return false;
        }
        const bounded = Math.max(0, Math.min(activeSession.durationMs, positionMs));
        if (controlBusyRef.current) {
            setScrubPosition(bounded);
            queueControl({ kind: 'seek', positionMs: bounded });
            log.info('seek-intent-queued', { sessionId: activeSession.sessionId, mode: activeSession.mode, positionMs: bounded });
            return true;
        }
        const previous = latestRef.current;
        const resumeAfterSeek = !previous.paused;
        log.info('seek-ui-request', {
            sessionId: activeSession.sessionId,
            mode: activeSession.mode,
            requestedPositionMs: positionMs,
            boundedPositionMs: bounded,
            currentPositionMs: previous.positionMs,
            resumeAfterSeek,
        });
        const transformedLocalPosition = webControls
            ? webTransformedLocalSeekPosition(activeSession, bounded)
            : undefined;
        const localHtml5Seek = (activeSession.mode === 'direct' && html5Player)
            || transformedLocalPosition !== undefined;
        if (!localHtml5Seek) {
            committedSeekRef.current = bounded;
            setScrubPosition(bounded);
        }
        if (!interactionControlled) {
            setControlsVisible(true);
            if (hideTimerRef.current !== undefined)
                window.clearTimeout(hideTimerRef.current);
        }
        if (activeSession.mode === 'direct' || transformedLocalPosition !== undefined) {
            const localSeekStartedAt = performance.now();
            let sequence;
            if (html5Player) {
                // Keep the user's requested absolute position separate from the media
                // element's reported time. Direct playback uses absolute media time; a
                // transformed HLS generation uses time relative to session.seekMs.
                // Repeated arrows/buttons accumulate against the latest desired target
                // and are coalesced so held keys do not thrash the demuxer.
                setDesiredSeek(bounded);
                directSeekResumeRef.current = { targetMs: bounded, resumeAfterSeek };
                beginSeekFeedback();
                const dispatch = () => {
                    directSeekDispatchTimerRef.current = undefined;
                    const targetMs = desiredSeekRef.current;
                    if (targetMs === undefined)
                        return;
                    const targetPlayerMs = activeSession.mode === 'direct'
                        ? targetMs
                        : webTransformedLocalSeekPosition(activeSession, targetMs);
                    // A subsequent input can cross backwards before this HLS generation
                    // while a local dispatch is pending. That invocation switches to the
                    // server-backed fallback and clears this timer/desired seek.
                    if (targetPlayerMs === undefined)
                        return;
                    directSeekLastDispatchRef.current = performance.now();
                    directSeekResumeRef.current = {
                        targetMs,
                        resumeAfterSeek: directSeekResumeRef.current?.resumeAfterSeek ?? resumeAfterSeek,
                    };
                    player.seek(targetPlayerMs);
                };
                const elapsed = performance.now() - directSeekLastDispatchRef.current;
                const delayMs = Math.max(0, 120 - elapsed);
                if (delayMs === 0) {
                    if (directSeekDispatchTimerRef.current !== undefined) {
                        window.clearTimeout(directSeekDispatchTimerRef.current);
                        directSeekDispatchTimerRef.current = undefined;
                    }
                    dispatch();
                }
                else if (directSeekDispatchTimerRef.current === undefined) {
                    directSeekDispatchTimerRef.current = window.setTimeout(dispatch, delayMs);
                }
                if (activeSession.mode === 'direct') {
                    sequence = directSeekSyncRef.current?.schedule(activeSession.sessionId, bounded);
                }
            }
            else {
                // Preserve the established native-player Direct behaviour on Android/Tizen.
                player.pause();
                publish({ ...previous, positionMs: bounded, paused: true, ended: false });
                player.seek(bounded);
                if (resumeAfterSeek)
                    player.resume();
            }
            log.info(activeSession.mode === 'direct' ? 'seek-direct-dispatched' : 'seek-hls-local-dispatched', {
                elapsedMs: Math.round((performance.now() - localSeekStartedAt) * 10) / 10,
                positionMs: bounded,
                localPositionMs: activeSession.mode === 'direct' ? bounded : transformedLocalPosition,
                streamOffsetMs: streamOffsetRef.current,
                resumeAfterSeek,
                optimistic: html5Player,
                sessionSyncSequence: sequence,
            });
            return true;
        }
        directSeekSyncRef.current?.clearPending();
        clearDesiredSeek();
        // Server-backed seek generations can take long enough to be perceptible.
        // Pause the old stream immediately but delay the spinner so a fast restart
        // looks like one continuous interaction rather than a flash of loading UI.
        reloadingRef.current = true;
        player.pause();
        publish({ ...previous, positionMs: bounded, paused: true, ended: false });
        setControlsBusy(true);
        beginSeekFeedback();
        setPlaybackNotice('Seeking…');
        const seekStartedAt = performance.now();
        try {
            const selectedSubtitle = activeSession.selected.subtitleStream;
            const updated = await playbackResolver.update(activeSession.sessionId, {
                seekMs: bounded,
                // A seek creates a new transformed stream generation. Preserve the
                // currently selected subtitle explicitly so the server issues the
                // matching subtitle capability/manifest for that generation instead
                // of falling back to the session default (usually Off).
                preferences: {
                    subtitleStream: selectedSubtitle >= 0 ? selectedSubtitle : null,
                    subtitleLanguage: activeSession.preferences.subtitleLanguage,
                },
            });
            const next = preserveSeekSubtitleState(activeSession, updated);
            log.info('seek-server-updated', {
                sessionId: next.sessionId,
                mode: next.mode,
                positionMs: bounded,
                elapsedMs: Math.round((performance.now() - seekStartedAt) * 10) / 10,
            });
            if (!mountedRef.current) {
                await playbackResolver.stop(next.sessionId).catch(() => undefined);
                return false;
            }
            await loadSession(next, bounded, resumeAfterSeek);
            clearCommittedSeek();
            log.info('seek-complete', {
                sessionId: next.sessionId,
                mode: next.mode,
                positionMs: bounded,
                elapsedMs: Math.round((performance.now() - seekStartedAt) * 10) / 10,
                resumeAfterSeek,
            });
            setPlaybackNotice(undefined);
            return true;
        }
        catch (error) {
            log.error('seek-failed', {
                sessionId: activeSession.sessionId,
                mode: activeSession.mode,
                positionMs: bounded,
                elapsedMs: Math.round((performance.now() - seekStartedAt) * 10) / 10,
                error,
            });
            reloadingRef.current = false;
            clearCommittedSeek();
            publish(previous);
            if (resumeAfterSeek)
                player.resume();
            if (mountedRef.current)
                setPlaybackNotice(error instanceof Error ? error.message : String(error));
            return false;
        }
        finally {
            reloadingRef.current = false;
            if (mountedRef.current) {
                setSeekInFlight(false);
                setControlsBusy(false);
            }
        }
    }, [beginSeekFeedback, clearCommittedSeek, clearDesiredSeek, fatalError, html5Player, interactionControlled, loadSession, log, media.durationMs, playbackResolver, player, publish, queueControl, setControlsBusy, setDesiredSeek, setScrubPosition, webControls]);
    const seekBy = useCallback((deltaMs) => {
        const activeSession = sessionRef.current;
        const durationMs = activeSession?.durationMs || media.durationMs || latestRef.current.durationMs || Number.MAX_SAFE_INTEGER;
        const actualPositionMs = activeSession ? latestRef.current.positionMs : pendingStartupPositionRef.current;
        const target = nextDesiredSeekPosition(desiredSeekRef.current, actualPositionMs, deltaMs, durationMs);
        void seek(target);
    }, [media.durationMs, seek]);
    const playFromStart = useCallback(async () => {
        const activeSession = sessionRef.current;
        log.info('restart-ui-request', {
            sessionId: activeSession?.sessionId,
            mode: activeSession?.mode,
            currentPositionMs: latestRef.current.positionMs,
        });
        const restarted = await seek(0);
        if (!restarted || !mountedRef.current)
            return;
        setPaused(false);
    }, [log, seek, setPaused]);
    const reconfigure = useCallback(async (update) => {
        const activeSession = sessionRef.current;
        if (!activeSession) {
            setPlaybackNotice(fatalError ? fatalError.message : 'Playback options are still loading.');
            return;
        }
        if (controlBusyRef.current) {
            queueControl({ kind: 'update', update });
            log.info('stream-update-intent-queued', { sessionId: activeSession.sessionId, update });
            return;
        }
        const position = latestRef.current.positionMs;
        const subtitleOnly = isSubtitleOnlyUpdate(update);
        if (subtitleOnly && !player.setSubtitle) {
            setPlaybackNotice('This platform cannot change subtitles without restarting playback.');
            return;
        }
        const updateStartedAt = performance.now();
        log.info('stream-update-ui-request', { sessionId: activeSession.sessionId, positionMs: position, subtitleOnly, update });
        directSeekSyncRef.current?.clearPending();
        clearDesiredSeek();
        setSeekInFlight(false);
        setControlsBusy(true);
        setPlaybackNotice(subtitleOnly ? 'Loading subtitles…' : 'Updating stream…');
        try {
            const request = subtitleOnly
                ? update
                : {
                    ...update,
                    seekMs: activeSession.options.canSeek ? position : update.seekMs,
                };
            const next = await playbackResolver.update(activeSession.sessionId, request);
            log.info('stream-update-server-complete', {
                sessionId: next.sessionId,
                mode: next.mode,
                positionMs: position,
                subtitleOnly,
                elapsedMs: Math.round((performance.now() - updateStartedAt) * 10) / 10,
            });
            if (!mountedRef.current) {
                await playbackResolver.stop(next.sessionId).catch(() => undefined);
                return;
            }
            if (subtitleOnly) {
                await player.setSubtitle(next.source.subtitleUrl);
                sessionRef.current = next;
                setSession(next);
            }
            else {
                await loadSession(next, position, !latestRef.current.paused);
            }
            log.info('stream-update-complete', {
                sessionId: next.sessionId,
                mode: next.mode,
                positionMs: position,
                subtitleOnly,
                elapsedMs: Math.round((performance.now() - updateStartedAt) * 10) / 10,
            });
            setPlaybackNotice(undefined);
        }
        catch (error) {
            log.error('stream-update-failed', {
                sessionId: activeSession.sessionId,
                positionMs: position,
                subtitleOnly,
                elapsedMs: Math.round((performance.now() - updateStartedAt) * 10) / 10,
                update,
                error,
            });
            if (mountedRef.current)
                setPlaybackNotice(error instanceof Error ? error.message : String(error));
        }
        finally {
            if (mountedRef.current)
                setControlsBusy(false);
        }
    }, [clearDesiredSeek, fatalError, loadSession, log, playbackResolver, player, queueControl, setControlsBusy]);
    seekActionRef.current = seek;
    updateActionRef.current = reconfigure;
    useEffect(() => {
        if (controlBusy || queuedControlsRef.current.length === 0)
            return;
        const next = queuedControlsRef.current.shift();
        if (!next)
            return;
        // A direct seek does not enter the busy state, so explicitly advance the
        // drain generation after consuming an item. Server-backed updates/seeks
        // will additionally retrigger this effect when their busy state clears.
        setQueuedControlGeneration((generation) => generation + 1);
        if (next.kind === 'seek')
            void seekActionRef.current(next.positionMs);
        else
            void updateActionRef.current(next.update);
    }, [controlBusy, queuedControlGeneration]);
    useEffect(() => {
        const onFullscreenChange = () => {
            setFullscreen(document.fullscreenElement === pageRef.current);
            if (presentation === 'full' && !interactionControlled)
                showControls();
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, [interactionControlled, presentation, showControls]);
    useEffect(() => {
        if (presentation === 'mini' && document.fullscreenElement === pageRef.current) {
            void document.exitFullscreen().catch(() => undefined);
        }
    }, [presentation]);
    useEffect(() => {
        if (samsungControls)
            requestTvDefaultFocus();
    }, [presentation, samsungControls]);
    const toggleFullscreen = useCallback(async () => {
        if (platform.name !== 'web' || !document.fullscreenEnabled || !pageRef.current)
            return;
        try {
            if (document.fullscreenElement)
                await document.exitFullscreen();
            else
                await pageRef.current.requestFullscreen();
        }
        catch (error) {
            log.warn('fullscreen-failed', { error });
        }
    }, [log, platform.name]);
    useEffect(() => {
        const onKeyDown = (keyEvent) => {
            const samsungBack = samsungControls && (keyEvent.keyCode === 10009
                || keyEvent.key === 'Escape'
                || keyEvent.key === 'Backspace'
                || keyEvent.key === 'BrowserBack'
                || keyEvent.key === 'XF86Back');
            const samsungOk = samsungControls && (keyEvent.key === 'Enter' || keyEvent.keyCode === 13);
            const samsungDirection = samsungControls && (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Left', 'Right', 'Up', 'Down'].includes(keyEvent.key)
                || [37, 38, 39, 40].includes(keyEvent.keyCode));
            if (presentation === 'full' && samsungBack) {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                onMinimize();
                return;
            }
            if (presentation === 'full' && samsungOk && !controlsVisible) {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                showControls();
                window.setTimeout(focusSamsungControls, 0);
                return;
            }
            if (presentation === 'full' && samsungDirection) {
                if (!controlsVisible) {
                    // Hidden player controls are the only Samsung navigation target on
                    // the full player. Do not let D-pad input move focus behind it.
                    keyEvent.preventDefault();
                    keyEvent.stopPropagation();
                    return;
                }
                armControlsHide();
            }
            if (presentation === 'full' && !samsungControls && keyEvent.key === 'Escape' && document.fullscreenElement)
                return;
            if (presentation === 'full' && !samsungControls && (keyEvent.key === 'Escape' || keyEvent.key === 'Backspace')) {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                if (optionsVisible)
                    setOptionsVisible(false);
                else
                    onMinimize();
                return;
            }
            if (keyEvent.key === 'MediaPlayPause' || (presentation === 'full' && keyEvent.key === ' ')) {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                setPaused(starting || controlBusyRef.current ? !desiredPausedRef.current : !latestRef.current.paused);
                return;
            }
            if (keyEvent.key === 'MediaPlay') {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                setPaused(false);
                return;
            }
            if (keyEvent.key === 'MediaPause') {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                setPaused(true);
                return;
            }
            if (presentation === 'full' && webControls && !keyEvent.altKey && !keyEvent.ctrlKey && !keyEvent.metaKey) {
                const delta = webSeekDeltaForKey(keyEvent.key);
                const targetOwnsArrowKeys = webArrowTargetOwnsKey(keyEvent.target);
                if (delta !== undefined && !targetOwnsArrowKeys) {
                    keyEvent.preventDefault();
                    keyEvent.stopPropagation();
                    showControls();
                    seekBy(delta);
                    return;
                }
            }
            if (keyEvent.key === 'MediaRewind') {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                seekBy(-10_000);
                return;
            }
            if (keyEvent.key === 'MediaFastForward') {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                seekBy(10_000);
                return;
            }
            if (presentation === 'full' && !interactionControlled)
                showControls();
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [armControlsHide, controlsVisible, focusSamsungControls, hideControls, interactionControlled, onMinimize, optionsVisible, presentation, samsungControls, seekBy, setPaused, showControls, starting, webControls]);
    const duration = session?.durationMs || event.durationMs || 1;
    const displayedProgress = scrubValue ?? Math.min(duration, event.positionMs);
    const audio = media.kind === 'track';
    const streamStatus = describePlaybackSession(session);
    const mediaSubtitle = media.kind === 'episode'
        ? `${media.playbackContext?.series.title ?? ''} ${media.subtitle ?? ''}`.trim()
        : media.subtitle;
    const pausedForControl = starting || controlBusy ? desiredPaused : event.paused;
    const queueLabel = queuePosition && queuePosition.total > 1 ? `${queuePosition.index + 1} of ${queuePosition.total}` : undefined;
    const playerSubtitle = [mediaSubtitle, queueLabel].filter(Boolean).join(' · ');
    return (_jsxs("section", { ref: pageRef, className: `player-page player-presentation-${presentation} ${audio ? 'audio-player' : ''} ${fullscreen && !controlsVisible && !fatalError ? 'cursor-hidden' : ''} ${fatalError ? 'player-failed' : ''}`, onPointerMove: (pointerEvent) => {
            if (presentation !== 'full')
                return;
            if (webControls) {
                if (!pointerEvent.pointerType || pointerEvent.pointerType === 'mouse')
                    noteWebPointerMovement(pointerEvent.clientY);
            }
            else if (!samsungControls) {
                showControls();
            }
        }, onPointerDown: () => {
            if (presentation === 'full' && !interactionControlled)
                showControls();
        }, onClick: (clickEvent) => {
            if (presentation === 'full') {
                if (webControls) {
                    const target = clickEvent.target;
                    if (!target.closest('.player-chrome'))
                        hideControls();
                }
                return;
            }
            const target = clickEvent.target;
            if (!target.closest('button, input'))
                onExpand();
        }, children: [backdrop && _jsx("div", { className: "player-backdrop", style: { backgroundImage: `url(${JSON.stringify(backdrop)})` } }), _jsx("div", { ref: hostRef, className: "player-host" }), audio && (_jsx("div", { className: "audio-player-art", children: cover ? _jsx("img", { src: cover, alt: "" }) : _jsx("div", { className: "audio-player-placeholder", children: "\u266A" }) })), starting && _jsx(Loading, {}), seekInFlight && _jsx(Loading, { delayMs: uiSettings.playerSeekSpinnerDelayMs }, seekFeedbackGeneration), fatalError && (_jsxs("div", { className: "player-fatal-error", role: "alert", children: [_jsx("strong", { children: "Playback failed" }), _jsx("span", { children: fatalError.message })] })), _jsxs("div", { ref: chromeRef, className: `player-chrome ${controlsVisible || fatalError ? 'visible' : ''}`, onPointerDown: () => { if (webControls)
                    showControls(); }, children: [_jsxs("div", { className: "player-titlebar", children: [_jsxs("div", { className: "player-title-copy", children: [_jsx("strong", { children: media.title }), playerSubtitle && _jsx("span", { children: playerSubtitle })] }), _jsx("div", { className: "player-stream-status", "aria-live": "polite", children: playbackNotice ? (_jsx("small", { children: playbackNotice })) : (_jsxs(_Fragment, { children: [streamStatus?.video && _jsx("small", { children: streamStatus.video }), streamStatus?.audio && _jsx("small", { children: streamStatus.audio }), streamStatus?.subtitle && _jsx("small", { children: streamStatus.subtitle })] })) })] }), optionsVisible && (session ? (_jsx(PlayerOptions, { session: session, onApply: (update) => void reconfigure(update) })) : (_jsx("div", { className: "player-options player-options-loading", "aria-live": "polite", children: "Playback options are loading. Transport controls remain available." }))), _jsxs("div", { className: "player-scrubber-row", children: [_jsx("span", { children: formatTime(displayedProgress) }), samsungControls ? (_jsx("div", { className: "player-scrubber-display", role: "progressbar", "aria-label": "Playback position", "aria-valuemin": 0, "aria-valuemax": Math.max(1, duration), "aria-valuenow": Math.max(0, Math.min(duration, displayedProgress)), children: _jsx("span", { style: { width: `${Math.min(100, displayedProgress / Math.max(1, duration) * 100)}%` } }) })) : (_jsx("input", { className: "player-scrubber", type: "range", min: 0, max: Math.max(1, duration), step: 1_000, value: displayedProgress, "aria-label": "Playback position", "data-tv-focusable": "true", "aria-busy": controlBusy || undefined, onChange: (changeEvent) => {
                                    setScrubPosition(Number(changeEvent.target.value));
                                }, onPointerUp: () => {
                                    const position = scrubValueRef.current;
                                    if (position !== undefined)
                                        void seek(position);
                                }, onKeyUp: (keyEvent) => {
                                    const position = scrubValueRef.current;
                                    if (position !== undefined && ['Home', 'End'].includes(keyEvent.key))
                                        void seek(position);
                                }, onBlur: () => {
                                    const position = scrubValueRef.current;
                                    if (position !== undefined)
                                        void seek(position);
                                } })), _jsx("span", { children: formatTime(duration) })] }), _jsxs("div", { className: "player-button-row", children: [_jsx("button", { type: "button", "data-tv-focusable": "true", onClick: onMinimize, "aria-label": "Minimise player", children: _jsx(PlayerIcon, { name: "back" }) }), queuePosition && queuePosition.total > 1 && (_jsx("button", { type: "button", "data-tv-focusable": "true", onClick: () => { if (canPrevious)
                                    onPrevious();
                                else
                                    setPlaybackNotice('Already at the first item.'); }, "aria-label": "Previous item", children: _jsx(PlayerIcon, { name: "previous" }) })), _jsx("button", { type: "button", "data-tv-focusable": "true", onClick: () => void playFromStart(), "aria-label": "Play from start", title: "Play from start", children: _jsx(RestartIcon, {}) }), _jsx("button", { type: "button", "data-tv-focusable": "true", onClick: () => seekBy(-10_000), "aria-label": "Seek backward", children: _jsx(PlayerIcon, { name: "rewind" }) }), _jsx("button", { type: "button", "data-tv-focusable": "true", "data-tv-default-focus": samsungControls ? 'true' : undefined, onClick: () => setPaused(!pausedForControl), "aria-label": pausedForControl ? 'Play' : 'Pause', children: pausedForControl ? _jsx(PlayIcon, {}) : _jsx(PlayerIcon, { name: "pause" }) }), _jsx("button", { type: "button", "data-tv-focusable": "true", onClick: () => seekBy(10_000), "aria-label": "Seek forward", children: _jsx(PlayerIcon, { name: "forward" }) }), queuePosition && queuePosition.total > 1 && (_jsx("button", { type: "button", "data-tv-focusable": "true", onClick: () => { if (canNext)
                                    onNext();
                                else
                                    setPlaybackNotice('Already at the last item.'); }, "aria-label": "Next item", children: _jsx(PlayerIcon, { name: "next" }) })), _jsx("button", { type: "button", "data-tv-focusable": "true", className: optionsVisible ? 'selected' : undefined, onClick: () => {
                                    setOptionsVisible((visible) => !visible);
                                    if (!interactionControlled)
                                        showControls();
                                }, "aria-label": "Playback options", children: _jsx(PlayerIcon, { name: "options" }) }), !samsungControls && _jsx(VolumeControl, { volume: volume, onChange: onVolumeChange }), platform.name === 'web' && document.fullscreenEnabled && (_jsx("button", { type: "button", "data-tv-focusable": "true", onClick: () => void toggleFullscreen(), "aria-label": fullscreen ? 'Exit fullscreen' : 'Fullscreen', title: fullscreen ? 'Exit fullscreen' : 'Fullscreen', children: _jsx(PlayerIcon, { name: fullscreen ? 'fullscreen-exit' : 'fullscreen' }) })), _jsx("button", { type: "button", "data-tv-focusable": "true", onClick: onStop, "aria-label": "Stop playback and close player", title: "Close player", children: _jsx(PlayerIcon, { name: "close" }) })] })] }), _jsxs("div", { className: "player-mini-chrome", "aria-label": "Now playing", children: [_jsxs("button", { className: "player-mini-copy", type: "button", "data-tv-focusable": "true", onClick: onExpand, "aria-label": `Open player for ${media.title}`, children: [_jsx("span", { className: "player-mini-title", children: media.title }), _jsx("span", { className: "player-mini-subtitle", children: fatalError ? `Playback failed · ${fatalError.message}` : playerSubtitle || 'Now playing' }), _jsxs("span", { className: "player-mini-time", children: [formatTime(displayedProgress), " / ", formatTime(duration)] }), _jsx("span", { className: "player-mini-progress", "aria-hidden": "true", children: _jsx("span", { style: { width: `${Math.min(100, displayedProgress / Math.max(1, duration) * 100)}%` } }) })] }), _jsxs("div", { className: "player-mini-controls", children: [queuePosition && queuePosition.total > 1 && (_jsx("button", { type: "button", "data-tv-focusable": "true", onClick: () => { if (canPrevious)
                                    onPrevious();
                                else
                                    setPlaybackNotice('Already at the first item.'); }, "aria-label": "Previous item", children: _jsx(PlayerIcon, { name: "previous" }) })), _jsx("button", { type: "button", "data-tv-focusable": "true", "data-tv-default-focus": samsungControls ? 'true' : undefined, onClick: () => setPaused(!pausedForControl), "aria-label": pausedForControl ? 'Play' : 'Pause', children: pausedForControl ? _jsx(PlayIcon, {}) : _jsx(PlayerIcon, { name: "pause" }) }), queuePosition && queuePosition.total > 1 && (_jsx("button", { type: "button", "data-tv-focusable": "true", onClick: () => { if (canNext)
                                    onNext();
                                else
                                    setPlaybackNotice('Already at the last item.'); }, "aria-label": "Next item", children: _jsx(PlayerIcon, { name: "next" }) })), !samsungControls && _jsx(VolumeControl, { volume: volume, onChange: onVolumeChange, compact: true }), _jsx("button", { type: "button", "data-tv-focusable": "true", onClick: onExpand, "aria-label": "Open full player", children: _jsx(PlayerIcon, { name: "expand" }) }), _jsx("button", { type: "button", "data-tv-focusable": "true", onClick: onStop, "aria-label": "Stop playback", children: _jsx(PlayerIcon, { name: "close" }) })] })] })] }));
}
export function PlayerHost(props) {
    const { request, ...sessionProps } = props;
    const media = request.media;
    const initialFatalError = !canPlay(media)
        ? new Error('This catalogue item is not directly playable.')
        : media.kind === 'episode' && !media.playbackContext
            ? new Error('Episode playback hierarchy context is missing.')
            : undefined;
    return (_jsx(PlayerSession, { ...sessionProps, media: media, startPositionMs: request.startPositionMs, initialFatalError: initialFatalError }, request.requestId));
}
