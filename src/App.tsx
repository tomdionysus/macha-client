import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { CatalogueApi, CatalogueMediaProfile, ManageApi, PlaybackFactsApi } from '@machafoundation/core';
import type { MediaApi } from '@machafoundation/core';
import { AppLogo } from './components/AppLogo';
import { MusicNav } from './components/MusicNav';
import { StatusNav } from './components/StatusNav';
import { ManageNav } from './components/ManageNav';
import { ImportNav } from './components/ImportNav';
import { machaLogoUrl as logoUrl } from './uiAssets';
import { useTvNavigation } from './hooks/useTvNavigation';
import { useEndpointHealthMonitor } from './cluster/useEndpointHealthMonitor';
import { useSameOriginEndpoint } from './cluster/sameOriginEndpoint';
import { samsungBackTarget } from './platform/samsungBackNavigation';
import type { Platform } from '@machafoundation/core';
import { buildPlatformTraits, isTvBuild } from './platform/traits';
import type { PlaybackResolver } from '@machafoundation/core';
import { reportClusterReachable, SERVER_REACHABLE_EVENT, SERVER_UNREACHABLE_EVENT } from '@machafoundation/core';
import { SERVER_UNREACHABLE_TEXT, SIGN_OUT_UNCONFIRMED_TEXT } from './text/viewerText';
import type { Episode, MediaSummary, PlaybackProgress, SeasonSummary } from '@machafoundation/core';
import { ContinueWatchingStore } from '@machafoundation/core';
import { hasRole, sessionManager, sessionPermits, type UserRole } from '@machafoundation/core';
import { useCurrentSession } from './app/useCurrentSession';
import { PlaybackQueueStore } from '@machafoundation/core';
import { MusicPlaylistStore } from '@machafoundation/core';
import { VolumeStore } from './state/volume';
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
import { TorrentDetailScreen } from './screens/TorrentDetailScreen';
import { ManageScreen, type ManageSection } from './screens/ManageScreen';
import { UnmatchedFilePage } from './screens/identify/UnmatchedFilePage';
import { NodeStatusScreen, StatusScreen } from './screens/StatusScreen';
import { pathForMedia, routes } from '@machafoundation/core';
import { playerRouteItemId } from '@machafoundation/core';
import { useMachaServices } from './app/useMachaServices';
import { useSession } from './app/useSession';
import { EndpointRegistry, seedEndpoints } from '@machafoundation/core';
import { preferredEndpointForNode } from './cluster/preferredEndpoint';
import { lockoutNotice, lockoutReason } from './app/lockoutNotice';
import { useEndpointCandidates } from './cluster/useEndpointCandidates';
import { setMediaTransferListener } from './playback/directPlayReadAhead';
import { setKeyframeSource } from './platform/WebPlatform';
import { Loading } from './components/Status';
import { useMediaRouteBack } from './app/useMediaRouteBack';
import { useMusicController } from './app/useMusicController';
import { usePlaybackRuntime } from './app/usePlaybackRuntime';
import { measureStartCosts } from './playback/nodeStartCosts';
import { usePlaybackController } from './app/usePlaybackController';
import { playbackVersions, qualityCeiling, QualityPreferenceStore, technicalProfileFromCatalogue, type PlaybackPolicyOverrides, type PlaybackVersions, type VersionStep } from '@machafoundation/core';
import type { DisplayResolution } from './platform/displayResolution';
import { ConnectionGateScreen } from './screens/ConnectionGateScreen';
import { initialConnectionGate, normalizeConnectionEndpoints, shouldEnterConnectionGate, type ConnectionGate } from '@machafoundation/core';

interface Props {
  platform: Platform;
  apiOverride?: MediaApi;
  playbackOverride?: PlaybackResolver;
}

/**
 * `needs` is the role that shows a section. Everything reading the catalogue
 * needs `media_viewer`, Home included. Manage has none: either of two roles
 * reaches it, so the render site decides.
 */
