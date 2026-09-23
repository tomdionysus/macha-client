import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
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
import { useSameOriginEndpoint } from './cluster/sameOriginEndpoint';
import { samsungBackTarget } from './platform/samsungBackNavigation';
import type { Platform } from '@machafoundation/core';
import { buildPlatformTraits, isTvBuild } from './platform/traits';
import type { PlaybackResolver } from '@machafoundation/core';
import { reportClusterReachable, SERVER_REACHABLE_EVENT, SERVER_UNREACHABLE_EVENT, SERVER_UNREACHABLE_MESSAGE } from '@machafoundation/core';
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
import { NodeStatusScreen, StatusScreen } from './screens/StatusScreen';
import { pathForMedia, routes } from '@machafoundation/core';
import { playerRouteItemId } from '@machafoundation/core';
import { useMachaServices } from './app/useMachaServices';
import { useSession } from './app/useSession';
import { EndpointRegistry, bootstrapEndpoints as bootstrapClusterEndpoints } from '@machafoundation/core';
import { preferredEndpointForNode } from './cluster/preferredEndpoint';
import { lockoutNotice, lockoutReason } from './app/lockoutNotice';
import { useEndpointCandidates } from './cluster/useEndpointCandidates';
import { setMediaTransferListener } from './playback/directPlayReadAhead';
import { Loading } from './components/Status';
import { useMediaRouteBack } from './app/useMediaRouteBack';
import { useMusicController } from './app/useMusicController';
import { usePlaybackRuntime } from './app/usePlaybackRuntime';
import { measureStartCosts } from './playback/nodeStartCosts';
import { usePlaybackController } from './app/usePlaybackController';
import { technicalProfileFromCatalogue, type PlaybackPolicyOverrides } from '@machafoundation/core';
import { ConnectionGateScreen } from './screens/ConnectionGateScreen';
import { initialConnectionGate, normalizeConnectionEndpoints, shouldEnterConnectionGate, type ConnectionGate } from '@machafoundation/core';

interface Props {
  platform: Platform;
  apiOverride?: MediaApi;
  playbackOverride?: PlaybackResolver;
}

