import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { CatalogueApi, CatalogueMediaProfile } from '@machafoundation/core';
import type { MediaApi } from '@machafoundation/core';
import { AppLogo } from './components/AppLogo';
import { MusicNav } from './components/MusicNav';
import { StatusNav } from './components/StatusNav';
import { ManageNav } from './components/ManageNav';
import { machaLogoUrl as logoUrl } from './uiAssets';
import { useTvNavigation } from './hooks/useTvNavigation';
import { useEndpointHealthMonitor } from './cluster/useEndpointHealthMonitor';
import { samsungBackTarget } from './platform/samsungBackNavigation';
import type { Platform } from '@machafoundation/core';
import { buildPlatformTraits, isTvBuild } from './platform/traits';
import type { PlaybackResolver } from '@machafoundation/core';
import { reportClusterReachable, SERVER_REACHABLE_EVENT, SERVER_UNREACHABLE_EVENT, SERVER_UNREACHABLE_MESSAGE } from '@machafoundation/core';
import type { Episode, MediaSummary, PlaybackProgress, SeasonSummary } from '@machafoundation/core';
import { ContinueWatchingStore } from '@machafoundation/core';
import { hasRole, sessionManager, type UserRole } from '@machafoundation/core';
import { useCurrentSession } from './app/useCurrentSession';
import { PlaybackQueueStore } from '@machafoundation/core';
import { MusicPlaylistStore } from '@machafoundation/core';
import { VolumeStore } from '@machafoundation/core';
import {
  getClientId,
  getBootstrapEndpoints,
  getDiscoveredEndpoints,
  setBootstrapEndpoints as persistBootstrapEndpoints,
} from './state/client';
import { HomeScreen } from './screens/HomeScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { UsersScreen } from './screens/UsersScreen';
import { AccountScreen, ChangePasswordScreen } from './screens/AccountScreen';
import { LoginScreen } from './screens/LoginScreen';
import { AccountMenu } from './components/AccountMenu';
import { SettingsIcon } from './components/ManageIcons';
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
import { ManageScreen, type ManageSection } from './screens/ManageScreen';
import { NodeStatusScreen, StatusScreen } from './screens/StatusScreen';
import { pathForMedia, routes } from '@machafoundation/core';
import { playerRouteItemId } from '@machafoundation/core';
import { useMachaServices } from './app/useMachaServices';
import { useSession } from './app/useSession';
import { EndpointRegistry, bootstrapEndpoints as bootstrapClusterEndpoints } from '@machafoundation/core';
import { EndpointBandwidth } from '@machafoundation/core';
import { setTransferRecorder } from '@machafoundation/core';
import { setDirectPlayTransferListener } from './playback/directPlayReadAhead';
import { Loading } from './components/Status';
import { useMediaRouteBack } from './app/useMediaRouteBack';
import { useMusicController } from './app/useMusicController';
import { usePlaybackRuntime } from './app/usePlaybackRuntime';
import { usePlaybackController } from './app/usePlaybackController';
import { technicalProfileFromCatalogue, type PlaybackPolicyOverrides } from '@machafoundation/core';
import { ConnectionGateScreen } from './screens/ConnectionGateScreen';
import { initialConnectionGate, normalizeConnectionEndpoints, shouldEnterConnectionGate, type ConnectionGate } from '@machafoundation/core';

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
  const connectionRequired = !apiOverride;

  const [bootstrapEndpoints, setBootstrapEndpoints] = useState(() => getBootstrapEndpoints());
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
  const endpointKey = bootstrapEndpoints.join('\n');
  const endpointBandwidth = useMemo(() => new EndpointBandwidth(clientId), [clientId]);
  const endpointRegistry = useMemo(
    () => new EndpointRegistry([
      ...bootstrapClusterEndpoints(bootstrapEndpoints),
      // Runtime-discovered membership confirmed reachable in a previous
      // session — never user configuration (`docs/server-api.md`), so it's
      // seeded after the real bootstrap seeds and dropped on any conflict by
      // the registry's own dedup. Gives a reload somewhere to fall back to
      // if the single configured endpoint happens to be down at that exact
      // moment; the next successful discovery cycle supersedes it either way.
      ...bootstrapClusterEndpoints(getDiscoveredEndpoints(), 'environment'),
    ], Date.now, endpointBandwidth),
    [endpointKey, endpointBandwidth],
  );
  // Throughput evidence comes from responses the client was already fetching.
  // Installed here, once, because the HTTP layer must not reach into cluster
  // bookkeeping on its own; `endpointId` is the normalized base URL, so a
  // response attributes to whichever configured endpoint prefixes its URL.
  useEffect(() => {
    const record = (url: string, bytes: number, durationMs: number) => {
      const endpoint = endpointRegistry.snapshot()
        .find(({ endpoint: candidate }) => url.startsWith(candidate.baseUrl));
      if (endpoint) endpointBandwidth.record(endpoint.endpoint.id, bytes, durationMs);
    };
    setTransferRecorder(record);
    // Media is where the bytes are. Without this the bandwidth record only ever
    // described JSON, so a node that served nothing but media had no throughput
    // evidence and endpoint ranking had nothing to judge it on — which is how
    // this client spent an afternoon streaming from the slowest node it had.
    // The worker reports a query-free origin, and an endpoint id is its
    // normalized base URL, so the same prefix attribution works for both.
    setDirectPlayTransferListener(record);
    return () => {
      setTransferRecorder(undefined);
      setDirectPlayTransferListener(undefined);
      // Persistence is throttled, so the last few samples are still in memory.
      endpointBandwidth.flush();
    };
  }, [endpointBandwidth, endpointRegistry]);
  const { auth, ready: sessionReady } = useSession({
    connectionRequired,
    serverConfigured: bootstrapEndpoints.length > 0,
    endpointRegistry,
  });
  const {
    catalogueApi,
    manageApi,
    usersApi,
    mediaApi: api,
    playbackResolver,
    serverApi,
    clusterStatusApi,
    acquisitionApi,
    playbackFactsApi,
    managementAvailable,
  } = useMachaServices({ endpointRegistry, auth, apiOverride, playbackOverride });
  useEndpointHealthMonitor(endpointRegistry, clusterStatusApi, auth, connectionRequired && bootstrapEndpoints.length > 0 && !effectiveConnectionGate);
  // Not before the session has settled. `SessionManager.fetch` retries a 401
  // only when it actually sent a token, so a whoami that goes out during the
  // cold-start mint is answered 401, returned as-is, and the roles are never
  // read — leaving every privileged section visible for the rest of the run.
  // It only ever worked by timing.
  const { session, known: sessionKnown, refresh: refreshSession } = useCurrentSession(usersApi, connectionRequired && !effectiveConnectionGate && sessionReady);
  /**
   * Sections that predate roles stay visible while roles are unknown.
   *
   * Unknown is not the same as "has no roles". A node too old to answer the
   * whoami, or one that has not answered yet, must not read as a viewer with
   * no permissions — that would empty the navigation for everyone the moment
   * an old node answered first, which is this client's normal operating
   * condition rather than an edge case.
   */
  const permits = useCallback((role: UserRole) => !sessionKnown || hasRole(session?.roles, role), [session, sessionKnown]);
  // Users is the exception, and deliberately the other way round: the screen
  // exists only because the server has accounts, so an unknown answer means
  // there is nothing there to show rather than something to reveal.
  const usersAvailable = sessionKnown && hasRole(session?.roles, 'manage_users');
  const libraryManagementAvailable = managementAvailable && permits('manager');
  const metadataEditingAvailable = libraryManagementAvailable;
  const [unmatchedCount, setUnmatchedCount] = useState(0);

  // What the instruction chooser reasons from: the server's reported facts for
  // the item about to play, and the platform truths no probe can discover.
  const playbackRuntimeOptions = useMemo(() => ({
    // The playback facts endpoint, not the catalogue profile: it carries the
    // canonical container, real bit depth, colour transfer and Dolby Vision
    // profile, and the node's `operations` — what this build will actually
    // mux and copy, which no catalogue profile knows. It also answers for a
    // mutable path identity that has no immutable catalogue profile at all.
    // The cluster API resolves the preferred endpoint per call, so operations
    // describe the node that will execute the instruction rather than whichever
    // one happened to be preferred at boot.
    facts: async (media: MediaSummary) => (await playbackFactsApi.facts({ itemId: media.id }))[0],
    policyOverrides: (platform as { playbackPolicy?: PlaybackPolicyOverrides }).playbackPolicy,
  }), [playbackFactsApi, platform]);
  const { runtime: playbackRuntime, state: playbackRuntimeState } = usePlaybackRuntime(platform, playbackResolver, playbackRuntimeOptions);
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
    if (!buildPlatformTraits.receivesBackKeyEvents) return false;
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

  /**
   * Save the endpoint list. Nothing is probed first, deliberately.
   *
   * There used to be a pre-save reachability check here, and it could not
   * work: it asked an unauthenticated `catalogue/status`, which every node
   * answers 401, so no typed endpoint ever qualified and none could be saved.
   * On a fresh install that is a lockout — no endpoint means no session,
   * and no session means no endpoint can ever be validated.
   *
   * Repairing the probe would have been the wrong fix. Reachability is not a
   * question to ask once on a button press; it is a fact the client already
   * maintains. The health monitor probes every known node on a timer and the
   * registry holds the answer, and the session mint already walks candidates
   * until one responds. Saving is configuration, and the registry is built to
   * tolerate endpoints that are dead — that is its entire job. A bad address
   * surfaces through the same unreachable path as a node that fails later,
   * which is also the only path that can report one that dies a minute after
   * being saved.
   */
  const saveServer = useCallback(async (urls: readonly string[]): Promise<string | undefined> => {
    const normalizedEndpoints = normalizeConnectionEndpoints(urls);
    if (normalizedEndpoints.length === 0) {
      const message = 'Enter at least one Macha API endpoint.';
      setConnectionNotice(message);
      return message;
    }
    setConnectionNotice(undefined);
    // A resolver/server boundary cannot change underneath an owned lease.
    // Close the old session first, then make the new server authoritative.
    await playbackRuntime.stop();
    persistBootstrapEndpoints(normalizedEndpoints);
    reportClusterReachable();
    setClusterUnreachable(false);
    setBootstrapEndpoints(normalizedEndpoints);
    setConnectionGate(undefined);
    navigate(routes.home, { replace: true });
    return undefined;
  }, [navigate, playbackRuntime]);

  const openMetadataEditor = useCallback((id: string) => {
    navigate(routes.edit(id));
  }, [navigate]);

  const settingsPane = <SettingsScreen api={api} serverApi={serverApi} bootstrapEndpoints={bootstrapEndpoints} connectionNotice={connectionNotice} onSave={saveServer} />;
  const usersPane = <UsersScreen api={usersApi} session={session} />;
  const managePane = (section: ManageSection) => (
    <ManageScreen
      api={manageApi}
      catalogueApi={catalogueApi}
      section={section}
      users={usersPane}
      onUnmatchedCountChange={setUnmatchedCount}
    />
  );

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
     
      onSave={saveServer}
    />
    {playerHost}
  </div>;

  // Presentation only: hold the splash until the cold-start mint settles
  // rather than flashing empty screens. Correctness does not depend on it —
  // `SessionManager.fetch()` holds any early request for the token itself.
  // Never gate on this mid-playback: a slow re-auth (e.g. reconfiguring the
  // endpoint) must not interrupt something already playing.
  if (connectionRequired && !sessionReady && !activePlayback) return <div className={`app-shell${miniPlayerActive ? ' has-mini-player' : ''}`}>
    <Loading />
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
            if (item.to === routes.manage && !libraryManagementAvailable && !usersAvailable) return null;
            if (item.to === routes.ingest && !permits('importer')) return null;
            // Importing media is a desk task: it wants a keyboard, a file
            // browser and a person willing to type paths. None of that is
            // reachable from a remote, so it does not earn a slot in a
            // ten-foot navigation bar.
            if (item.to === routes.ingest && isTvBuild) return null;
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
        {/* The platform badge lived here and no longer does: it labelled the
            build on every screen for the benefit of nobody but a developer,
            and Status already reports the platform under Playback support,
            beside the codec probes that give it meaning. */}
        <div className="topbar-trailing">
          {session && <AccountMenu api={usersApi} session={session} onSignedOut={refreshSession} />}
          <NavLink
            to={routes.settings}
            className={({ isActive }: { isActive: boolean }) => `topbar-settings${isActive ? ' active' : ''}`}
            data-tv-focusable="true"
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon />
          </NavLink>
        </div>
      </header>
      {!playback.playerRouteActive && (musicSectionActive || statusSectionActive || manageSectionActive) && (
        <div className="section-nav-slot">
          {musicSectionActive
            ? <MusicNav />
            : statusSectionActive
              ? <StatusNav />
              : <ManageNav managementAvailable={libraryManagementAvailable} usersAvailable={usersAvailable} />}
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
          <Route path={routes.status} element={<StatusScreen api={clusterStatusApi} endpointRegistry={endpointRegistry} platform={platform} manageApi={managementAvailable ? manageApi : undefined} section="overview" auth={auth} />} />
          <Route path={routes.statusClient} element={<StatusScreen api={clusterStatusApi} endpointRegistry={endpointRegistry} platform={platform} manageApi={managementAvailable ? manageApi : undefined} section="client" auth={auth} />} />
          <Route path={routes.statusConnectivity} element={<StatusScreen api={clusterStatusApi} endpointRegistry={endpointRegistry} platform={platform} manageApi={managementAvailable ? manageApi : undefined} section="connectivity" auth={auth} />} />
          <Route path="/status/nodes/:nodeId" element={<NodeStatusScreen api={clusterStatusApi} />} />
          <Route path={routes.manage} element={libraryManagementAvailable ? managePane('unmatched') : <Navigate to={routes.settings} replace />} />
          <Route path={routes.manageFiles} element={libraryManagementAvailable ? managePane('files') : <Navigate to={routes.settings} replace />} />
          <Route path={routes.manageUsers} element={usersAvailable ? managePane('users') : <Navigate to={routes.settings} replace />} />
          <Route path={routes.settings} element={settingsPane} />
          <Route path={routes.connection} element={settingsPane} />
          {/* Settings used to live under Manage. A bookmark from then still
              works rather than landing on the catch-all and silently becoming
              Home, which reads as the setting having been lost. */}
          <Route path="/manage/settings" element={<Navigate to={routes.settings} replace />} />
          <Route path="/manage/settings/connection" element={<Navigate to={routes.connection} replace />} />
          <Route path={routes.login} element={<LoginScreen onSignIn={(username, password) => sessionManager.signIn({ username, password })} onSignedIn={refreshSession} />} />
          <Route path={routes.account} element={<AccountScreen api={usersApi} session={session} />} />
          <Route path={routes.accountPassword} element={<ChangePasswordScreen api={usersApi} policy={session?.password_policy} onChanged={refreshSession} />} />
          <Route path={routes.sponsor} element={<SponsorScreen />} />
          <Route path="*" element={<Navigate to={routes.home} replace />} />
        </Routes>
      </main>

      {playerHost}
    </div>
  );
}
