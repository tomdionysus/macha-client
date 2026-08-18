import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { MachaCatalogueApi } from './api/MachaCatalogueApi';
import { MachaMediaApi } from './api/MachaMediaApi';
import { MockMediaApi } from './api/MockMediaApi';
import type { MediaApi } from './api/MediaApi';
import { AppLogo } from './components/AppLogo';
import logoUrl from './assets/macha-logo.svg?url';
import { useTvNavigation } from './hooks/useTvNavigation';
import type { Platform } from './platform/Platform';
import type { PlaybackResolver } from './playback/PlaybackResolver';
import { DemoPlaybackResolver } from './playback/DemoPlaybackResolver';
import { MachaPlaybackResolver } from './playback/MachaPlaybackResolver';
import { DemoServerApi, MachaServerApi, type ServerApi } from './api/MachaServerApi';
import type { MediaSummary, PlaybackProgress, SeasonSummary } from './types';
import { ContinueWatchingStore } from './state/continueWatching';
import { migrateEpisodeContext, needsEpisodeContextMigration } from './state/continueWatchingMigration';
import { PlaybackQueueStore, type PlaybackQueueState } from './state/playbackQueue';
import {
  getApiToken,
  getClientId,
  getServerUrl,
  setApiToken as persistApiToken,
  setServerUrl as persistServerUrl,
} from './state/client';
import { HomeScreen } from './screens/HomeScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { MusicScreen } from './screens/MusicScreen';
import { SearchScreen } from './screens/SearchScreen';
import { DetailScreen } from './screens/DetailScreen';
import { SeriesScreen } from './screens/SeriesScreen';
import { SeasonScreen } from './screens/SeasonScreen';
import { ArtistScreen } from './screens/ArtistScreen';
import { AlbumScreen } from './screens/AlbumScreen';
import { PlayerHost, type PlayerHostRequest } from './screens/PlayerScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SponsorScreen } from './screens/SponsorScreen';
import { pathForMedia, routes, type PlaybackRouteState } from './routing';

interface Props {
  platform: Platform;
  apiOverride?: MediaApi;
  playbackOverride?: PlaybackResolver;
}

interface ActivePlayback extends PlayerHostRequest {
  returnTo: string;
}

interface StartPlaybackOptions {
  fromStart?: boolean;
  queue?: MediaSummary[];
  queueIndex?: number;
}

