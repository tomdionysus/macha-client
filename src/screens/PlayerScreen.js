import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlayIcon, RestartIcon } from '../components/PlaybackIcons';
import { Loading } from '../components/Status';
import { createClientLogger } from '../diagnostics/ClientLog';
import { useArtworkUrl } from '../hooks/useArtworkUrl';
import { uiSettings } from '../settings';
import { describePlaybackSession } from '../playback/PlaybackStatus';
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
    }
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
export function isSubtitleOnlyUpdate(update) {
    if (update.seekMs !== undefined || update.mediaId !== undefined || !update.preferences)
        return false;
    const keys = Object.entries(update.preferences)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key);
    return keys.length > 0 && keys.every((key) => key === 'subtitleStream' || key === 'subtitleLanguage');
}
function PlayerOptions({ session, busy, onApply, }) {
    const selectedAudio = session.selected.audioStream;
    const selectedSubtitle = session.selected.subtitleStream;
    const qualities = qualityChoices(session);
    const mode = (value) => onApply({ preferences: { mode: value } });
    const preferences = (update) => onApply({ preferences: update });
    return (_jsxs("div", { className: "player-options", "aria-label": "Playback options", children: [_jsxs("div", { className: "player-option-group", children: [_jsx("span", { children: "Mode" }), _jsxs("div", { children: [_jsx("button", { type: "button", "data-tv-focusable": "true", className: session.preferences.mode === 'auto' ? 'selected' : undefined, disabled: busy, onClick: () => mode('auto'), children: "Auto" }), session.options.modes.map((candidate) => (_jsx("button", { type: "button", "data-tv-focusable": "true", className: session.preferences.mode === candidate ? 'selected' : undefined, disabled: busy, onClick: () => mode(candidate), children: candidate === 'direct' ? 'Direct' : candidate === 'remux' ? 'Remux' : 'Transcode' }, candidate)))] })] }), session.options.canChangeQuality && (_jsxs("div", { className: "player-option-group", children: [_jsx("span", { children: "Quality" }), _jsxs("div", { children: [_jsx("button", { type: "button", "data-tv-focusable": "true", className: session.preferences.maxHeight === null && session.preferences.maxBitrate === null ? 'selected' : undefined, disabled: busy, onClick: () => preferences({ maxHeight: null, maxBitrate: null }), children: "Original" }), qualities.map((height) => (_jsxs("button", { type: "button", "data-tv-focusable": "true", className: session.preferences.maxHeight === height ? 'selected' : undefined, disabled: busy, onClick: () => preferences({ maxHeight: height }), children: [height, "p"] }, height)))] })] })), session.options.audioStreams.length > 1 && (_jsxs("div", { className: "player-option-group", children: [_jsx("span", { children: "Audio" }), _jsx("div", { children: session.options.audioStreams.map((stream) => (_jsx("button", { type: "button", "data-tv-focusable": "true", className: selectedAudio === stream.index ? 'selected' : undefined, disabled: busy, onClick: () => preferences({ audioStream: stream.index, audioLanguage: '' }), children: streamLabel(stream, `Audio ${stream.index}`) }, stream.index))) })] })), session.options.subtitleStreams.length > 0 && (_jsxs("div", { className: "player-option-group", children: [_jsx("span", { children: "Subtitles" }), _jsxs("div", { children: [_jsx("button", { type: "button", "data-tv-focusable": "true", className: selectedSubtitle < 0 ? 'selected' : undefined, disabled: busy, onClick: () => preferences({ subtitleStream: null, subtitleLanguage: '' }), children: "Off" }), session.options.subtitleStreams.map((stream) => (_jsx("button", { type: "button", "data-tv-focusable": "true", className: selectedSubtitle === stream.index ? 'selected' : undefined, disabled: busy, onClick: () => preferences({ subtitleStream: stream.index, subtitleLanguage: '' }), children: streamLabel(stream, `Subtitle ${stream.index}`) }, stream.index)))] })] })), session.options.canSwitchMedia && session.options.mediaIds.length > 1 && (_jsxs("div", { className: "player-option-group", children: [_jsx("span", { children: "Source" }), _jsx("div", { children: session.options.mediaIds.map((mediaId, index) => (_jsxs("button", { type: "button", "data-tv-focusable": "true", className: session.mediaId === mediaId ? 'selected' : undefined, disabled: busy, title: mediaId, onClick: () => onApply({ mediaId }), children: ["Source ", index + 1] }, mediaId))) })] }))] }));
}
function PlayerSession({ api, media, platform, playbackResolver, startPositionMs, presentation, onProgress, onPosition, onMinimize, onExpand, onStop, onPrevious, onNext, onEnded, canPrevious, canNext, queuePosition, initialFatalError }) {
    const pageRef = useRef(null);
    const hostRef = useRef(null);
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
    const mountedRef = useRef(true);
    const endedHandledRef = useRef(false);
    const [event, setEvent] = useState(initialEvent);
    const [session, setSession] = useState();
    const [starting, setStarting] = useState(!initialFatalError);
    const [fatalError, setFatalError] = useState(initialFatalError);
    const [playbackNotice, setPlaybackNotice] = useState();
    const [controlsVisible, setControlsVisible] = useState(true);
    const [fullscreen, setFullscreen] = useState(false);
    const [optionsVisible, setOptionsVisible] = useState(false);
    const [controlBusy, setControlBusy] = useState(false);
    const [seekInFlight, setSeekInFlight] = useState(false);
    const [scrubValue, setScrubValue] = useState();
    const backdrop = useArtworkUrl(api, media.artwork?.backdrop ?? media.artwork?.thumbnail ?? media.artwork?.poster);
    const cover = useArtworkUrl(api, media.kind === 'track' ? media.artwork?.poster ?? media.artwork?.thumbnail : undefined);
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
    const showControls = useCallback(() => {
        setControlsVisible(true);
        if (hideTimerRef.current !== undefined)
            window.clearTimeout(hideTimerRef.current);
        if (!fatalError && !latestRef.current.paused && !optionsVisible && !controlBusy) {
            hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), uiSettings.playerControlsHideDelayMs);
        }
    }, [controlBusy, fatalError, optionsVisible]);
    const setScrubPosition = useCallback((positionMs) => {
        scrubValueRef.current = positionMs;
        setScrubValue(positionMs);
    }, []);
    const clearCommittedSeek = useCallback(() => {
        committedSeekRef.current = undefined;
        setScrubPosition(undefined);
    }, [setScrubPosition]);
    const loadSession = useCallback(async (next, absolutePositionMs, resumeAfterLoad = true) => {
        const bounded = Math.max(0, Math.min(next.durationMs || Number.MAX_SAFE_INTEGER, absolutePositionMs));
        const serverSeek = Math.max(0, Math.min(next.durationMs || Number.MAX_SAFE_INTEGER, next.seekMs));
        const effectivePosition = next.mode === 'direct' ? bounded : serverSeek;
        const localPosition = next.mode === 'direct' ? bounded : 0;
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
            if (!resumeAfterLoad && started)
                player.pause();
            log.info('session-load-ready', {
                sessionId: next.sessionId,
                mode: next.mode,
                started,
                resumeAfterLoad,
                elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
                absolutePositionMs: effectivePosition,
            });
            publish({
                positionMs: effectivePosition,
                durationMs: next.durationMs,
                paused: resumeAfterLoad ? !started : true,
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
    }, [log, player, publish]);
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
                // A browser may emit pause/timeupdate events from the old position after
                // a range interaction. Keep the user's committed seek authoritative
                // until the player itself reaches the new position.
                if (Math.abs(absolutePositionMs - committedSeek) > 1_500)
                    return;
                clearCommittedSeek();
            }
            publish({
                ...next,
                positionMs: absolutePositionMs,
                durationMs,
            });
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
                resolved = await playbackResolver.resolve(media, capabilities);
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
                let absolutePosition = Math.min(initialStartPositionMs, resolved.durationMs || initialStartPositionMs);
                if (absolutePosition > 0 && resolved.mode !== 'direct' && resolved.options.canSeek) {
                    const initialSeekStartedAt = performance.now();
                    log.info('initial-server-seek-begin', { sessionId: resolved.sessionId, positionMs: absolutePosition, mode: resolved.mode });
                    resolved = await playbackResolver.update(resolved.sessionId, { seekMs: absolutePosition });
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
            unsubscribe();
            player.detach();
            const activeSession = sessionRef.current;
            if (activeSession)
                void playbackResolver.stop(activeSession.sessionId).catch(() => undefined);
        };
    }, [clearCommittedSeek, initialFatalError, initialStartPositionMs, loadSession, log, media, platform, playbackResolver, player, publish]);
    useEffect(() => {
        showControls();
        return () => {
            if (hideTimerRef.current !== undefined)
                window.clearTimeout(hideTimerRef.current);
        };
    }, [showControls]);
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
        if (!sessionRef.current) {
            log.warn('pause-toggle-without-session', { paused });
            return;
        }
        log.info(paused ? 'pause-ui-request' : 'play-ui-request', { sessionId: sessionRef.current.sessionId, positionMs: latestRef.current.positionMs });
        if (paused)
            player.pause();
        else
            player.resume();
        publish({ ...latestRef.current, paused });
        if (paused) {
            setControlsVisible(true);
            if (hideTimerRef.current !== undefined)
                window.clearTimeout(hideTimerRef.current);
        }
        else {
            showControls();
        }
    }, [log, player, publish, showControls]);
    const seek = useCallback(async (positionMs) => {
        const activeSession = sessionRef.current;
        if (!activeSession || controlBusy || !activeSession.options.canSeek)
            return false;
        const bounded = Math.max(0, Math.min(activeSession.durationMs, positionMs));
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
        committedSeekRef.current = bounded;
        setScrubPosition(bounded);
        setControlsVisible(true);
        if (hideTimerRef.current !== undefined)
            window.clearTimeout(hideTimerRef.current);
        if (activeSession.mode === 'direct') {
            // Freeze the current picture immediately, move the media element, then
            // resume only if playback was running before the seek. The committed
            // scrub value prevents stale media events snapping the bar backwards.
            player.pause();
            publish({ ...previous, positionMs: bounded, paused: true, ended: false });
            const directSeekStartedAt = performance.now();
            player.seek(bounded);
            if (resumeAfterSeek)
                player.resume();
            log.info('seek-direct-dispatched', {
                elapsedMs: Math.round((performance.now() - directSeekStartedAt) * 10) / 10,
                positionMs: bounded,
                resumeAfterSeek,
            });
            return true;
        }
        // Server-backed seek generations can take long enough to be perceptible.
        // Pause the old stream immediately but delay the spinner so a fast restart
        // looks like one continuous interaction rather than a flash of loading UI.
        reloadingRef.current = true;
        player.pause();
        publish({ ...previous, positionMs: bounded, paused: true, ended: false });
        setControlBusy(true);
        setSeekInFlight(true);
        setPlaybackNotice('Seeking…');
        const seekStartedAt = performance.now();
        try {
            const selectedSubtitle = activeSession.selected.subtitleStream;
            const next = await playbackResolver.update(activeSession.sessionId, {
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
                setControlBusy(false);
            }
        }
    }, [clearCommittedSeek, controlBusy, loadSession, log, playbackResolver, player, publish, setScrubPosition]);
    const playFromStart = useCallback(async () => {
        const activeSession = sessionRef.current;
        if (!activeSession || controlBusy || !activeSession.options.canSeek)
            return;
        log.info('restart-ui-request', {
            sessionId: activeSession.sessionId,
            mode: activeSession.mode,
            currentPositionMs: latestRef.current.positionMs,
        });
        const restarted = await seek(0);
        if (!restarted || !mountedRef.current)
            return;
        setPaused(false);
    }, [controlBusy, log, seek, setPaused]);
    const reconfigure = useCallback(async (update) => {
        const activeSession = sessionRef.current;
        if (!activeSession || controlBusy)
            return;
        const position = latestRef.current.positionMs;
        const subtitleOnly = isSubtitleOnlyUpdate(update);
        if (subtitleOnly && !player.setSubtitle) {
            setPlaybackNotice('This platform cannot change subtitles without restarting playback.');
            return;
        }
        const updateStartedAt = performance.now();
        log.info('stream-update-ui-request', { sessionId: activeSession.sessionId, positionMs: position, subtitleOnly, update });
        setControlBusy(true);
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
                await loadSession(next, position);
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
                setControlBusy(false);
        }
    }, [controlBusy, loadSession, log, playbackResolver, player]);
    useEffect(() => {
        const onFullscreenChange = () => {
            setFullscreen(document.fullscreenElement === pageRef.current);
            if (presentation === 'full')
                showControls();
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, [presentation, showControls]);
    useEffect(() => {
        if (presentation === 'mini' && document.fullscreenElement === pageRef.current) {
            void document.exitFullscreen().catch(() => undefined);
        }
    }, [presentation]);
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
            if (presentation === 'full' && keyEvent.key === 'Escape' && document.fullscreenElement)
                return;
            if (presentation === 'full' && (keyEvent.key === 'Escape' || keyEvent.key === 'Backspace')) {
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
                setPaused(!latestRef.current.paused);
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
            if (keyEvent.key === 'MediaRewind') {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                void seek(latestRef.current.positionMs - 10_000);
                return;
            }
            if (keyEvent.key === 'MediaFastForward') {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                void seek(latestRef.current.positionMs + 10_000);
                return;
            }
            if (presentation === 'full')
                showControls();
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [onMinimize, optionsVisible, presentation, seek, setPaused, showControls]);
    const duration = session?.durationMs || event.durationMs || 1;
    const displayedProgress = scrubValue ?? Math.min(duration, event.positionMs);
    const audio = media.kind === 'track';
    const streamStatus = describePlaybackSession(session);
    const mediaSubtitle = media.kind === 'episode'
        ? `${media.playbackContext?.series.title ?? ''} ${media.subtitle ?? ''}`.trim()
        : media.subtitle;
    const playbackAvailable = Boolean(session) && !fatalError;
    const queueLabel = queuePosition && queuePosition.total > 1 ? `${queuePosition.index + 1} of ${queuePosition.total}` : undefined;
    const playerSubtitle = [mediaSubtitle, queueLabel].filter(Boolean).join(' · ');
    return (_jsxs("section", { ref: pageRef, className: `player-page player-presentation-${presentation} ${audio ? 'audio-player' : ''} ${fullscreen && !controlsVisible && !fatalError ? 'cursor-hidden' : ''} ${fatalError ? 'player-failed' : ''}`, onPointerMove: () => { if (presentation === 'full')
            showControls(); }, onPointerDown: () => { if (presentation === 'full')
            showControls(); }, onClick: (clickEvent) => {
            if (presentation === 'full') {
                if (clickEvent.target === clickEvent.currentTarget)
                    showControls();
                return;
            }
            const target = clickEvent.target;
            if (!target.closest('button, input'))
                onExpand();
        }, children: [backdrop && _jsx("div", { className: "player-backdrop", style: { backgroundImage: `url(${JSON.stringify(backdrop)})` } }), _jsx("div", { ref: hostRef, className: "player-host" }), audio && (_jsx("div", { className: "audio-player-art", children: cover ? _jsx("img", { src: cover, alt: "" }) : _jsx("div", { className: "audio-player-placeholder", children: "\u266A" }) })), starting && _jsx(Loading, {}), seekInFlight && _jsx(Loading, { delayMs: uiSettings.playerSeekSpinnerDelayMs }), fatalError && (_jsxs("div", { className: "player-fatal-error", role: "alert", children: [_jsx("strong", { children: "Playback failed" }), _jsx("span", { children: fatalError.message })] })), _jsxs("div", { className: `player-chrome ${controlsVisible || fatalError ? 'visible' : ''}`, children: [_jsxs("div", { className: "player-titlebar", children: [_jsxs("div", { className: "player-title-copy", children: [_jsx("strong", { children: media.title }), playerSubtitle && _jsx("span", { children: playerSubtitle })] }), _jsx("div", { className: "player-stream-status", "aria-live": "polite", children: playbackNotice ? (_jsx("small", { children: playbackNotice })) : (_jsxs(_Fragment, { children: [streamStatus?.video && _jsx("small", { children: streamStatus.video }), streamStatus?.audio && _jsx("small", { children: streamStatus.audio })] })) })] }), optionsVisible && session && (_jsx(PlayerOptions, { session: session, busy: controlBusy, onApply: (update) => void reconfigure(update) })), _jsxs("div", { className: "player-scrubber-row", children: [_jsx("span", { children: formatTime(displayedProgress) }), _jsx("input", { className: "player-scrubber", type: "range", min: 0, max: Math.max(1, duration), step: 1_000, value: displayedProgress, "aria-label": "Playback position", "data-tv-focusable": "true", disabled: !session?.options.canSeek, "aria-busy": controlBusy || undefined, onChange: (changeEvent) => {
                                    if (!controlBusy)
                                        setScrubPosition(Number(changeEvent.target.value));
                                }, onPointerUp: () => {
                                    const position = scrubValueRef.current;
                                    if (!controlBusy && position !== undefined)
                                        void seek(position);
                                }, onKeyUp: (keyEvent) => {
                                    const position = scrubValueRef.current;
                                    if (!controlBusy && position !== undefined && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(keyEvent.key))
                                        void seek(position);
                                }, onBlur: () => {
                                    const position = scrubValueRef.current;
                                    if (!controlBusy && position !== undefined)
                                        void seek(position);
                                } }), _jsx("span", { children: formatTime(duration) })] }), _jsxs("div", { className: "player-button-row", children: [_jsx("button", { type: "button", "data-tv-focusable": "true", onClick: onMinimize, "aria-label": "Minimise player", children: _jsx(PlayerIcon, { name: "back" }) }), queuePosition && queuePosition.total > 1 && (_jsx("button", { type: "button", "data-tv-focusable": "true", disabled: !canPrevious || controlBusy, onClick: onPrevious, "aria-label": "Previous item", children: _jsx(PlayerIcon, { name: "previous" }) })), _jsx("button", { type: "button", "data-tv-focusable": "true", disabled: !playbackAvailable || !session?.options.canSeek || controlBusy, onClick: () => void playFromStart(), "aria-label": "Play from start", title: "Play from start", children: _jsx(RestartIcon, {}) }), _jsx("button", { type: "button", "data-tv-focusable": "true", disabled: !playbackAvailable || !session?.options.canSeek || controlBusy, onClick: () => void seek(displayedProgress - 10_000), "aria-label": "Seek backward", children: _jsx(PlayerIcon, { name: "rewind" }) }), _jsx("button", { type: "button", "data-tv-focusable": "true", disabled: !playbackAvailable || controlBusy, onClick: () => setPaused(!event.paused), "aria-label": event.paused ? 'Play' : 'Pause', children: event.paused ? _jsx(PlayIcon, {}) : _jsx(PlayerIcon, { name: "pause" }) }), _jsx("button", { type: "button", "data-tv-focusable": "true", disabled: !playbackAvailable || !session?.options.canSeek || controlBusy, onClick: () => void seek(displayedProgress + 10_000), "aria-label": "Seek forward", children: _jsx(PlayerIcon, { name: "forward" }) }), queuePosition && queuePosition.total > 1 && (_jsx("button", { type: "button", "data-tv-focusable": "true", disabled: !canNext || controlBusy, onClick: onNext, "aria-label": "Next item", children: _jsx(PlayerIcon, { name: "next" }) })), _jsx("button", { type: "button", "data-tv-focusable": "true", disabled: !playbackAvailable || controlBusy, className: optionsVisible ? 'selected' : undefined, onClick: () => { setOptionsVisible((visible) => !visible); setControlsVisible(true); }, "aria-label": "Playback options", children: _jsx(PlayerIcon, { name: "options" }) }), platform.name === 'web' && document.fullscreenEnabled && (_jsx("button", { type: "button", "data-tv-focusable": "true", onClick: () => void toggleFullscreen(), "aria-label": fullscreen ? 'Exit fullscreen' : 'Fullscreen', title: fullscreen ? 'Exit fullscreen' : 'Fullscreen', children: _jsx(PlayerIcon, { name: fullscreen ? 'fullscreen-exit' : 'fullscreen' }) })), _jsx("button", { type: "button", "data-tv-focusable": "true", onClick: onStop, "aria-label": "Stop playback and close player", title: "Close player", children: _jsx(PlayerIcon, { name: "close" }) })] })] }), _jsxs("div", { className: "player-mini-chrome", "aria-label": "Now playing", children: [_jsxs("button", { className: "player-mini-copy", type: "button", "data-tv-focusable": "true", onClick: onExpand, "aria-label": `Open player for ${media.title}`, children: [_jsx("span", { className: "player-mini-title", children: media.title }), _jsx("span", { className: "player-mini-subtitle", children: fatalError ? `Playback failed · ${fatalError.message}` : playerSubtitle || 'Now playing' }), _jsxs("span", { className: "player-mini-time", children: [formatTime(displayedProgress), " / ", formatTime(duration)] }), _jsx("span", { className: "player-mini-progress", "aria-hidden": "true", children: _jsx("span", { style: { width: `${Math.min(100, displayedProgress / Math.max(1, duration) * 100)}%` } }) })] }), _jsxs("div", { className: "player-mini-controls", children: [queuePosition && queuePosition.total > 1 && (_jsx("button", { type: "button", "data-tv-focusable": "true", disabled: !canPrevious || controlBusy, onClick: onPrevious, "aria-label": "Previous item", children: _jsx(PlayerIcon, { name: "previous" }) })), _jsx("button", { type: "button", "data-tv-focusable": "true", disabled: !playbackAvailable || controlBusy, onClick: () => setPaused(!event.paused), "aria-label": event.paused ? 'Play' : 'Pause', children: event.paused ? _jsx(PlayIcon, {}) : _jsx(PlayerIcon, { name: "pause" }) }), queuePosition && queuePosition.total > 1 && (_jsx("button", { type: "button", "data-tv-focusable": "true", disabled: !canNext || controlBusy, onClick: onNext, "aria-label": "Next item", children: _jsx(PlayerIcon, { name: "next" }) })), _jsx("button", { type: "button", "data-tv-focusable": "true", onClick: onExpand, "aria-label": "Open full player", children: _jsx(PlayerIcon, { name: "expand" }) }), _jsx("button", { type: "button", "data-tv-focusable": "true", onClick: onStop, "aria-label": "Stop playback", children: _jsx(PlayerIcon, { name: "close" }) })] })] })] }));
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
