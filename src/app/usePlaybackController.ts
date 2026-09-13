import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { MediaApi } from '@machafoundation/core';
import type { Platform } from '@machafoundation/core';
import type { PlaybackRuntime, PlaybackRuntimeSnapshot } from '@machafoundation/core';
import { pathForMedia, routes, type PlaybackRouteState } from '@machafoundation/core';
import { ContinueWatchingStore } from '@machafoundation/core';
import { migrateEpisodeContext, needsEpisodeContextMigration } from '@machafoundation/core';
import { PlaybackQueueStore, type PlaybackQueueState } from '@machafoundation/core';
import { VolumeStore } from '@machafoundation/core';
import type { Episode, MediaSummary, PlaybackProgress } from '@machafoundation/core';
import type { StartPlaybackOptions } from './useMusicController';
import {
  playbackReturnTo,
  playbackStartsFromBeginning,
  playerRouteItemId,
  restoredPlaybackPosition,
  routePlaybackMedia,
} from '@machafoundation/core';

export function usePlaybackController(options: {
  api: MediaApi;
  platform: Platform;
  runtime: PlaybackRuntime;
  runtimeState: PlaybackRuntimeSnapshot;
  progressStore: ContinueWatchingStore;
  queueStore: PlaybackQueueStore;
  volumeStore: VolumeStore;
}) {
  const { api, platform, runtime, runtimeState, progressStore, queueStore, volumeStore } = options;
  const navigate = useNavigate();
  const location = useLocation();
  const activePlayback = runtimeState.request;
  // Set immediately before any explicit runtime.play() call below and consumed
  // by the route-reconstruction effect, so a navigation that already started
  // playback deliberately is never re-started by that effect racing the same
  // tick (which would open a second, wasted generation/session).
  const explicitlyStartedItemIdRef = useRef<string | undefined>(undefined);
  // Stopping while still on the `/play/:id` route races the runtime clearing
  // its active request against the router committing the navigate-away —
  // if the runtime wins, the reconstruct-from-route effect below sees "on
  // the player route, no active playback", indistinguishable from a reload
  // deep-linked into the player, and restarts the very session that was
  // just told to stop. Suppress reconstruction until the route has actually
  // caught up with an intentional stop.
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
    () => new Map(continueWatching.map((entry) => [entry.mediaId, entry])),
    [continueWatching],
  );

  const updateProgress = useCallback((progress: PlaybackProgress) => {
    setContinueWatching(progressStore.update(progress));
  }, [progressStore]);
  const removeFromContinueWatching = useCallback((item: MediaSummary) => {
    setContinueWatching(progressStore.clear(item.id));
  }, [progressStore]);

  /**
   * Widen a lone episode into the season it belongs to, once it is playing.
   *
   * An episode reached from Continue Watching or from its own detail page
   * arrives on its own: no season screen was open, so no queue came with it,
   * and the transport showed no next or previous for something that plainly
   * has both. The rest of the season is one request away — but holding the
   * picture for a round trip to populate two buttons would be paying for them
   * with the thing the viewer actually asked for, so playback starts on the
   * single item and the siblings land behind it.
   */
  const widenToSeason = useCallback(async (episode: MediaSummary) => {
    const seasonId = episode.kind === 'episode' ? episode.playbackContext?.season.id : undefined;
    if (!seasonId) return;
    const season = await api.details(seasonId);
    if (season.kind !== 'season' || !('episodes' in season) || season.episodes.length < 2) return;
    const index = season.episodes.findIndex((candidate) => candidate.id === episode.id);
    if (index < 0) return;
    // Only the queue this call started may be widened. Anything else — another
    // title, a music queue built while the season was in flight — is something
    // the viewer chose after this, and replacing it would be rearranging their
    // playback to finish an errand they have already moved on from.
    const current = queueStore.load();
    if (current?.items.length !== 1 || current.items[0]?.id !== episode.id) return;
    const widened = queueStore.replace(season.episodes, index);
    // `replace` starts a queue at zero, which is right for a new one and wrong
    // here: this episode is already playing, and dropping its position would
    // restart it on a reload.
    setQueueState(current.positionMs > 0 ? queueStore.updatePosition(current.positionMs) ?? widened : widened);
  }, [api, queueStore]);

  const startPlayback = useCallback((item: MediaSummary, startOptions: StartPlaybackOptions = {}) => {
    const queue = startOptions.queue?.length ? startOptions.queue : [item];
    const requestedIndex = startOptions.queueIndex ?? queue.findIndex((candidate) => candidate.id === item.id);
    const index = requestedIndex >= 0 ? requestedIndex : 0;
    const persistedQueue = queueStore.replace(queue, index);
    setQueueState(persistedQueue);
    const storedPosition = progressStore.list().find((entry) => entry.mediaId === item.id)?.positionMs ?? 0;
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
    // Navigate, then start: presentation is chosen by the route
    // (`playerRouteActive` decides full versus mini) while visibility comes
    // from the runtime, and both have to reach React in one render or the
    // player mounts as the mini bar before swapping to full. What makes them
    // one render is `AppRouter`'s `useTransitions={false}` — with the router's
    // default lane, ordering these two calls achieves nothing, because the
    // lower-priority location update commits second whichever is called first.
    // The reconstruction guard is set above, so the route arriving in the same
    // render as the request cannot trigger a second play.
    navigate(startOptions.fromStart ? routes.playerFromStart(item.id) : routes.player(item.id), { state });
    void runtime.play({
      media: item,
      startPositionMs: startOptions.fromStart ? 0 : storedPosition,
      returnTo,
    });
    if (persistedQueue.items.length === 1) {
      void widenToSeason(item).catch((error) => console.warn('[macha] unable to load the rest of the season', error));
    }
  }, [activePlayback?.returnTo, location.pathname, location.search, navigate, playerRouteActive, progressStore, queueStore, runtime, widenToSeason]);

  useEffect(() => {
    if (runtimeState.phase === 'stopping') return undefined;
    if (suppressReconstructRef.current) {
      // Only the route catching up (leaving `/play/:id`) proves the
      // intentional stop this was guarding actually completed — clearing on
      // any other render risks unsuppressing mid-race.
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
      // startPlayback/selectQueueIndex already issued this exact play() and
      // navigated here in the same gesture; reconstructing from route state
      // would race that call with a second, redundant generation.
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
        progressStore.list().find((entry) => entry.mediaId === playerItemId)?.media,
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
      const storedPosition = progressStore.list().find((entry) => entry.mediaId === playerItemId)?.positionMs ?? 0;
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
      });
      // Deep-linking or reloading into an episode reconstructs the same lone
      // queue startPlayback would have, and needs the same widening.
      if (nextQueue.items.length === 1) await widenToSeason(media);
    })().catch((error) => console.error('[macha] unable to reconstruct playback route', error));
    return () => { cancelled = true; };
  }, [activePlayback?.media.id, api, location.search, location.state, playerItemId, progressStore, queueStore, runtime, runtimeState.phase, widenToSeason]);

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
  const stop = useCallback(() => {
    const returnTo = activePlayback?.returnTo ?? routes.home;
    if (playerRouteActive) {
      suppressReconstructRef.current = true;
      navigate(returnTo, { replace: true });
    }
    setQueueState(undefined);
    queueStore.clear();
    void runtime.stop();
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
    openSeasonEpisode: (episode: Episode, queue: Episode[], queueIndex: number, fromStart: boolean) => startPlayback(episode, { queue, queueIndex, fromStart }),
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