const navItems = [
  { to: routes.home, label: 'Home', end: true },
  { to: routes.movies, label: 'Movies', end: false },
  { to: routes.series, label: 'TV Shows', end: false },
  { to: routes.music, label: 'Music', end: false },
  { to: routes.search, label: 'Search', end: false },
  { to: routes.settings, label: 'Settings', end: false },
] as const;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing route parameter: ${name}`);
  return value;
}

function playerRouteItemId(pathname: string): string | undefined {
  const match = pathname.match(/^\/play\/([^/]+)$/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function DetailRoute({ api, onPlay, onPlayFromStart, progressById, parameter }: {
  api: MediaApi;
  onPlay: (item: MediaSummary) => void;
  onPlayFromStart: (item: MediaSummary) => void;
  progressById: Map<string, PlaybackProgress>;
  parameter: 'movieId' | 'episodeId' | 'trackId' | 'itemId';
}) {
  const params = useParams();
  const navigate = useNavigate();
  const itemId = required(params[parameter], parameter);
  return (
    <DetailScreen
      api={api}
      itemId={itemId}
      onBack={() => navigate(-1)}
      onPlay={onPlay}
      onPlayFromStart={onPlayFromStart}
      progress={progressById.get(itemId)}
    />
  );
}

function SeriesRoute({ api, onOpenSeason }: { api: MediaApi; onOpenSeason: (season: SeasonSummary) => void }) {
  const { seriesId } = useParams();
  const navigate = useNavigate();
  return (
    <SeriesScreen
      api={api}
      seriesId={required(seriesId, 'seriesId')}
      onBack={() => navigate(-1)}
      onOpenSeason={onOpenSeason}
    />
  );
}

function SeasonRoute({ api, progress }: { api: MediaApi; progress: Map<string, PlaybackProgress> }) {
  const { seriesId, seasonId } = useParams();
  const navigate = useNavigate();
  const resolvedSeriesId = required(seriesId, 'seriesId');
  return (
    <SeasonScreen
      api={api}
      seriesId={resolvedSeriesId}
      seasonId={required(seasonId, 'seasonId')}
      onBack={() => navigate(-1)}
      progress={progress}
    />
  );
}

function ArtistRoute({ api, onOpenAlbum }: { api: MediaApi; onOpenAlbum: (album: MediaSummary) => void }) {
  const { artistId } = useParams();
  const navigate = useNavigate();
  return (
    <ArtistScreen
      api={api}
      artistId={required(artistId, 'artistId')}
      onBack={() => navigate(routes.music)}
      onOpenAlbum={onOpenAlbum}
    />
  );
}

function AlbumRoute({ api, onPlay }: {
  api: MediaApi;
  onPlay: (track: MediaSummary, queue: MediaSummary[], queueIndex: number) => void;
}) {
  const { albumId } = useParams();
  const navigate = useNavigate();
  return (
    <AlbumScreen
      api={api}
      albumId={required(albumId, 'albumId')}
      onBack={() => navigate(-1)}
      onPlayTrack={onPlay}
    />
  );
}

export default function App({ platform, apiOverride, playbackOverride }: Props) {
  useTvNavigation();
  const navigate = useNavigate();
  const location = useLocation();

  const [serverUrl, setServerUrl] = useState(() => getServerUrl());
  const [apiToken, setApiToken] = useState(() => getApiToken());
  const clientId = useMemo(() => getClientId(), []);
  const progressStore = useMemo(() => new ContinueWatchingStore(clientId), [clientId]);
  const queueStore = useMemo(() => new PlaybackQueueStore(clientId), [clientId]);
  const requestSequence = useRef(0);
  const restoredPersistedPlayback = useRef(false);
  const [queueState, setQueueState] = useState<PlaybackQueueState | undefined>(() => queueStore.load());
  const [activePlayback, setActivePlayback] = useState<ActivePlayback>();
  const [continueWatching, setContinueWatching] = useState<PlaybackProgress[]>(() => (
    progressStore.list().filter((entry) => !needsEpisodeContextMigration(entry))
  ));
  const demo = import.meta.env.VITE_DEMO === 'true';

  const api = useMemo<MediaApi>(() => {
    if (apiOverride) return apiOverride;
    if (demo) return new MockMediaApi();
    return new MachaMediaApi(new MachaCatalogueApi(serverUrl, apiToken));
  }, [apiOverride, apiToken, demo, serverUrl]);

  const playbackResolver = useMemo<PlaybackResolver>(() => {
    if (playbackOverride) return playbackOverride;
    return demo ? new DemoPlaybackResolver() : new MachaPlaybackResolver(serverUrl, apiToken);
  }, [apiToken, demo, playbackOverride, serverUrl]);

  const serverApi = useMemo<ServerApi>(() => (
    demo ? new DemoServerApi() : new MachaServerApi(serverUrl, apiToken)
  ), [apiToken, demo, serverUrl]);

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

  const progressById = useMemo(() => new Map(continueWatching.map((entry) => [entry.mediaId, entry])), [continueWatching]);

  const updateProgress = useCallback((progress: PlaybackProgress) => {
    setContinueWatching(progressStore.update(progress));
  }, [progressStore]);

  const removeFromContinueWatching = useCallback((item: MediaSummary) => {
    setContinueWatching(progressStore.clear(item.id));
  }, [progressStore]);

  const startPlayback = useCallback((item: MediaSummary, options: StartPlaybackOptions = {}) => {
    const queue = options.queue?.length ? options.queue : [item];
    const requestedIndex = options.queueIndex ?? queue.findIndex((candidate) => candidate.id === item.id);
    const index = requestedIndex >= 0 ? requestedIndex : 0;
    const persistedQueue = queueStore.replace(queue, index);
    setQueueState(persistedQueue);

    const storedPosition = progressStore.list().find((entry) => entry.mediaId === item.id)?.positionMs ?? 0;
    const returnTo = playerRouteActive
      ? activePlayback?.returnTo ?? pathForMedia(item)
      : `${location.pathname}${location.search}`;
    const request: ActivePlayback = {
      media: item,
      startPositionMs: options.fromStart ? 0 : storedPosition,
      requestId: ++requestSequence.current,
      returnTo,
    };
    setActivePlayback(request);

    const state: PlaybackRouteState = {
      media: item,
      queue: persistedQueue.items,
      queueIndex: persistedQueue.currentIndex,
      returnTo,
    };
    navigate(options.fromStart ? routes.playerFromStart(item.id) : routes.player(item.id), { state });
  }, [activePlayback?.returnTo, location.pathname, location.search, navigate, playerRouteActive, progressStore, queueStore]);

  const open = useCallback((item: MediaSummary) => navigate(pathForMedia(item)), [navigate]);
  const openPlayer = useCallback((item: MediaSummary) => startPlayback(item), [startPlayback]);
  const openPlayerFromStart = useCallback((item: MediaSummary) => startPlayback(item, { fromStart: true }), [startPlayback]);
  const openAlbumTrack = useCallback((track: MediaSummary, queue: MediaSummary[], queueIndex: number) => {
    startPlayback(track, { queue, queueIndex });
  }, [startPlayback]);

  // A /play URL is only a presentation request. If the application was
  // reloaded on that URL, reconstruct the playback request from route state,
  // the persisted queue, Continue Watching metadata, or finally the catalogue.
  useEffect(() => {
    if (!playerItemId || activePlayback?.media.id === playerItemId) return undefined;
    let cancelled = false;
    const routeState = (location.state as PlaybackRouteState | null) ?? undefined;
    const fromStart = new URLSearchParams(location.search).get('start') === '0';

    void (async () => {
      const persistedBeforeRoute = queueStore.load();
      const persistedRoutePosition = persistedBeforeRoute?.items[persistedBeforeRoute.currentIndex]?.id === playerItemId
        ? persistedBeforeRoute.positionMs
        : 0;
      let nextQueue = routeState?.queue?.length
        ? queueStore.replace(routeState.queue, routeState.queueIndex ?? 0)
        : persistedBeforeRoute;
      let queueIndex = nextQueue?.items.findIndex((item) => item.id === playerItemId) ?? -1;
      let media = routeState?.media?.id === playerItemId ? routeState.media : undefined;
      if (!media && queueIndex >= 0) media = nextQueue?.items[queueIndex];
      if (!media) media = progressStore.list().find((entry) => entry.mediaId === playerItemId)?.media;
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
      setActivePlayback({
        media,
        startPositionMs: fromStart ? 0 : Math.max(storedPosition, queuePosition, persistedRoutePosition),
        requestId: ++requestSequence.current,
        returnTo: routeState?.returnTo ?? pathForMedia(media),
      });
    })().catch((error) => {
      console.error('[macha] unable to reconstruct playback route', error);
    });

    return () => { cancelled = true; };
  }, [activePlayback?.media.id, api, location.search, location.state, playerItemId, progressStore, queueStore]);

  useEffect(() => {
    if (restoredPersistedPlayback.current) return;
    restoredPersistedPlayback.current = true;
    if (playerRouteActive || activePlayback || !queueState) return;
    const media = queueState.items[queueState.currentIndex];
    if (!media) return;
    const storedPosition = progressStore.list().find((entry) => entry.mediaId === media.id)?.positionMs ?? 0;
    setActivePlayback({
      media,
      startPositionMs: Math.max(storedPosition, queueState.positionMs),
      requestId: ++requestSequence.current,
      returnTo: `${location.pathname}${location.search}`,
    });
  }, [activePlayback, location.pathname, location.search, playerRouteActive, progressStore, queueState]);

  const persistPlaybackPosition = useCallback((media: MediaSummary, positionMs: number) => {
    const persisted = queueStore.load();
    if (persisted?.items[persisted.currentIndex]?.id !== media.id) return;
    queueStore.updatePosition(positionMs);
  }, [queueStore]);

  const selectQueueIndex = useCallback((nextIndex: number) => {
    if (!queueState || nextIndex < 0 || nextIndex >= queueState.items.length) return;
    const nextQueue = queueStore.select(nextIndex);
    if (!nextQueue) return;
    const media = nextQueue.items[nextIndex];
    setQueueState(nextQueue);
    setActivePlayback((current) => ({
      media,
      startPositionMs: 0,
      requestId: ++requestSequence.current,
      returnTo: current?.returnTo ?? currentBrowsePath,
    }));

    if (playerRouteActive) {
      const state: PlaybackRouteState = {
        media,
        queue: nextQueue.items,
        queueIndex: nextIndex,
        returnTo: activePlayback?.returnTo ?? currentBrowsePath,
      };
      navigate(routes.player(media.id), { replace: true, state });
    }
  }, [activePlayback?.returnTo, currentBrowsePath, navigate, playerRouteActive, queueState, queueStore]);

  const canPrevious = Boolean(queueState && queueState.currentIndex > 0);
  const canNext = Boolean(queueState && queueState.currentIndex + 1 < queueState.items.length);
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
  }, [queueState, queueStore, selectQueueIndex]);

  const minimizePlayer = useCallback(() => {
    if (!activePlayback) return;
    navigate(activePlayback.returnTo || pathForMedia(activePlayback.media), { replace: true });
  }, [activePlayback, navigate]);

  const expandPlayer = useCallback(() => {
    if (!activePlayback) return;
    const returnTo = playerRouteActive ? activePlayback.returnTo : `${location.pathname}${location.search}`;
    setActivePlayback((current) => current ? { ...current, returnTo } : current);
    const state: PlaybackRouteState = {
      media: activePlayback.media,
      queue: queueState?.items,
      queueIndex: queueState?.currentIndex,
      returnTo,
    };
    navigate(routes.player(activePlayback.media.id), { state });
  }, [activePlayback, location.pathname, location.search, navigate, playerRouteActive, queueState]);

  const stopPlayback = useCallback(() => {
    const returnTo = activePlayback?.returnTo ?? routes.home;
    setActivePlayback(undefined);
    setQueueState(undefined);
    queueStore.clear();
    if (playerRouteActive) navigate(returnTo, { replace: true });
  }, [activePlayback?.returnTo, navigate, playerRouteActive, queueStore]);

  const saveServer = useCallback((url: string, token: string) => {
    persistServerUrl(url);
    persistApiToken(token);
    setServerUrl(url.trim().replace(/\/+$/, ''));
    setApiToken(token.trim());
    navigate(routes.home, { replace: true });
  }, [navigate]);

  const miniPlayerActive = Boolean(activePlayback && !playerRouteActive);

  return (
    <div className={`app-shell${miniPlayerActive ? ' has-mini-player' : ''}`}>
      {!playerRouteActive && <img className="app-watermark" src={logoUrl} alt="" aria-hidden="true" />}
      <header className="topbar">
        <NavLink to={routes.home} className="brand-link" aria-label="Macha home">
          <AppLogo />
          <span className="brand-name">Macha</span>
        </NavLink>
        <nav aria-label="Main navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-tv-focusable="true"
              className={({ isActive }: { isActive: boolean }) => isActive ? 'active' : undefined}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="platform-badge">{platform.name.toUpperCase()}</div>
      </header>
      <main>
        <Routes>
          <Route path={routes.home} element={<HomeScreen api={api} continueWatching={continueWatching} onOpen={open} onResume={openPlayer} onRemoveFromContinueWatching={removeFromContinueWatching} />} />
          <Route path={routes.movies} element={<LibraryScreen api={api} kind="movies" onOpen={open} />} />
          <Route path="/movies/:movieId" element={<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={progressById} parameter="movieId" />} />
          <Route path={routes.series} element={<LibraryScreen api={api} kind="shows" onOpen={open} />} />
          <Route path="/series/:seriesId" element={<SeriesRoute api={api} onOpenSeason={open} />} />
          <Route path="/series/:seriesId/seasons/:seasonId" element={<SeasonRoute api={api} progress={progressById} />} />
          <Route path="/episodes/:episodeId" element={<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={progressById} parameter="episodeId" />} />
          <Route path={routes.music} element={<MusicScreen api={api} onOpen={open} />} />
          <Route path="/music/artists/:artistId" element={<ArtistRoute api={api} onOpenAlbum={open} />} />
          <Route path="/music/albums/:albumId" element={<AlbumRoute api={api} onPlay={openAlbumTrack} />} />
          <Route path="/music/tracks/:trackId" element={<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={progressById} parameter="trackId" />} />
          <Route path="/play/:itemId" element={<div className="player-route-placeholder" aria-hidden="true" />} />
          <Route path="/items/:itemId" element={<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={progressById} parameter="itemId" />} />
          <Route path={routes.search} element={<SearchScreen api={api} onOpen={open} />} />
          <Route path={routes.settings} element={<SettingsScreen api={api} serverApi={serverApi} serverUrl={serverUrl} apiToken={apiToken} onSave={saveServer} />} />
          <Route path={routes.sponsor} element={<SponsorScreen />} />
          <Route path="*" element={<Navigate to={routes.home} replace />} />
        </Routes>
      </main>

      {activePlayback && (
        <PlayerHost
          api={api}
          request={activePlayback}
          platform={platform}
          playbackResolver={playbackResolver}
          presentation={playerRouteActive ? 'full' : 'mini'}
          onProgress={updateProgress}
          onPosition={persistPlaybackPosition}
          onMinimize={minimizePlayer}
          onExpand={expandPlayer}
          onStop={stopPlayback}
          onPrevious={previous}
          onNext={next}
          onEnded={handleEnded}
          canPrevious={canPrevious}
          canNext={canNext}
          queuePosition={queueState ? { index: queueState.currentIndex, total: queueState.items.length } : undefined}
        />
      )}
    </div>
  );
}
