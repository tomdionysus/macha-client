import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import { PlayerScreen } from './screens/PlayerScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SponsorScreen } from './screens/SponsorScreen';
import { pathForMedia, routes } from './routing';

interface Props {
  platform: Platform;
  apiOverride?: MediaApi;
  playbackOverride?: PlaybackResolver;
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

function AlbumRoute({ api, onPlay }: { api: MediaApi; onPlay: (track: MediaSummary) => void }) {
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

function PlayerRoute({
  api,
  platform,
  playbackResolver,
  progressStore,
  onProgress,
}: {
  api: MediaApi;
  platform: Platform;
  playbackResolver: PlaybackResolver;
  progressStore: ContinueWatchingStore;
  onProgress: (progress: PlaybackProgress) => void;
}) {
  const { itemId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const resolvedItemId = required(itemId, 'itemId');
  const playFromStart = searchParams.get('start') === '0';
  const routeMedia = (location.state as { media?: MediaSummary } | null)?.media;
  const storedMedia = progressStore.list().find((entry) => entry.mediaId === resolvedItemId)?.media;
  const media = routeMedia?.id === resolvedItemId ? routeMedia : storedMedia?.id === resolvedItemId ? storedMedia : undefined;
  const startPositionMs = useMemo(() => (
    playFromStart ? 0 : (progressStore.list().find((entry) => entry.mediaId === resolvedItemId)?.positionMs ?? 0)
  ), [playFromStart, progressStore, resolvedItemId]);
  return (
    <PlayerScreen
      api={api}
      itemId={resolvedItemId}
      media={media}
      platform={platform}
      playbackResolver={playbackResolver}
      startPositionMs={startPositionMs}
      onProgress={onProgress}
      onBack={() => navigate(-1)}
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

  const open = useCallback((item: MediaSummary) => navigate(pathForMedia(item)), [navigate]);
  const openPlayer = useCallback((item: MediaSummary) => navigate(routes.player(item.id), { state: { media: item } }), [navigate]);
  const openPlayerFromStart = useCallback((item: MediaSummary) => navigate(routes.playerFromStart(item.id), { state: { media: item } }), [navigate]);
  const progressById = useMemo(() => new Map(continueWatching.map((entry) => [entry.mediaId, entry])), [continueWatching]);

  const updateProgress = useCallback((progress: PlaybackProgress) => {
    setContinueWatching(progressStore.update(progress));
  }, [progressStore]);

  const removeFromContinueWatching = useCallback((item: MediaSummary) => {
    setContinueWatching(progressStore.clear(item.id));
  }, [progressStore]);

  const saveServer = useCallback((url: string, token: string) => {
    persistServerUrl(url);
    persistApiToken(token);
    setServerUrl(url.trim().replace(/\/+$/, ''));
    setApiToken(token.trim());
    navigate(routes.home, { replace: true });
  }, [navigate]);

  const playerRouteActive = location.pathname.startsWith('/play/');

  return (
    <div className="app-shell">
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
          <Route path="/music/albums/:albumId" element={<AlbumRoute api={api} onPlay={openPlayer} />} />
          <Route path="/music/tracks/:trackId" element={<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={progressById} parameter="trackId" />} />
          <Route path="/play/:itemId" element={<PlayerRoute api={api} platform={platform} playbackResolver={playbackResolver} progressStore={progressStore} onProgress={updateProgress} />} />
          <Route path="/items/:itemId" element={<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={progressById} parameter="itemId" />} />
          <Route path={routes.search} element={<SearchScreen api={api} onOpen={open} />} />
          <Route path={routes.settings} element={<SettingsScreen api={api} serverApi={serverApi} serverUrl={serverUrl} apiToken={apiToken} onSave={saveServer} />} />
          <Route path={routes.sponsor} element={<SponsorScreen />} />
          <Route path="*" element={<Navigate to={routes.home} replace />} />
        </Routes>
      </main>
    </div>
  );
}