export const navItems = [
  { to: routes.home, label: 'Home', end: true, needs: 'media_viewer' },
  { to: routes.movies, label: 'Movies', end: false, needs: 'media_viewer' },
  { to: routes.series, label: 'TV Shows', end: false, needs: 'media_viewer' },
  { to: routes.music, label: 'Music', end: false, needs: 'media_viewer' },
  { to: routes.search, label: 'Search', end: false, needs: 'media_viewer' },
  { to: routes.ingest, label: 'Import', end: false, needs: 'importer' },
  { to: routes.status, label: 'Status', end: false, needs: 'view_status' },
  { to: routes.manage, label: 'Manage', end: false, needs: undefined },
] as const satisfies readonly { to: string; label: string; end: boolean; needs?: UserRole }[];

/**
 * Where a viewer goes after signing in: the path the login redirect recorded,
 * else `landing`. `from` comes from `location.state`, which a viewer can author,
 * so only a same-document absolute path other than `/login` is honoured. The
 * route guards decide whether the account may see it.
 */
export function postSignInDestination(from: unknown, landing: string): string {
  if (typeof from !== 'string') return landing;
  if (!from.startsWith('/') || from.startsWith('//')) return landing;
  return from === routes.login ? landing : from;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing route parameter: ${name}`);
  return value;
}

function DetailRoute({ api, onPlay, onPlayFromStart, loadVersions, onPlayVersion, progressById, parameter, onEdit, onMediaProfile }: {
  api: MediaApi;
  onPlay: (item: MediaSummary) => void;
  onPlayFromStart: (item: MediaSummary) => void;
  loadVersions?: (item: MediaSummary) => Promise<PlaybackVersions>;
  onPlayVersion?: (item: MediaSummary, version: VersionStep) => void;
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
      loadVersions={loadVersions}
      onPlayVersion={onPlayVersion}
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

function MetadataEditorRoute({ api, facts, manage }: { api: CatalogueApi; facts: PlaybackFactsApi; manage?: ManageApi }) {
  const { itemId } = useParams();
  const navigate = useNavigate();
  return (
    <MetadataEditorScreen
      api={api}
      facts={facts}
      manage={manage}
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
  // With nothing configured, probe this page's own host. The result is never persisted, so every cold start asks again.
  const sameOrigin = useSameOriginEndpoint(connectionRequired && bootstrapEndpoints.length === 0);
  // What the client is pointed at. `ConnectionForm` reads `bootstrapEndpoints` instead, so its field stays empty until something is typed.
  const effectiveEndpoints = useMemo(
    () => bootstrapEndpoints.length > 0
      ? bootstrapEndpoints
      : sameOrigin.endpoint ? [sameOrigin.endpoint] : [],
    [bootstrapEndpoints, sameOrigin.endpoint],
  );
  // Only `'unreachable'` is stored; `'welcome'` is derived from the endpoint list.
  const [connectionGate, setConnectionGate] = useState<ConnectionGate | undefined>();
  // While the same-origin probe runs: no gate, no navigation, no session mint.
  const connectionProbePending = connectionRequired && bootstrapEndpoints.length === 0 && sameOrigin.probing;
  const effectiveConnectionGate = connectionRequired && !connectionProbePending
    ? connectionGate ?? initialConnectionGate(connectionRequired, effectiveEndpoints)
    : undefined;
  const clientId = useMemo(() => getClientId(), []);
  const progressStore = useMemo(() => new ContinueWatchingStore(clientId), [clientId]);
  const queueStore = useMemo(() => new PlaybackQueueStore(clientId), [clientId]);
  const playlistStore = useMemo(() => new MusicPlaylistStore(clientId), [clientId]);
  const volumeStore = useMemo(() => new VolumeStore(clientId), [clientId]);
  // Per device, at core's key, so every client keeps the setting alike.
  const qualityPreferences = useMemo(() => new QualityPreferenceStore(), []);
  // The setting to offer versions this device cannot play: live for the player, read on demand elsewhere.
  const offerAll = useSyncExternalStore(qualityPreferences.subscribe, qualityPreferences.getSnapshot).offerAll === true;
  const offerAllNow = useCallback(() => qualityPreferences.get().offerAll === true, [qualityPreferences]);
  const endpointKey = effectiveEndpoints.join('\n');
  const endpointRegistry = useMemo(
    () => new EndpointRegistry(seedEndpoints({
      configured: bootstrapEndpoints,
      // This page's own origin, confirmed as a Macha node. Present only while nothing is configured, so it never outranks a typed endpoint.
      environment: sameOrigin.endpoint ? [sameOrigin.endpoint] : [],
      // Endpoints reachable in a previous run. Core seeds them as discovered; seeded as environment,
      // the first health cycle would wipe the remembered list.
      remembered: getDiscoveredEndpoints(),
    }),
    // Wall-clock, so the health timestamps read as dates on the Status screen.
    Date.now),
    [endpointKey],
  );
  const endpointCandidates = useEndpointCandidates(endpointRegistry);
  // The viewer's node choice outlives each player, so it is held on the registry. `prefer()` states a
  // routing preference; `recordSuccess` would record a round trip that never happened.
  const pinEndpoint = useCallback(
    (endpointIds: readonly string[]) => {
      const endpointId = preferredEndpointForNode(endpointRegistry.candidates(), endpointIds);
      if (endpointId !== undefined) endpointRegistry.prefer(endpointId);
      return endpointId;
    },
    [endpointRegistry],
  );
  // Feeds the bytes Direct Play read-ahead moves into the registry: the only throughput evidence for a node serving media alone.
  useEffect(() => {
    setMediaTransferListener(
      (url, bytes, durationMs) => endpointRegistry.recordTransferByUrl(url, bytes, durationMs),
    );
    return () => setMediaTransferListener(undefined);
  }, [endpointRegistry]);
  const { auth, ready: sessionReady, roles, mintFailure, signOut: endSession } = useSession({
    connectionRequired,
    serverConfigured: effectiveEndpoints.length > 0,
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
  useEndpointHealthMonitor(endpointRegistry, clusterStatusApi, auth, connectionRequired && effectiveEndpoints.length > 0 && !effectiveConnectionGate);
  // Direct Play's buffered bar reads the file's byte index from the catalogue, which is created after the platform.
  useEffect(() => {
    setKeyframeSource((mediaId) => catalogueApi.keyframes(mediaId));
    return () => setKeyframeSource(undefined);
  }, [catalogueApi]);
  // Wait for the session to settle: a whoami sent during the cold-start mint gets a 401 that is not retried, and the roles are never read.
  const { session, refresh: refreshSession } = useCurrentSession(usersApi, connectionRequired && !effectiveConnectionGate && sessionReady);
  // Permissions come from the token's roles; the whoami supplies only the display name and password
  // policy. `sessionPermits` treats unknown roles as permitting everything.
  const permits = useCallback((role: UserRole) => sessionPermits(roles, role), [roles]);
  // A session granted nothing, or a mint a node refused. Roles stay `undefined` through a refusal, so
  // `permits` alone would show the whole navigation; both cases land on the sign-in wall instead.
  const lockout = lockoutReason(roles, mintFailure?.reason === 'refused');
  const locked = lockout !== undefined;
  // The strict test: unknown roles hide Users, since the screen exists only where the server has accounts.
  const usersAvailable = hasRole(roles, 'manage_users');
  // The server asks `manager` of every change under /api/v1/manage.
  const libraryManagementAvailable = managementAvailable && permits('manager');
  const mediaAvailable = permits('media_viewer');
  // The Manage pane this account can open. `/manage` wants `manager`, so a `manage_users`-only account goes straight to Users.
  const manageLanding = libraryManagementAvailable ? routes.manageUnmatched
    : usersAvailable ? routes.manageUsers
      : undefined;
  // Where a refused route redirects: Home needs the catalogue, and Settings is the one section no role gates.
  const landing = mediaAvailable ? routes.home : manageLanding ?? routes.settings;
  const metadataEditingAvailable = libraryManagementAvailable;

  const policyOverrides = (platform as { playbackPolicy?: PlaybackPolicyOverrides }).playbackPolicy;
  // The cap on automatic play: the viewer's Maximum quality, else the platform's screen. Read at each
  // start. A browser cannot detect mobile data reliably, so the connection is left unknown, which core
  // reads as Wi-Fi.
  const deviceCeiling = useCallback(() => qualityCeiling({
    display: (platform as { displayResolution?: () => DisplayResolution | undefined }).displayResolution?.(),
    preference: qualityPreferences.get(),
  }), [platform, qualityPreferences]);
  // The chooser's inputs: the server's facts for the item, and platform truths no probe can discover.
  const playbackRuntimeOptions = useMemo(() => ({
    // The playback facts endpoint, not the catalogue profile: it carries every file the item holds
    // and the executing node's `operations`, resolved per call.
    facts: async (media: MediaSummary) => playbackFactsApi.facts({ itemId: media.id }),
    policyOverrides,
    qualityCeiling: deviceCeiling,
    offerAll: offerAllNow,
  }), [deviceCeiling, offerAllNow, playbackFactsApi, policyOverrides]);
  // The qualities a detail page offers beside Play, from the runtime's own inputs, so a button plays what it says.
  const loadVersions = useCallback(async (item: MediaSummary): Promise<PlaybackVersions> => playbackVersions(
    await playbackFactsApi.facts({ itemId: item.id }),
    await platform.capabilities(),
    { overrides: policyOverrides, mediaIds: item.mediaIds, ceiling: deviceCeiling(), offerAll: offerAllNow() },
  ), [deviceCeiling, offerAllNow, platform, playbackFactsApi, policyOverrides]);
  // Times every session from its request, so the first fragment measures the node's start cost.
  const measuredResolver = useMemo(() => measureStartCosts(playbackResolver), [playbackResolver]);
  const { runtime: playbackRuntime, state: playbackRuntimeState } = usePlaybackRuntime(platform, measuredResolver, playbackRuntimeOptions);
  const preparePlaybackProfile = useCallback((profile: CatalogueMediaProfile) => {
    playbackRuntime.prepare(technicalProfileFromCatalogue(profile));
  }, [playbackRuntime]);
  // Whether playback may be rebuilt from the URL. `sessionReady` is also true while unconfigured, so
  // endpoints are required too; an injected API has nothing to wait for.
  const playbackReady = !connectionRequired || (effectiveEndpoints.length > 0 && sessionReady);
  const playback = usePlaybackController({
    api,
    platform,
    runtime: playbackRuntime,
    runtimeState: playbackRuntimeState,
    progressStore,
    queueStore,
    volumeStore,
    ready: playbackReady,
  });
  const activePlayback = playback.activePlayback;

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
    const onServerUnreachable = () => {
      if (!connectionRequired) return;
      setConnectionNotice(SERVER_UNREACHABLE_TEXT);
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

  // The route must match the sign-in wall, or Back walks into a page this session may not see. The
  // connection route and anything playing are exempt, as in the render guard.
  useEffect(() => {
    if (!locked || activePlayback) return;
    if (location.pathname === routes.login || location.pathname === routes.connection) return;
    // Carry the intended path, so signing in resumes it.
    navigate(routes.login, { replace: true, state: { from: `${location.pathname}${location.search}` } });
  }, [activePlayback, locked, location.pathname, location.search, navigate]);

  const [signOutNotice, setSignOutNotice] = useState<string>();
  // Order matters: playback first, as its session cannot be closed once the token is gone and would
  // hold a transcode slot; then the session. A failed revoke still signs this device out, with a notice.
  const signOut = useCallback(async () => {
    setSignOutNotice(undefined);
    await playback.stop();
    try {
      await endSession();
    } catch {
      setSignOutNotice(SIGN_OUT_UNCONFIRMED_TEXT);
    }
    refreshSession();
    navigate(routes.home, { replace: true });
  }, [endSession, navigate, playback.stop, refreshSession]);

  const finishSignIn = useCallback(() => {
    setSignOutNotice(undefined);
    refreshSession();
    navigate(postSignInDestination((location.state as { from?: unknown } | null)?.from, landing), { replace: true });
  }, [landing, location.state, navigate, refreshSession]);

  const open = useCallback((item: MediaSummary) => navigate(pathForMedia(item)), [navigate]);
  const openPlayer = useCallback((item: MediaSummary) => playback.startPlayback(item), [playback.startPlayback]);
  const openPlayerFromStart = useCallback((item: MediaSummary) => playback.startPlayback(item, { fromStart: true }), [playback.startPlayback]);
  const openPlayerVersion = useCallback((item: MediaSummary, version: VersionStep) => playback.startPlayback(item, { version }), [playback.startPlayback]);

  const music = useMusicController({
    api,
    playlistStore,
    queueStore,
    activePlayback: Boolean(activePlayback),
    startPlayback: playback.startPlayback,
    onQueueChange: playback.setQueueState,
  });

  // Saves without probing: a probe needs a session, which a fresh install lacks. A bad address
  // surfaces through the same unreachable path as a node that fails later.
  const saveServer = useCallback(async (urls: readonly string[]): Promise<string | undefined> => {
    const normalizedEndpoints = normalizeConnectionEndpoints(urls);
    if (normalizedEndpoints.length === 0) {
      const message = 'Enter at least one Macha API endpoint.';
      setConnectionNotice(message);
      return message;
    }
    setConnectionNotice(undefined);
    // Close the old session before the new server takes over: a lease cannot move between servers.
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
  const detailRouteProps = {
    api,
    onPlay: openPlayer,
    onPlayFromStart: openPlayerFromStart,
    loadVersions,
    onPlayVersion: openPlayerVersion,
    progressById: playback.progressById,
    onEdit: metadataEditingAvailable ? openMetadataEditor : undefined,
    onMediaProfile: preparePlaybackProfile,
  };

  const settingsPane = <SettingsScreen api={api} serverApi={serverApi} bootstrapEndpoints={bootstrapEndpoints} usingHost={sameOrigin.endpoint} connectionNotice={connectionNotice} onSave={saveServer} qualityPreferences={qualityPreferences} qualityCeiling={deviceCeiling} />;
  const usersPane = <UsersScreen api={usersApi} session={session} />;
  // Hiding a nav link is not access control: every catalogue route is guarded here too.
  const mediaPane = (element: ReactElement) => mediaAvailable ? element : <Navigate to={landing} replace />;
  const managePane = (section: ManageSection) => (
    <ManageScreen
      api={manageApi}
      section={section}
      users={usersPane}
    />
  );

  // The operator's name for each node, as core learns it from status.
  const nodeNameOf = useCallback((endpointId: string) => endpointRegistry.nodeName(endpointId), [endpointRegistry]);
  const miniPlayerActive = Boolean(playback.playerVisible && !playback.playerRouteActive);
  const playerHost = playback.playerVisible && activePlayback ? <PlayerHost
    endpoints={endpointCandidates}
    nodeNameOf={nodeNameOf}
    onPinEndpoint={pinEndpoint}
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
    offerAll={offerAll}
  /> : null;

  // Hold the splash while this page's own host is probed, rather than flashing the form.
  if (connectionProbePending) return <div className={`app-shell${miniPlayerActive ? ' has-mini-player' : ''}`}>
    <Loading />
    {playerHost}
  </div>;

  if (effectiveConnectionGate) return <div className={`app-shell${miniPlayerActive ? ' has-mini-player' : ''}`}>
    <ConnectionGateScreen
      welcome={effectiveConnectionGate === 'welcome'}
      notice={connectionNotice}
      bootstrapEndpoints={bootstrapEndpoints}
      usingHost={sameOrigin.endpoint}
      onSave={saveServer}
    />
    {playerHost}
  </div>;

  // Hold the splash until the cold-start mint settles; `SessionManager.fetch()` already holds early
  // requests. Never mid-playback: a slow re-auth must not interrupt it.
  if (connectionRequired && !sessionReady && !activePlayback) return <div className={`app-shell${miniPlayerActive ? ' has-mini-player' : ''}`}>
    <Loading />
    {playerHost}
  </div>;

  // A session granted nothing gets the login alone. Never while playing: failover re-reads the
  // session, and the server stops the stream itself when a role is revoked. `routes.connection`
  // stays reachable so the viewer can point the client at another cluster.
  if (locked && !activePlayback) return <div className="app-shell">
    {location.pathname === routes.connection
      ? <ConnectionGateScreen
          welcome={false}
          notice={connectionNotice}
          bootstrapEndpoints={bootstrapEndpoints}
          usingHost={sameOrigin.endpoint}
          onSave={saveServer}
        />
      : <LoginScreen
          guestAllowed={false}
          connectionReachable
          notice={signOutNotice ?? lockoutNotice(lockout)}
          onSignIn={(username, password) => sessionManager.signIn({ username, password })}
          onSignedIn={finishSignIn}
        />}
  </div>;

  const musicSectionActive = location.pathname === routes.music || location.pathname.startsWith(`${routes.music}/`);
  const statusSectionActive = location.pathname === routes.status || location.pathname.startsWith(`${routes.status}/`);
  const manageSectionActive = location.pathname === routes.manage || location.pathname.startsWith(`${routes.manage}/`);
  const importSectionActive = location.pathname === routes.ingest || location.pathname.startsWith(`${routes.ingest}/`);

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
            if (item.needs && !permits(item.needs)) return null;
            // Importing needs a keyboard and a file browser, which a remote cannot offer.
            if (item.to === routes.ingest && isTvBuild) return null;
            return (
              <NavLink
                key={item.to}
                to={item.to === routes.manage ? manageLanding ?? item.to : item.to}
                end={item.end}
                data-tv-focusable="true"
                className={({ isActive }: { isActive: boolean }) => isActive ? 'active' : undefined}
              >
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="topbar-trailing">
          {session && <AccountMenu session={session} onSignOut={signOut} />}
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
      {signOutNotice && (
        <p className="app-notice" role="alert">
          {signOutNotice}
          <button className="secondary-button" type="button" onClick={() => setSignOutNotice(undefined)} data-tv-focusable="true">Dismiss</button>
        </p>
      )}
      {!playback.playerRouteActive && (musicSectionActive || statusSectionActive || manageSectionActive || importSectionActive) && (
        <div className="section-nav-slot">
          {musicSectionActive
            ? <MusicNav />
            : statusSectionActive
              ? <StatusNav />
              : importSectionActive
                ? <ImportNav />
                : <ManageNav managementAvailable={libraryManagementAvailable} usersAvailable={usersAvailable} />}
        </div>
      )}
      <main>
        <Routes>
          <Route path={routes.home} element={mediaPane(<HomeScreen api={api} catalogue={catalogueApi} continueWatching={playback.continueWatching} onOpen={open} onResume={openPlayer} onRemoveFromContinueWatching={playback.removeFromContinueWatching} />)} />
          <Route path={routes.movies} element={mediaPane(<LibraryScreen api={api} kind="movies" onOpen={open} />)} />
          <Route path="/movies/:movieId" element={mediaPane(<DetailRoute {...detailRouteProps} parameter="movieId" />)} />
          <Route path={routes.series} element={mediaPane(<LibraryScreen api={api} kind="shows" onOpen={open} />)} />
          <Route path="/series/:seriesId" element={mediaPane(<SeriesRoute api={api} onOpenSeason={open} onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} />)} />
          <Route path="/series/:seriesId/seasons/:seasonId" element={mediaPane(<SeasonRoute api={api} progress={playback.progressById} onPlayEpisode={playback.openSeasonEpisode} onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} />)} />
          <Route path="/episodes/:episodeId" element={mediaPane(<DetailRoute {...detailRouteProps} parameter="episodeId" />)} />
          <Route path={routes.music} element={mediaPane(<Navigate to={routes.musicArtists} replace />)} />
          <Route path={routes.musicArtists} element={mediaPane(<MusicScreen api={api} section="artists" onOpen={open} onPlayNow={music.playNow} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} />)} />
          <Route path={routes.musicAlbums} element={mediaPane(<MusicScreen api={api} section="albums" onOpen={open} onPlayNow={music.playNow} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} />)} />
          <Route path={routes.musicTracks} element={mediaPane(<MusicScreen api={api} section="tracks" onOpen={open} onPlayNow={music.playNow} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} />)} />
          <Route path={routes.musicPlaylist} element={mediaPane(<MusicPlaylistScreen api={api} catalogue={catalogueApi} entries={music.playlistEntries} onPlay={(index) => music.playPlaylist(false, index)} onShuffle={() => music.playPlaylist(true)} onRemove={music.removePlaylistEntry} onMove={music.movePlaylistEntry} onClear={music.clearPlaylist} />)} />
          <Route path="/music/artists/:artistId" element={mediaPane(<ArtistRoute api={api} onOpenAlbum={open} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} />)} />
          <Route path="/music/albums/:albumId" element={mediaPane(<AlbumRoute api={api} onPlay={playback.openAlbumTrack} onPlayAll={music.playAlbumAll} onOpenTrack={open} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} />)} />
          <Route path="/music/tracks/:trackId" element={mediaPane(<DetailRoute {...detailRouteProps} parameter="trackId" />)} />
          <Route path="/play/:itemId" element={<div className="player-route-placeholder" aria-hidden="true" />} />
          <Route path="/items/:itemId" element={mediaPane(<DetailRoute {...detailRouteProps} parameter="itemId" />)} />
          <Route path="/items/:itemId/edit" element={metadataEditingAvailable ? <MetadataEditorRoute api={catalogueApi} facts={playbackFactsApi} manage={libraryManagementAvailable ? manageApi : undefined} /> : <Navigate to={landing} replace />} />
          <Route path={routes.search} element={mediaPane(<SearchScreen api={api} onOpen={open} />)} />
          <Route path={routes.ingest} element={<Navigate to={routes.ingestTorrents} replace />} />
          <Route path={routes.ingestTorrents} element={permits('importer') ? <IngestScreen api={acquisitionApi} section="torrents" /> : <Navigate to={landing} replace />} />
          <Route path={routes.ingestFiles} element={permits('importer') ? <IngestScreen api={acquisitionApi} section="files" /> : <Navigate to={landing} replace />} />
          <Route path={`${routes.ingestTorrents}/:torrentId`} element={permits('importer') ? <TorrentDetailScreen api={acquisitionApi} /> : <Navigate to={landing} replace />} />
          <Route path={routes.status} element={permits('view_status') ? <StatusScreen api={clusterStatusApi} endpointRegistry={endpointRegistry} platform={platform} manageApi={libraryManagementAvailable ? manageApi : undefined} section="overview" auth={auth} /> : <Navigate to={landing} replace />} />
          <Route path={routes.statusClient} element={permits('view_status') ? <StatusScreen api={clusterStatusApi} endpointRegistry={endpointRegistry} platform={platform} manageApi={libraryManagementAvailable ? manageApi : undefined} section="client" auth={auth} /> : <Navigate to={landing} replace />} />
          <Route path={routes.statusConnectivity} element={permits('view_status') ? <StatusScreen api={clusterStatusApi} endpointRegistry={endpointRegistry} platform={platform} manageApi={libraryManagementAvailable ? manageApi : undefined} section="connectivity" auth={auth} /> : <Navigate to={landing} replace />} />
          <Route path="/status/nodes/:nodeId" element={permits('view_status') ? <NodeStatusScreen api={clusterStatusApi} /> : <Navigate to={landing} replace />} />
          <Route path={routes.manage} element={<Navigate to={libraryManagementAvailable ? routes.manageUnmatched : usersAvailable ? routes.manageUsers : routes.settings} replace />} />
          <Route path={routes.manageUnmatched} element={libraryManagementAvailable ? managePane('unmatched') : <Navigate to={routes.settings} replace />} />
          <Route path={`${routes.manageUnmatched}/:fileId`} element={libraryManagementAvailable ? <UnmatchedFilePage api={manageApi} catalogueApi={catalogueApi} /> : <Navigate to={routes.settings} replace />} />
          <Route path={routes.manageFiles} element={libraryManagementAvailable ? managePane('files') : <Navigate to={routes.settings} replace />} />
          <Route path={routes.manageUsers} element={usersAvailable ? managePane('users') : <Navigate to={routes.settings} replace />} />
          <Route path={routes.settings} element={settingsPane} />
          <Route path={routes.connection} element={settingsPane} />
          {/* Settings paths under Manage redirect rather than fall to the catch-all. */}
          <Route path="/manage/settings" element={<Navigate to={routes.settings} replace />} />
          <Route path="/manage/settings/connection" element={<Navigate to={routes.connection} replace />} />
          <Route path={routes.login} element={<LoginScreen onSignIn={(username, password) => sessionManager.signIn({ username, password })} onSignedIn={finishSignIn} />} />
          <Route path={routes.account} element={<AccountScreen api={usersApi} session={session} />} />
          <Route path={routes.accountPassword} element={<ChangePasswordScreen api={usersApi} policy={session?.password_policy} onChanged={refreshSession} />} />
          <Route path={routes.sponsor} element={<SponsorScreen />} />
          <Route path="*" element={<Navigate to={landing} replace />} />
        </Routes>
      </main>

      {playerHost}
    </div>
  );
}
