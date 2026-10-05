import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { availableToPlay } from '@machafoundation/core';
import { useLocation, useNavigate } from 'react-router-dom';
import type { MediaApi } from '@machafoundation/core';
import type { Platform } from '@machafoundation/core';
import type { PlaybackRuntime, PlaybackRuntimeSnapshot } from '@machafoundation/core';
import { pathForMedia, routes, type PlaybackRouteState } from '@machafoundation/core';
import { ContinueWatchingStore } from '@machafoundation/core';
import { migrateEpisodeContext, needsEpisodeContextMigration } from '@machafoundation/core';
import { PlaybackQueueStore, type PlaybackQueueState } from '@machafoundation/core';
import { VolumeStore } from '../state/volume';
import type { MediaSummary, PlaybackProgress } from '@machafoundation/core';
import type { StartPlaybackOptions } from './useMusicController';
import {
  playbackReturnTo,
  playbackStartsFromBeginning,
  playerRouteItemId,
  restoredPlaybackPosition,
  resumePreferences,
  routePlaybackMedia,
  versionPreferences,
} from '@machafoundation/core';

/** Restores the file, mode, cap and track choices a title was playing with; nothing without a saved entry. */
function resumeWith(entry: PlaybackProgress | undefined) {
  return entry ? resumePreferences(entry) : undefined;
}

