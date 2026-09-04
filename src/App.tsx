import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { CatalogueApi, CatalogueMediaProfile } from './api/CatalogueApi';
import type { MediaApi } from './api/MediaApi';
import { AppLogo } from './components/AppLogo';
import { MusicNav } from './components/MusicNav';
import { StatusNav } from './components/StatusNav';
import { ManageNav } from './components/ManageNav';
import { machaLogoUrl as logoUrl } from './uiAssets';
import { useTvNavigation } from './hooks/useTvNavigation';
import { useEndpointHealthMonitor } from './cluster/useEndpointHealthMonitor';
import { samsungBackTarget } from './platform/samsungBackNavigation';
import type { Platform } from './platform/Platform';
import type { PlaybackResolver } from './playback/PlaybackResolver';
import { reportClusterReachable, SERVER_REACHABLE_EVENT, SERVER_UNREACHABLE_EVENT, SERVER_UNREACHABLE_MESSAGE } from './api/serverConnection';
import type { Episode, MediaSummary, PlaybackProgress, SeasonSummary } from './types';
import { ContinueWatchingStore } from './state/continueWatching';
import { PlaybackQueueStore } from './state/playbackQueue';
import { MusicPlaylistStore } from './state/musicPlaylist';
import { VolumeStore } from './state/volume';
import {
  getApiToken,
  getClientId,
  getBootstrapEndpoints,
  setApiToken as persistApiToken,
  setBootstrapEndpoints as persistBootstrapEndpoints,
} from './state/client';
import { HomeScreen } from './screens/HomeScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { MusicScreen } from './screens/MusicScreen';
import { MusicPlaylistScreen } from './screens/MusicPlaylistScreen';
import { SearchScreen } from './screens/SearchScreen';
import { DetailScreen } from './screens/DetailScreen';
import { SeriesScreen } from './screens/SeriesScreen';
import { SeasonScreen } from './screens/SeasonScreen';
import { ArtistScreen } from './screens/ArtistScreen';
import { AlbumScreen } from './screens/AlbumScreen';
import { PlayerHost } from './screens/PlayerScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SponsorScreen } from './screens/SponsorScreen';
import { MetadataEditorScreen } from './screens/MetadataEditorScreen';
import { IngestScreen } from './screens/IngestScreen';
import { ManageScreen } from './screens/ManageScreen';
import { NodeStatusScreen, StatusScreen } from './screens/StatusScreen';
import { pathForMedia, routes } from './routing';
import { playerRouteItemId } from './app/playbackRoute';
import { useMachaServices } from './app/useMachaServices';
import { useMediaRouteBack } from './app/useMediaRouteBack';
import { useMusicController } from './app/useMusicController';
import { usePlaybackRuntime } from './app/usePlaybackRuntime';
import { usePlaybackController } from './app/usePlaybackController';
import { technicalProfileFromCatalogue } from './playback/MediaTechnicalProfile';
import { ConnectionGateScreen } from './screens/ConnectionGateScreen';
import { checkEndpointConfiguration, initialConnectionGate, normalizeConnectionEndpoints, shouldEnterConnectionGate, type ConnectionGate } from './app/connectionConfiguration';

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
  { to: routes.ingest, label: 'Import', end: false },
  { to: routes.status, label: 'Status', end: false },
  { to: routes.manage, label: 'Manage', end: false },
] as const;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing route parameter: ${name}`);
  return value;
}

function DetailRoute({ api, onPlay, onPlayFromStart, progressById, parameter, onEdit, onMediaProfile }: {
  api: MediaApi;
  onPlay: (item: MediaSummary) => void;
  onPlayFromStart: (item: MediaSummary) => void;
  progressById: Map<string, PlaybackProgress>;
  parameter: 'movieId' | 'episodeId' | 'trackId' | 'itemId';
  onEdit?: (id: string) => void;
  onMediaProfile?: (profile: CatalogueMediaProfile) => void;
}) {
  const params = useParams();
  const back = useMediaRouteBack(api);
  const itemId = required(params[parameter], parameter);
  return (
    <DetailScreen
      api={api}
      itemId={itemId}
      onBack={back}
      onPlay={onPlay}
      onPlayFromStart={onPlayFromStart}
      progress={progressById.get(itemId)}
      onEdit={onEdit ? () => onEdit(itemId) : undefined}
      onMediaProfile={onMediaProfile}
    />
  );
}

function SeriesRoute({ api, onOpenSeason, onEdit }: { api: MediaApi; onOpenSeason: (season: SeasonSummary) => void; onEdit?: (id: string) => void }) {
  const { seriesId } = useParams();
  const back = useMediaRouteBack(api);
  const resolvedSeriesId = required(seriesId, 'seriesId');
  return (
    <SeriesScreen
      api={api}
      seriesId={resolvedSeriesId}
      onBack={back}
      onOpenSeason={onOpenSeason}
      onEdit={onEdit ? () => onEdit(resolvedSeriesId) : undefined}
    />
  );
}

function SeasonRoute({ api, progress, onPlayEpisode, onEdit }: {
  api: MediaApi;
  progress: Map<string, PlaybackProgress>;
  onPlayEpisode: (episode: Episode, queue: Episode[], queueIndex: number, fromStart: boolean) => void;
  onEdit?: (id: string) => void;
}) {
  const { seriesId, seasonId } = useParams();
  const back = useMediaRouteBack(api);
  const resolvedSeriesId = required(seriesId, 'seriesId');
  const resolvedSeasonId = required(seasonId, 'seasonId');
  return (
    <SeasonScreen
      api={api}
      seriesId={resolvedSeriesId}
      seasonId={resolvedSeasonId}
      onBack={back}
      progress={progress}
      onPlayEpisode={onPlayEpisode}
      onEdit={onEdit ? () => onEdit(resolvedSeasonId) : undefined}
    />
  );
}

function ArtistRoute({ api, onOpenAlbum, onAddToPlaylist, onPlayNext, onPlayLater, onShuffle, onEdit }: {
  api: MediaApi;
  onOpenAlbum: (album: MediaSummary) => void;
  onAddToPlaylist: (album: MediaSummary) => void;
  onPlayNext: (album: MediaSummary) => void;
  onPlayLater: (album: MediaSummary) => void;
  onShuffle: (album: MediaSummary) => void;
  onEdit?: (id: string) => void;
}) {
  const { artistId } = useParams();
  const back = useMediaRouteBack(api, routes.musicArtists);
  const resolvedArtistId = required(artistId, 'artistId');
  return (
    <ArtistScreen
      api={api}
      artistId={resolvedArtistId}
      onBack={back}
      onOpenAlbum={onOpenAlbum}
      onAddToPlaylist={onAddToPlaylist}
      onPlayNext={onPlayNext}
      onPlayLater={onPlayLater}
      onShuffle={onShuffle}
      onEdit={onEdit ? () => onEdit(resolvedArtistId) : undefined}
    />
  );
}

function AlbumRoute({ api, onPlay, onPlayAll, onOpenTrack, onAddToPlaylist, onPlayNext, onPlayLater, onShuffle, onEdit }: {
  api: MediaApi;
  onPlay: (track: MediaSummary, queue: MediaSummary[], queueIndex: number) => void;
  onPlayAll: (album: MediaSummary) => void;
  onOpenTrack: (track: MediaSummary) => void;
  onAddToPlaylist: (item: MediaSummary) => void;
  onPlayNext: (item: MediaSummary) => void;
  onPlayLater: (item: MediaSummary) => void;
  onShuffle: (item: MediaSummary) => void;
  onEdit?: (id: string) => void;
}) {
  const { albumId } = useParams();
  const back = useMediaRouteBack(api);
  const resolvedAlbumId = required(albumId, 'albumId');
  return (
    <AlbumScreen
      api={api}
      albumId={resolvedAlbumId}
      onBack={back}
      onPlayTrack={onPlay}
      onPlayAll={onPlayAll}
      onOpenTrack={onOpenTrack}
      onAddToPlaylist={onAddToPlaylist}
      onPlayNext={onPlayNext}
      onPlayLater={onPlayLater}
      onShuffle={onShuffle}
      onEdit={onEdit ? () => onEdit(resolvedAlbumId) : undefined}
    />
  );
}

function MetadataEditorRoute({ api }: { api: CatalogueApi }) {
  const { itemId } = useParams();
  const navigate = useNavigate();
  return (
    <MetadataEditorScreen
      api={api}
      itemId={required(itemId, 'itemId')}
      onBack={() => navigate(-1)}
      onSaved={() => navigate(-1)}
      onCleared={(item) => {
        const destination = item.kind === 'movie'
          ? routes.movies
          : (item.kind === 'show' || item.kind === 'season' || item.kind === 'episode')
            ? routes.series
            : routes.music;
        navigate(destination, { replace: true });
      }}
    />
  );
}

export default function App({ platform, apiOverride, playbackOverride }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const demo = import.meta.env.VITE_DEMO === 'true';
  const connectionRequired = !demo && !apiOverride;

  const [bootstrapEndpoints, setBootstrapEndpoints] = useState(() => getBootstrapEndpoints());
  const serverUrl = bootstrapEndpoints[0] ?? '';
  const [apiToken, setApiToken] = useState(() => getApiToken());
  const [connectionNotice, setConnectionNotice] = useState<string>();
  const [clusterUnreachable, setClusterUnreachable] = useState(false);
  const [connectionGate, setConnectionGate] = useState<ConnectionGate | undefined>(() =>
    initialConnectionGate(connectionRequired, getBootstrapEndpoints()),
  );
  const effectiveConnectionGate = connectionRequired ? connectionGate : undefined;
  const clientId = useMemo(() => getClientId(), []);
  const progressStore = useMemo(() => new ContinueWatchingStore(clientId), [clientId]);
  const queueStore = useMemo(() => new PlaybackQueueStore(clientId), [clientId]);
  const playlistStore = useMemo(() => new MusicPlaylistStore(clientId), [clientId]);
  const volumeStore = useMemo(() => new VolumeStore(clientId), [clientId]);
  const {
    catalogueApi,
    manageApi,
    mediaApi: api,
    playbackResolver,
    serverApi,
    clusterStatusApi,
    acquisitionApi,
    managementAvailable,
    endpointRegistry,
  } = useMachaServices({ serverUrl, bootstrapEndpoints, apiToken, demo, apiOverride, playbackOverride });
  useEndpointHealthMonitor(endpointRegistry, apiToken, connectionRequired && bootstrapEndpoints.length > 0 && !effectiveConnectionGate);
  const metadataEditingAvailable = managementAvailable;
  const [unmatchedCount, setUnmatchedCount] = useState(0);

  const { runtime: playbackRuntime, state: playbackRuntimeState } = usePlaybackRuntime(platform, playbackResolver);
  const preparePlaybackProfile = useCallback((profile: CatalogueMediaProfile) => {
    playbackRuntime.prepare(technicalProfileFromCatalogue(profile));
  }, [playbackRuntime]);
  const playback = usePlaybackController({
    api,
    platform,
    runtime: playbackRuntime,
    runtimeState: playbackRuntimeState,
    progressStore,
    queueStore,
    volumeStore,
  });
  const activePlayback = playback.activePlayback;

  useEffect(() => {
    if (!managementAvailable || effectiveConnectionGate) {
      setUnmatchedCount(0);
      return undefined;
    }
    let cancelled = false;
    void manageApi.unmatched()
      .then((items) => { if (!cancelled) setUnmatchedCount(items.length); })
      .catch(() => { /* Manage itself will surface API errors when opened. */ });
    return () => { cancelled = true; };
  }, [effectiveConnectionGate, manageApi, managementAvailable]);

  const samsungBack = useCallback(() => {
    if (import.meta.env.MODE !== 'samsung') return false;
    if (effectiveConnectionGate) return true;
    if (location.pathname === routes.home) {
      playbackRuntime.terminateForPageExit();
      platform.exitApplication?.();
      return true;
    }
    const returnTo = playerRouteItemId(location.pathname) ? activePlayback?.returnTo : undefined;
    void samsungBackTarget(location.pathname, api, returnTo)
      .then((target) => { if (target) navigate(target); })
      .catch(() => navigate(routes.home));
    return true;
  }, [activePlayback?.returnTo, api, effectiveConnectionGate, location.pathname, navigate, platform, playbackRuntime]);

  useTvNavigation(samsungBack);

  useEffect(() => {
    const onServerUnreachable = (event: Event) => {
      if (!connectionRequired) return;
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setConnectionNotice(detail?.message ?? SERVER_UNREACHABLE_MESSAGE);
      setClusterUnreachable(true);
    };
    const onServerReachable = () => setClusterUnreachable(false);
    window.addEventListener(SERVER_UNREACHABLE_EVENT, onServerUnreachable);
    window.addEventListener(SERVER_REACHABLE_EVENT, onServerReachable);
    return () => {
      window.removeEventListener(SERVER_UNREACHABLE_EVENT, onServerUnreachable);
      window.removeEventListener(SERVER_REACHABLE_EVENT, onServerReachable);
    };
  }, [connectionRequired]);

  useEffect(() => {
    if (!connectionRequired || !shouldEnterConnectionGate(clusterUnreachable, Boolean(activePlayback))) return;
    setConnectionGate('unreachable');
    navigate(routes.connection, { replace: true });
  }, [activePlayback, clusterUnreachable, connectionRequired, navigate]);

  useEffect(() => {
    if (effectiveConnectionGate && location.pathname !== routes.connection) {
      navigate(routes.connection, { replace: true });
    }
  }, [effectiveConnectionGate, location.pathname, navigate]);

  const open = useCallback((item: MediaSummary) => navigate(pathForMedia(item)), [navigate]);
  const openPlayer = useCallback((item: MediaSummary) => playback.startPlayback(item), [playback.startPlayback]);
  const openPlayerFromStart = useCallback((item: MediaSummary) => playback.startPlayback(item, { fromStart: true }), [playback.startPlayback]);

  const music = useMusicController({
    api,
    playlistStore,
    queueStore,
    activePlayback: Boolean(activePlayback),
    startPlayback: playback.startPlayback,
    onQueueChange: playback.setQueueState,
  });

  const saveServer = useCallback(async (urls: readonly string[], token: string): Promise<string | undefined> => {
    const normalizedEndpoints = normalizeConnectionEndpoints(urls);
    const normalizedToken = token.trim();
    const check = await checkEndpointConfiguration(normalizedEndpoints, normalizedToken);
    if (check.available.length === 0) {
      const message = check.message ?? SERVER_UNREACHABLE_MESSAGE;
      setConnectionNotice(message);
      return message;
    }
    setConnectionNotice(undefined);
    // A resolver/server boundary cannot change underneath an owned lease.
    // Close the old session first, then make the new server authoritative.
    await playbackRuntime.stop();
    persistBootstrapEndpoints(normalizedEndpoints);
    persistApiToken(token);
    reportClusterReachable();
    setClusterUnreachable(false);
    setBootstrapEndpoints(normalizedEndpoints);
    setApiToken(normalizedToken);
    setConnectionGate(undefined);
    navigate(routes.home, { replace: true });
    return undefined;
  }, [navigate, playbackRuntime]);

  const openMetadataEditor = useCallback((id: string) => {
    navigate(routes.edit(id));
  }, [navigate]);

  const miniPlayerActive = Boolean(playback.playerVisible && !playback.playerRouteActive);
  const playerHost = playback.playerVisible && activePlayback ? <PlayerHost
    api={api}
    request={activePlayback}
    platform={platform}
    runtime={playbackRuntime}
    presentation={playback.playerRouteActive ? 'full' : 'mini'}
    onProgress={playback.updateProgress}
    onPosition={playback.persistPlaybackPosition}
    onMinimize={playback.minimize}
    onExpand={playback.expand}
    onStop={playback.stop}
    onPrevious={playback.previous}
    onNext={playback.next}
    onEnded={playback.handleEnded}
    canPrevious={playback.canPrevious}
    canNext={playback.canNext}
    queuePosition={playback.queueState ? { index: playback.queueState.currentIndex, total: playback.queueState.items.length } : undefined}
    volume={playback.volume}
    onVolumeChange={playback.changeVolume}
  /> : null;

  if (effectiveConnectionGate) return <div className={`app-shell${miniPlayerActive ? ' has-mini-player' : ''}`}>
    <ConnectionGateScreen
      welcome={effectiveConnectionGate === 'welcome'}
      notice={connectionNotice}
      bootstrapEndpoints={bootstrapEndpoints}
      apiToken={apiToken}
      onSave={saveServer}
    />
    {playerHost}
  </div>;

  const musicSectionActive = location.pathname === routes.music || location.pathname.startsWith(`${routes.music}/`);
  const statusSectionActive = location.pathname === routes.status || location.pathname.startsWith(`${routes.status}/`);
  const manageSectionActive = location.pathname === routes.manage || location.pathname.startsWith(`${routes.manage}/`);

  return (
    <div className={`app-shell${miniPlayerActive ? ' has-mini-player' : ''}`}>
      {!playback.playerRouteActive && <img className="app-watermark" src={logoUrl} alt="" aria-hidden="true" />}
      <header className="topbar">
        <NavLink to={routes.home} className="brand-link" aria-label="Macha home">
          <AppLogo />
          <span className="brand-name">Macha</span>
        </NavLink>
        <nav aria-label="Main navigation">
          {navItems.map((item) => {
            if (item.to === routes.manage && !managementAvailable) return null;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                data-tv-focusable="true"
                className={({ isActive }: { isActive: boolean }) => isActive ? 'active' : undefined}
              >
                {item.label}
                {item.to === routes.manage && unmatchedCount > 0 && <span className="manage-badge">{unmatchedCount}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className="platform-badge">{import.meta.env.MODE === 'samsung' ? 'SAMSUNG TV' : platform.name.toUpperCase()}</div>
      </header>
      {!playback.playerRouteActive && (musicSectionActive || statusSectionActive || manageSectionActive) && (
        <div className="section-nav-slot">
          {musicSectionActive
            ? <MusicNav />
            : statusSectionActive
              ? <StatusNav />
              : <ManageNav managementAvailable={managementAvailable} />}
        </div>
      )}
      <main>
        <Routes>
          <Route path={routes.home} element={<HomeScreen api={api} continueWatching={playback.continueWatching} onOpen={open} onResume={openPlayer} onRemoveFromContinueWatching={playback.removeFromContinueWatching} />} />
          <Route path={routes.movies} element={<LibraryScreen api={api} kind="movies" onOpen={open} />} />
          <Route path="/movies/:movieId" element={<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={playback.progressById} parameter="movieId" onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} onMediaProfile={preparePlaybackProfile} />} />
          <Route path={routes.series} element={<LibraryScreen api={api} kind="shows" onOpen={open} />} />
          <Route path="/series/:seriesId" element={<SeriesRoute api={api} onOpenSeason={open} onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} />} />
          <Route path="/series/:seriesId/seasons/:seasonId" element={<SeasonRoute api={api} progress={playback.progressById} onPlayEpisode={playback.openSeasonEpisode} onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} />} />
          <Route path="/episodes/:episodeId" element={<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={playback.progressById} parameter="episodeId" onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} onMediaProfile={preparePlaybackProfile} />} />
          <Route path={routes.music} element={<Navigate to={routes.musicArtists} replace />} />
          <Route path={routes.musicArtists} element={<MusicScreen api={api} section="artists" onOpen={open} onPlayNow={music.playNow} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} />} />
          <Route path={routes.musicAlbums} element={<MusicScreen api={api} section="albums" onOpen={open} onPlayNow={music.playNow} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} />} />
          <Route path={routes.musicTracks} element={<MusicScreen api={api} section="tracks" onOpen={open} onPlayNow={music.playNow} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} />} />
          <Route path={routes.musicPlaylist} element={<MusicPlaylistScreen api={api} entries={music.playlistEntries} onPlay={(index) => music.playPlaylist(false, index)} onShuffle={() => music.playPlaylist(true)} onRemove={music.removePlaylistEntry} onMove={music.movePlaylistEntry} onClear={music.clearPlaylist} />} />
          <Route path="/music/artists/:artistId" element={<ArtistRoute api={api} onOpenAlbum={open} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} />} />
          <Route path="/music/albums/:albumId" element={<AlbumRoute api={api} onPlay={playback.openAlbumTrack} onPlayAll={music.playAlbumAll} onOpenTrack={open} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} />} />
          <Route path="/music/tracks/:trackId" element={<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={playback.progressById} parameter="trackId" onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} onMediaProfile={preparePlaybackProfile} />} />
          <Route path="/play/:itemId" element={<div className="player-route-placeholder" aria-hidden="true" />} />
          <Route path="/items/:itemId" element={<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={playback.progressById} parameter="itemId" onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} onMediaProfile={preparePlaybackProfile} />} />
          <Route path="/items/:itemId/edit" element={metadataEditingAvailable ? <MetadataEditorRoute api={catalogueApi} /> : <Navigate to={routes.home} replace />} />
          <Route path={routes.search} element={<SearchScreen api={api} onOpen={open} />} />
          <Route path={routes.ingest} element={<IngestScreen api={acquisitionApi} />} />
          <Route path={routes.status} element={<StatusScreen api={clusterStatusApi} endpointRegistry={endpointRegistry} manageApi={managementAvailable ? manageApi : undefined} section="overview" apiToken={apiToken} />} />
          <Route path={routes.statusClient} element={<StatusScreen api={clusterStatusApi} endpointRegistry={endpointRegistry} manageApi={managementAvailable ? manageApi : undefined} section="client" apiToken={apiToken} />} />
          <Route path={routes.statusConnectivity} element={<StatusScreen api={clusterStatusApi} endpointRegistry={endpointRegistry} manageApi={managementAvailable ? manageApi : undefined} section="connectivity" apiToken={apiToken} />} />
          <Route path="/status/nodes/:nodeId" element={<NodeStatusScreen api={clusterStatusApi} />} />
          <Route path={routes.manage} element={managementAvailable ? <ManageScreen api={manageApi} catalogueApi={catalogueApi} section="unmatched" settings={<SettingsScreen api={api} serverApi={serverApi} bootstrapEndpoints={bootstrapEndpoints} apiToken={apiToken} connectionNotice={connectionNotice} onSave={saveServer} />} onUnmatchedCountChange={setUnmatchedCount} /> : <Navigate to={routes.settings} replace />} />
          <Route path={routes.manageFiles} element={managementAvailable ? <ManageScreen api={manageApi} catalogueApi={catalogueApi} section="files" settings={<SettingsScreen api={api} serverApi={serverApi} bootstrapEndpoints={bootstrapEndpoints} apiToken={apiToken} connectionNotice={connectionNotice} onSave={saveServer} />} onUnmatchedCountChange={setUnmatchedCount} /> : <Navigate to={routes.settings} replace />} />
          <Route path={routes.settings} element={<ManageScreen api={manageApi} catalogueApi={catalogueApi} section="settings" settings={<SettingsScreen api={api} serverApi={serverApi} bootstrapEndpoints={bootstrapEndpoints} apiToken={apiToken} connectionNotice={connectionNotice} onSave={saveServer} />} />} />
          <Route path={routes.connection} element={<ManageScreen api={manageApi} catalogueApi={catalogueApi} section="settings" settings={<SettingsScreen api={api} serverApi={serverApi} bootstrapEndpoints={bootstrapEndpoints} apiToken={apiToken} connectionNotice={connectionNotice} onSave={saveServer} />} />} />
          <Route path="/settings" element={<Navigate to={routes.settings} replace />} />
          <Route path={routes.sponsor} element={<SponsorScreen />} />
          <Route path="*" element={<Navigate to={routes.home} replace />} />
        </Routes>
      </main>

      {playerHost}
    </div>
  );
}