/**
 * `needs` is the role a section is worth showing for, stated here rather than
 * as a chain of special cases at the render site.
 *
 * Everything that reads the catalogue needs `media_viewer` — including Home,
 * which is a catalogue screen despite not looking like one. Leaving it
 * ungated is what turns an account without that role into a wall of failed
 * requests: the viewer lands on Home, Home asks for the catalogue, and the
 * server answers 401 exactly as it should.
 *
 * Manage is the exception and carries no `needs`: two different roles reach
 * it and either will do, so it is decided at the render site instead.
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
 * Where a viewer goes once they have signed in.
 *
 * The login redirect already records where they were heading — a deep link
 * into a title, usually — and without this that intent is collected and then
 * dropped: `onSignedIn` refreshed the session and nothing navigated, leaving
 * somebody who has just authenticated looking at the login form they only
 * filled in because they wanted to watch something.
 *
 * `from` is trusted only as far as it is a path this application produced. It
 * comes from `location.state`, which a viewer can author via the History API,
 * so anything that is not a same-document absolute path is discarded rather
 * than navigated to. `/login` itself is excluded because sending them back
 * there would be the same dead end by a longer route.
 *
 * Whether the account may actually see the destination is not decided here.
 * The route guards already answer that, and they answer it the same way for a
 * bookmark, a Back or the catch-all — so an account that signs in and still
 * cannot view the title lands wherever those send it, rather than this
 * second-guessing them with a different rule.
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
  /**
   * With nothing configured, ask this page's own host before asking the viewer.
   *
   * A client served from a Macha node should not make somebody type in the
   * address they are already looking at. The candidate is confirmed from the
   * body of `/api/v1/health` rather than from its status line — see
   * `useSameOriginEndpoint` for why that distinction is the whole feature —
   * and it is never persisted as configuration, so this asks again on every
   * cold start and can never go stale.
   */
  const sameOrigin = useSameOriginEndpoint(connectionRequired && bootstrapEndpoints.length === 0);
  /**
   * What this client is actually pointed at, which is not the same as what a
   * viewer has configured. Everything that needs an endpoint reads this;
   * `ConnectionForm` keeps reading `bootstrapEndpoints`, so the field stays
   * honestly empty when nothing has been typed.
   */
  const effectiveEndpoints = useMemo(
    () => bootstrapEndpoints.length > 0
      ? bootstrapEndpoints
      : sameOrigin.endpoint ? [sameOrigin.endpoint] : [],
    [bootstrapEndpoints, sameOrigin.endpoint],
  );
  // Only `'unreachable'` is held as state. `'welcome'` is derived, so it cannot
  // disagree with the endpoint list the way a stored copy of the same fact can.
  const [connectionGate, setConnectionGate] = useState<ConnectionGate | undefined>();
  /**
   * Nothing is decided yet, so decide nothing: no gate, no navigation, no
   * session mint against an endpoint list that is about to change. The splash
   * holds instead, bounded by the probe's own deadline.
   */
  const connectionProbePending = connectionRequired && bootstrapEndpoints.length === 0 && sameOrigin.probing;
  const effectiveConnectionGate = connectionRequired && !connectionProbePending
    ? connectionGate ?? initialConnectionGate(connectionRequired, effectiveEndpoints)
    : undefined;
  const clientId = useMemo(() => getClientId(), []);
  const progressStore = useMemo(() => new ContinueWatchingStore(clientId), [clientId]);
  const queueStore = useMemo(() => new PlaybackQueueStore(clientId), [clientId]);
  const playlistStore = useMemo(() => new MusicPlaylistStore(clientId), [clientId]);
  const volumeStore = useMemo(() => new VolumeStore(clientId), [clientId]);
  const endpointKey = effectiveEndpoints.join('\n');
  const endpointRegistry = useMemo(
    () => new EndpointRegistry([
      ...bootstrapClusterEndpoints(bootstrapEndpoints),
      // A Macha node confirmed on this page's own origin. Seeded the way
      // discovered membership is, because that is what it is — derived rather
      // than configured, and never written where configuration is read from.
      // It exists only while nothing is configured, so it can never outrank an
      // endpoint a viewer typed.
      ...bootstrapClusterEndpoints(sameOrigin.endpoint ? [sameOrigin.endpoint] : [], 'environment'),
      // Runtime-discovered membership confirmed reachable in a previous
      // session — never user configuration (`docs/server-api.md`), so it's
      // seeded after the real bootstrap seeds and dropped on any conflict by
      // the registry's own dedup. Gives a reload somewhere to fall back to
      // if the single configured endpoint happens to be down at that exact
      // moment; the next successful discovery cycle supersedes it either way.
      ...bootstrapClusterEndpoints(getDiscoveredEndpoints(), 'environment'),
      // Wall-clock, so the timestamps the registry stamps on health — last
      // success, last failure — are readable as dates on the Status screen.
      // Nothing outside the registry compares against its *durations* any
      // more: `EndpointCandidate.ready` answers "is this endpoint out of
      // cooldown" from inside, against whatever clock it actually holds.
    ], Date.now),
    [endpointKey],
  );
  const endpointCandidates = useEndpointCandidates(endpointRegistry);
  /**
   * The viewer's node choice, stated to core as what it is: a routing
   * preference that asserts nothing about the node.
   *
   * Kept here because the registry is — a player is created and destroyed per
   * item, and a choice that died with the player would have to be made again
   * on the next one. `prefer()` arrived in core on 2026-09-21 for exactly
   * this; before it, the only public way to be preferred was `recordSuccess`,
   * which also wrote a successful round trip that never happened.
   */
  const pinEndpoint = useCallback(
    (endpointIds: readonly string[]) => {
      const endpointId = preferredEndpointForNode(endpointRegistry.candidates(), endpointIds);
      if (endpointId !== undefined) endpointRegistry.prefer(endpointId);
      return endpointId;
    },
    [endpointRegistry],
  );
  /**
   * Media is where the bytes are, and core cannot see them.
   *
   * Core records its own JSON reads from 0.12.0 and owns the bandwidth store,
   * so the client wires one thing only: the bytes the Direct Play read-ahead
   * worker moved. Without this the record describes JSON alone — which is how
   * this client once spent an afternoon streaming from the slowest node it
   * had, because a node serving nothing but media had no throughput evidence
   * to be judged on.
   *
   * It matters more than it looks. Measured against the cluster on 2026-09-15,
   * a movie listing is 416 KB and a show listing 67 KB — both clear core's
   * sample floor — but `/api/v1/status` is 5.7 KB and `catalogue/status` 303
   * bytes, so the ten-second health cycle contributes nothing at all. JSON
   * evidence therefore arrives only when a viewer opens a library, and a
   * client launched straight into a player has none. This feed is the only
   * throughput evidence such a session will ever produce.
   */
  useEffect(() => {
    setMediaTransferListener(
      (url, bytes, durationMs) => endpointRegistry.recordTransferByUrl(url, bytes, durationMs),
    );
    return () => setMediaTransferListener(undefined);
  }, [endpointRegistry]);
  const { auth, ready: sessionReady, roles, mintFailure } = useSession({
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
  // Not before the session has settled. `SessionManager.fetch` retries a 401
  // only when it actually sent a token, so a whoami that goes out during the
  // cold-start mint is answered 401, returned as-is, and the roles are never
  // read — leaving every privileged section visible for the rest of the run.
  // It only ever worked by timing.
  const { session, refresh: refreshSession } = useCurrentSession(usersApi, connectionRequired && !effectiveConnectionGate && sessionReady);
  /**
   * Permissions come from the token, identity comes from the whoami.
   *
   * They are deliberately separate now. `roles` rides the session itself, so a
   * failover or a slow node cannot leave the navigation guessing; the whoami
   * above supplies only the display name and the password policy, and a
   * failure there costs a name rather than a set of permissions.
   *
   * `sessionPermits` keeps the rule that unknown is not none — an unanswered
   * cluster permits everything rather than emptying the navigation — and it is
   * core's, so all four clients answer it identically.
   */
  const permits = useCallback((role: UserRole) => sessionPermits(roles, role), [roles]);
  /**
   * No session, and the cluster is the reason — two facts with one honest
   * answer for the viewer.
   *
   * `sessionLockedOut` is a session that exists and may do nothing.
   * `mintFailure.reason === 'refused'` is no session at all: a node answered
   * and stated a policy, which is a different thing from a node that could not
   * be asked. Core withholds the unreachable report for a refusal precisely so
   * that a client does not send a viewer to check a server that is up and
   * working exactly as configured — and until now this client had nothing to
   * say in its place. Roles stay `undefined` through a refusal, so `permits`
   * answers its permissive "unknown is not none" and the whole navigation
   * rendered as usual over a session that does not exist: every section
   * visible, every request refused, and nothing on screen admitting it.
   *
   * Both land on the sign-in wall, which is the one thing a viewer can
   * actually do about either. The server's own sentence is deliberately not
   * shown — core's contract is that it is never assumed fit for a viewer.
   */
  const lockout = lockoutReason(roles, mintFailure?.reason === 'refused');
  const locked = lockout !== undefined;
  // Users is the exception, and deliberately the other way round: the screen
  // exists only because the server has accounts, so an unknown answer means
  // there is nothing there to show rather than something to reveal. `hasRole`
  // is the strict test — `undefined` is false — which is exactly that.
  const usersAvailable = hasRole(roles, 'manage_users');
  const libraryManagementAvailable = managementAvailable && permits('manager');
  const mediaAvailable = permits('media_viewer');
  /**
   * The Manage pane this account can actually open, or nothing.
   *
   * `/manage` is the unmatched-files pane and wants `manager`, so an account
   * holding only `manage_users` has to be sent to the Users pane directly —
   * pointing it at the section root would bounce it to Settings, which is the
   * section it could not use rather than the one it could.
   */
  const manageLanding = libraryManagementAvailable ? routes.manage
    : usersAvailable ? routes.manageUsers
      : undefined;
  /**
   * Where a viewer goes when the route they asked for is not theirs to see.
   *
   * Home is only the right answer for someone who may read the catalogue. An
   * account with `manage_users` and nothing else has no media at all, so
   * sending it to Home would land it on the one screen guaranteed to fail —
   * and the catch-all would send it straight back. Settings is the last
   * resort because it is the one section no role gates.
   */
  const landing = mediaAvailable ? routes.home : manageLanding ?? routes.settings;
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
  // Every session core asks for is timed from the request, so the player's
  // first fragment closes a measurement of what that node costs to start.
  const measuredResolver = useMemo(() => measureStartCosts(playbackResolver), [playbackResolver]);
  const { runtime: playbackRuntime, state: playbackRuntimeState } = usePlaybackRuntime(platform, measuredResolver, playbackRuntimeOptions);
  const preparePlaybackProfile = useCallback((profile: CatalogueMediaProfile) => {
    playbackRuntime.prepare(technicalProfileFromCatalogue(profile));
  }, [playbackRuntime]);
  /**
   * Whether playback may be reconstructed from the URL yet.
   *
   * A deep link into `/play/:id` runs its effect before anything has been
   * established, so without this the client asks for playback facts with no
   * endpoint and no session and chooses an instruction blind. `sessionReady`
   * alone is not the test — it is true precisely while the client is
   * *unconfigured* — so the endpoint list has to be in it.
   *
   * `!connectionRequired` is the injected-API case, which has no endpoints, no
   * session and nothing to wait for.
   */
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

  // Same shape as the connection gate above, and for the same reason: the
  // route has to agree with what is on screen, or Back walks into a page this
  // session may not see. `routes.connection` stays reachable deliberately —
  // see the render guard — and so does anything already playing, because a
  // redirect mid-film is the same interruption the render guard refuses.
  useEffect(() => {
    if (!locked || activePlayback) return;
    if (location.pathname === routes.login || location.pathname === routes.connection) return;
    // Carry where they were trying to go, so signing in finishes the journey
    // rather than dropping them on Home to start it again.
    navigate(routes.login, { replace: true, state: { from: `${location.pathname}${location.search}` } });
  }, [activePlayback, locked, location.pathname, location.search, navigate]);

  /**
   * Finish the journey the login interrupted, rather than ending it at the form.
   */
  const finishSignIn = useCallback(() => {
    refreshSession();
    navigate(postSignInDestination((location.state as { from?: unknown } | null)?.from, landing), { replace: true });
  }, [landing, location.state, navigate, refreshSession]);

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

  const settingsPane = <SettingsScreen api={api} serverApi={serverApi} bootstrapEndpoints={bootstrapEndpoints} usingHost={sameOrigin.endpoint} connectionNotice={connectionNotice} onSave={saveServer} />;
  const usersPane = <UsersScreen api={usersApi} session={session} />;
  /**
   * Hiding a link is not access control — a bookmark, a Back, or the catch-all
   * below all reach a route with no nav involved. Every catalogue screen goes
   * through here so that the nav and the routes agree, rather than the nav
   * being tidy while the routes stay open.
   */
  const mediaPane = (element: ReactElement) => mediaAvailable ? element : <Navigate to={landing} replace />;
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
    endpoints={endpointCandidates}
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
  /> : null;

  // Presentation only, and the same shape as the session splash below: hold
  // while this page's own host is asked whether it is Macha, rather than
  // flashing a form at somebody who is about to not need it. Bounded by the
  // probe's own deadline, so the worst case is a slightly late Welcome screen.
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

  // Presentation only: hold the splash until the cold-start mint settles
  // rather than flashing empty screens. Correctness does not depend on it —
  // `SessionManager.fetch()` holds any early request for the token itself.
  // Never gate on this mid-playback: a slow re-auth (e.g. reconfiguring the
  // endpoint) must not interrupt something already playing.
  if (connectionRequired && !sessionReady && !activePlayback) return <div className={`app-shell${miniPlayerActive ? ' has-mini-player' : ''}`}>
    <Loading />
    {playerHost}
  </div>;

  // A session the server granted nothing gets a login and nothing else: no
  // topbar, no navigation, no routes into the library.
  //
  // **Never while something is playing**, which is the same rule the splash
  // above follows and for a stronger reason. This wall is raised from a
  // re-read of the session, and a re-read happens on every re-mint — which is
  // what failover does. Tearing the player down on it would turn a node dying
  // mid-film, the exact event this client exists to survive invisibly, into a
  // black screen. Nothing is lost by waiting: revoking a role bumps
  // `credential_generation` and kills the session cluster-wide, so the stream
  // stops at the server, authoritatively, without the client guessing. The
  // wall goes up when playback ends.
  //
  // `routes.connection` is the other exception, and it is not a hole in the
  // wall: it grants no media, only the ability to point this client at a
  // different cluster. Without it a viewer whose node stops granting roles
  // can neither sign in nor leave — 0.13.0 shipped that exact shape of
  // lockout, where the gate stood in front of the one screen that could undo
  // it, and it took a release to get out of.
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
          notice={lockoutNotice(lockout)}
          onSignIn={(username, password) => sessionManager.signIn({ username, password })}
          onSignedIn={finishSignIn}
        />}
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
            if (item.needs && !permits(item.needs)) return null;
            // Importing media is a desk task: it wants a keyboard, a file
            // browser and a person willing to type paths. None of that is
            // reachable from a remote, so it does not earn a slot in a
            // ten-foot navigation bar.
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
          <Route path={routes.home} element={mediaPane(<HomeScreen api={api} continueWatching={playback.continueWatching} onOpen={open} onResume={openPlayer} onRemoveFromContinueWatching={playback.removeFromContinueWatching} />)} />
          <Route path={routes.movies} element={mediaPane(<LibraryScreen api={api} kind="movies" onOpen={open} />)} />
          <Route path="/movies/:movieId" element={mediaPane(<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={playback.progressById} parameter="movieId" onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} onMediaProfile={preparePlaybackProfile} />)} />
          <Route path={routes.series} element={mediaPane(<LibraryScreen api={api} kind="shows" onOpen={open} />)} />
          <Route path="/series/:seriesId" element={mediaPane(<SeriesRoute api={api} onOpenSeason={open} onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} />)} />
          <Route path="/series/:seriesId/seasons/:seasonId" element={mediaPane(<SeasonRoute api={api} progress={playback.progressById} onPlayEpisode={playback.openSeasonEpisode} onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} />)} />
          <Route path="/episodes/:episodeId" element={mediaPane(<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={playback.progressById} parameter="episodeId" onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} onMediaProfile={preparePlaybackProfile} />)} />
          <Route path={routes.music} element={mediaPane(<Navigate to={routes.musicArtists} replace />)} />
          <Route path={routes.musicArtists} element={mediaPane(<MusicScreen api={api} section="artists" onOpen={open} onPlayNow={music.playNow} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} />)} />
          <Route path={routes.musicAlbums} element={mediaPane(<MusicScreen api={api} section="albums" onOpen={open} onPlayNow={music.playNow} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} />)} />
          <Route path={routes.musicTracks} element={mediaPane(<MusicScreen api={api} section="tracks" onOpen={open} onPlayNow={music.playNow} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} />)} />
          <Route path={routes.musicPlaylist} element={mediaPane(<MusicPlaylistScreen api={api} entries={music.playlistEntries} onPlay={(index) => music.playPlaylist(false, index)} onShuffle={() => music.playPlaylist(true)} onRemove={music.removePlaylistEntry} onMove={music.movePlaylistEntry} onClear={music.clearPlaylist} />)} />
          <Route path="/music/artists/:artistId" element={mediaPane(<ArtistRoute api={api} onOpenAlbum={open} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} />)} />
          <Route path="/music/albums/:albumId" element={mediaPane(<AlbumRoute api={api} onPlay={playback.openAlbumTrack} onPlayAll={music.playAlbumAll} onOpenTrack={open} onAddToPlaylist={music.addToPlaylist} onPlayNext={music.playNext} onPlayLater={music.playLater} onShuffle={music.shuffle} onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} />)} />
          <Route path="/music/tracks/:trackId" element={mediaPane(<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={playback.progressById} parameter="trackId" onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} onMediaProfile={preparePlaybackProfile} />)} />
          <Route path="/play/:itemId" element={<div className="player-route-placeholder" aria-hidden="true" />} />
          <Route path="/items/:itemId" element={mediaPane(<DetailRoute api={api} onPlay={openPlayer} onPlayFromStart={openPlayerFromStart} progressById={playback.progressById} parameter="itemId" onEdit={metadataEditingAvailable ? openMetadataEditor : undefined} onMediaProfile={preparePlaybackProfile} />)} />
          <Route path="/items/:itemId/edit" element={metadataEditingAvailable ? <MetadataEditorRoute api={catalogueApi} /> : <Navigate to={landing} replace />} />
          <Route path={routes.search} element={mediaPane(<SearchScreen api={api} onOpen={open} />)} />
          <Route path={routes.ingest} element={permits('importer') ? <IngestScreen api={acquisitionApi} /> : <Navigate to={landing} replace />} />
          <Route path={`${routes.ingest}/torrents/:torrentId`} element={permits('importer') ? <TorrentDetailScreen api={acquisitionApi} /> : <Navigate to={landing} replace />} />
          <Route path={routes.status} element={permits('view_status') ? <StatusScreen api={clusterStatusApi} endpointRegistry={endpointRegistry} platform={platform} manageApi={managementAvailable ? manageApi : undefined} section="overview" auth={auth} /> : <Navigate to={landing} replace />} />
          <Route path={routes.statusClient} element={permits('view_status') ? <StatusScreen api={clusterStatusApi} endpointRegistry={endpointRegistry} platform={platform} manageApi={managementAvailable ? manageApi : undefined} section="client" auth={auth} /> : <Navigate to={landing} replace />} />
          <Route path={routes.statusConnectivity} element={permits('view_status') ? <StatusScreen api={clusterStatusApi} endpointRegistry={endpointRegistry} platform={platform} manageApi={managementAvailable ? manageApi : undefined} section="connectivity" auth={auth} /> : <Navigate to={landing} replace />} />
          <Route path="/status/nodes/:nodeId" element={permits('view_status') ? <NodeStatusScreen api={clusterStatusApi} /> : <Navigate to={landing} replace />} />
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