export function usePlaybackController(options: {
  api: MediaApi;
  platform: Platform;
  runtime: PlaybackRuntime;
  runtimeState: PlaybackRuntimeSnapshot;
  progressStore: ContinueWatchingStore;
  queueStore: PlaybackQueueStore;
  volumeStore: VolumeStore;
  /**
   * An endpoint exists and the session attempt has settled. Gates only route
   * reconstruction, the one start that runs off a URL on a cold load.
   */
  ready: boolean;
}) {
  const { api, platform, runtime, runtimeState, progressStore, queueStore, volumeStore, ready } = options;
  const navigate = useNavigate();
  const location = useLocation();
  const activePlayback = runtimeState.request;
  // Set just before an explicit runtime.play(), so the route-reconstruction
  // effect does not start the same item a second time.
  const explicitlyStartedItemIdRef = useRef<string | undefined>(undefined);
  // Set on an intentional stop from `/play/:id`: if the runtime clears its request
  // before the router leaves the route, reconstruction would restart the session.
  const suppressReconstructRef = useRef(false);
  const [queueState, setQueueState] = useState<PlaybackQueueState | undefined>(() => queueStore.load());
  const [volume, setVolume] = useState(() => platform.initialVolume?.() ?? volumeStore.load());
  const [continueWatching, setContinueWatching] = useState<PlaybackProgress[]>(() => (
    progressStore.list().filter((entry) => !needsEpisodeContextMigration(entry))
  ));

  useEffect(() => {
    let cancelled = false;
    const legacyEntries = progressStore.list().filter(needsEpisodeContextMigration);
    if (legacyEntries.length === 0) return undefined;
    void (async () => {
      const repaired: PlaybackProgress[] = [];
      for (const entry of legacyEntries) {
        try {
          repaired.push(await migrateEpisodeContext(api, entry));
        } catch (error) {
          console.warn('[macha] unable to migrate legacy Continue Watching episode context', error);
        }
      }
      if (cancelled) return;
      let next = progressStore.list();
      for (const entry of repaired) next = progressStore.update(entry);
      setContinueWatching(next.filter((entry) => !needsEpisodeContextMigration(entry)));
    })();
    return () => { cancelled = true; };
  }, [api, progressStore]);

  const playerItemId = playerRouteItemId(location.pathname);
  const playerRouteActive = playerItemId !== undefined;
  const currentBrowsePath = playerRouteActive
    ? activePlayback?.returnTo ?? routes.home
    : `${location.pathname}${location.search}`;
  const progressById = useMemo(
    () => new Map(continueWatching.map((entry) => [entry.itemId, entry])),
    [continueWatching],
  );

  const updateProgress = useCallback((progress: PlaybackProgress) => {
    setContinueWatching(progressStore.update(progress));
  }, [progressStore]);
  const removeFromContinueWatching = useCallback((item: MediaSummary) => {
    setContinueWatching(progressStore.clear(item.id));
  }, [progressStore]);

  /**
   * Widens a lone playing episode's queue to its season. Runs after playback
   * starts, so the picture never waits on the request.
   */
  const widenToSeason = useCallback(async (episode: MediaSummary) => {
    const seasonId = episode.kind === 'episode' ? episode.playbackContext?.season.id : undefined;
    if (!seasonId) return;
    const season = await api.details(seasonId);
    if (season.kind !== 'season' || !('episodes' in season) || season.episodes.length < 2) return;
    const index = season.episodes.findIndex((candidate) => candidate.id === episode.id);
    if (index < 0) return;
    // Widen only the queue this call started; anything else is a later choice by the viewer.
    const current = queueStore.load();
    if (current?.items.length !== 1 || current.items[0]?.id !== episode.id) return;
    const widened = queueStore.replace(season.episodes, index);
    // `replace` resets the position to zero, which would restart the playing episode on a reload.
    setQueueState(current.positionMs > 0 ? queueStore.updatePosition(current.positionMs) ?? widened : widened);
  }, [api, queueStore]);

  const startPlayback = useCallback((item: MediaSummary, startOptions: StartPlaybackOptions = {}) => {
    // An unavailable title is never started, and is dropped from the queue.
    if (!availableToPlay(item)) return;
    const offered = startOptions.queue?.length ? startOptions.queue : [item];
    const requestedIndex = startOptions.queueIndex ?? offered.findIndex((candidate) => candidate.id === item.id);
    const queue = offered.filter((candidate, position) => position === requestedIndex || !!availableToPlay(candidate));
    const index = Math.max(0, requestedIndex >= 0 ? offered.slice(0, requestedIndex).filter((candidate) => !!availableToPlay(candidate)).length : 0);
    const persistedQueue = queueStore.replace(queue, index);
    setQueueState(persistedQueue);
    const stored = progressStore.list().find((entry) => entry.itemId === item.id);
    const storedPosition = stored?.positionMs ?? 0;
    const returnTo = playbackReturnTo(
      playerRouteActive,
      activePlayback?.returnTo,
      `${location.pathname}${location.search}`,
      item,
    );
    explicitlyStartedItemIdRef.current = item.id;
    const state: PlaybackRouteState = {
      media: item,
      queue: persistedQueue.items,
      queueIndex: persistedQueue.currentIndex,
      returnTo,
    };
    // Navigate, then start: the route picks full versus mini and the runtime picks
    // visibility, and both must land in one render or the player mounts as the mini
    // bar first. That relies on `AppRouter`'s `useTransitions={false}`.
    navigate(startOptions.fromStart ? routes.playerFromStart(item.id) : routes.player(item.id), { state });
    void runtime.play({
      media: item,
      startPositionMs: startOptions.fromStart ? 0 : storedPosition,
      returnTo,
    }, startOptions.version ? versionPreferences(startOptions.version) : resumeWith(startOptions.fromStart ? undefined : stored));
    if (persistedQueue.items.length === 1) {
      void widenToSeason(item).catch((error) => console.warn('[macha] unable to load the rest of the season', error));
    }
  }, [activePlayback?.returnTo, location.pathname, location.search, navigate, playerRouteActive, progressStore, queueStore, runtime, widenToSeason]);

  useEffect(() => {
    // Not before the client is connected: on a deep link this runs ahead of endpoint
    // discovery, and `runtime.play()` would fetch playback facts unauthenticated,
    // take a 401 and choose a format without them.
    if (!ready) return undefined;
    if (runtimeState.phase === 'stopping') return undefined;
    if (suppressReconstructRef.current) {
      // Clear only once the route has left `/play/:id`; any other render may be mid-race.
      if (!playerItemId) suppressReconstructRef.current = false;
      return undefined;
    }
    if (explicitlyStartedItemIdRef.current && explicitlyStartedItemIdRef.current !== playerItemId) {
      explicitlyStartedItemIdRef.current = undefined;
    }
    if (!playerItemId || activePlayback?.media.id === playerItemId) {
      explicitlyStartedItemIdRef.current = undefined;
      return undefined;
    }
    if (explicitlyStartedItemIdRef.current === playerItemId) {
      // startPlayback or selectQueueIndex already issued this play().
      explicitlyStartedItemIdRef.current = undefined;
      return undefined;
    }
    let cancelled = false;
    const routeState = (location.state as PlaybackRouteState | null) ?? undefined;
    const fromStart = playbackStartsFromBeginning(location.search);
    void (async () => {
      const persistedBeforeRoute = queueStore.load();
      const persistedRoutePosition = persistedBeforeRoute?.items[persistedBeforeRoute.currentIndex]?.id === playerItemId
        ? persistedBeforeRoute.positionMs
        : 0;
      let nextQueue = routeState?.queue?.length
        ? queueStore.replace(routeState.queue, routeState.queueIndex ?? 0)
        : persistedBeforeRoute;
      let queueIndex = nextQueue?.items.findIndex((item) => item.id === playerItemId) ?? -1;
      let media = routePlaybackMedia(
        playerItemId,
        routeState,
        nextQueue?.items,
        progressStore.list().find((entry) => entry.itemId === playerItemId)?.media,
      );
      if (!media) media = await api.details(playerItemId) as MediaSummary;
      if (cancelled) return;
      if (!nextQueue || queueIndex < 0) {
        nextQueue = queueStore.replace([media], 0);
        queueIndex = 0;
      } else if (queueIndex !== nextQueue.currentIndex) {
        nextQueue = queueStore.select(queueIndex) ?? nextQueue;
      }
      setQueueState(nextQueue);
      const stored = progressStore.list().find((entry) => entry.itemId === playerItemId);
      const storedPosition = stored?.positionMs ?? 0;
      const queuePosition = nextQueue.items[nextQueue.currentIndex]?.id === playerItemId ? nextQueue.positionMs : 0;
      void runtime.play({
        media,
        startPositionMs: restoredPlaybackPosition({
          fromStart,
          continueWatchingPositionMs: storedPosition,
          queuePositionMs: queuePosition,
          persistedRoutePositionMs: persistedRoutePosition,
        }),
        returnTo: routeState?.returnTo ?? pathForMedia(media),
      }, resumeWith(fromStart ? undefined : stored));
      // A deep link or reload builds the same lone queue as startPlayback, and needs the same widening.
      if (nextQueue.items.length === 1) await widenToSeason(media);
    })().catch((error) => console.error('[macha] unable to reconstruct playback route', error));
    return () => { cancelled = true; };
  }, [activePlayback?.media.id, api, location.search, location.state, playerItemId, progressStore, queueStore, ready, runtime, runtimeState.phase, widenToSeason]);

  const persistPlaybackPosition = useCallback((media: MediaSummary, positionMs: number) => {
    const persisted = queueStore.load();
    if (persisted?.items[persisted.currentIndex]?.id === media.id) queueStore.updatePosition(positionMs);
  }, [queueStore]);

  const selectQueueIndex = useCallback((nextIndex: number) => {
    if (!queueState || nextIndex < 0 || nextIndex >= queueState.items.length) return;
    const nextQueue = queueStore.select(nextIndex);
    if (!nextQueue) return;
    const media = nextQueue.items[nextIndex];
    setQueueState(nextQueue);
    explicitlyStartedItemIdRef.current = media.id;
    void runtime.play({ media, startPositionMs: 0, returnTo: activePlayback?.returnTo ?? currentBrowsePath });
    if (playerRouteActive) {
      const state: PlaybackRouteState = {
        media,
        queue: nextQueue.items,
        queueIndex: nextIndex,
        returnTo: activePlayback?.returnTo ?? currentBrowsePath,
      };
      navigate(routes.player(media.id), { replace: true, state });
    }
  }, [activePlayback?.returnTo, currentBrowsePath, navigate, playerRouteActive, queueState, queueStore, runtime]);

  const previous = useCallback(() => {
    if (queueState) selectQueueIndex(queueState.currentIndex - 1);
  }, [queueState, selectQueueIndex]);
  const next = useCallback(() => {
    if (queueState) selectQueueIndex(queueState.currentIndex + 1);
  }, [queueState, selectQueueIndex]);
  const handleEnded = useCallback(() => {
    if (queueState && queueState.currentIndex + 1 < queueState.items.length) {
      selectQueueIndex(queueState.currentIndex + 1);
      return;
    }
    queueStore.updatePosition(0);
    const returnTo = activePlayback?.returnTo ?? routes.home;
    if (playerRouteActive) {
      suppressReconstructRef.current = true;
      navigate(returnTo, { replace: true });
    }
    void runtime.stop();
  }, [activePlayback?.returnTo, navigate, playerRouteActive, queueState, queueStore, runtime, selectQueueIndex]);
  const minimize = useCallback(() => {
    if (activePlayback) navigate(activePlayback.returnTo || pathForMedia(activePlayback.media), { replace: true });
  }, [activePlayback, navigate]);
  const expand = useCallback(() => {
    if (!activePlayback) return;
    const returnTo = playerRouteActive ? activePlayback.returnTo : `${location.pathname}${location.search}`;
    runtime.setReturnTo(returnTo);
    navigate(routes.player(activePlayback.media.id), {
      state: { media: activePlayback.media, queue: queueState?.items, queueIndex: queueState?.currentIndex, returnTo } satisfies PlaybackRouteState,
    });
  }, [activePlayback, location.pathname, location.search, navigate, playerRouteActive, queueState, runtime]);
  /** Ends playback. Resolves once the node's playback session is closed, which sign-out must wait for. */
  const stop = useCallback((): Promise<void> => {
    const returnTo = activePlayback?.returnTo ?? routes.home;
    if (playerRouteActive) {
      suppressReconstructRef.current = true;
      navigate(returnTo, { replace: true });
    }
    setQueueState(undefined);
    queueStore.clear();
    return runtime.stop();
  }, [activePlayback?.returnTo, navigate, playerRouteActive, queueStore, runtime]);

  return {
    activePlayback,
    queueState,
    setQueueState,
    volume,
    continueWatching,
    changeVolume: (nextVolume: number) => setVolume(volumeStore.save(nextVolume)),
    progressById,
    updateProgress,
    removeFromContinueWatching,
    startPlayback,
    openAlbumTrack: (track: MediaSummary, queue: MediaSummary[], queueIndex: number) => startPlayback(track, { queue, queueIndex }),
    persistPlaybackPosition,
    previous,
    next,
    handleEnded,
    minimize,
    expand,
    stop,
    canPrevious: Boolean(queueState && queueState.currentIndex > 0),
    canNext: Boolean(queueState && queueState.currentIndex + 1 < queueState.items.length),
    playerRouteActive,
    playerVisible: Boolean(activePlayback && runtimeState.phase !== 'stopping'),
  };
}
