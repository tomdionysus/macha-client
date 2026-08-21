import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { MachaCatalogueApi } from './api/MachaCatalogueApi';
import { MachaMediaApi } from './api/MachaMediaApi';
import { MockMediaApi } from './api/MockMediaApi';
import { AppLogo } from './components/AppLogo';
import logoUrl from './assets/macha-logo.svg?url';
import { useTvNavigation } from './hooks/useTvNavigation';
import { DemoPlaybackResolver } from './playback/DemoPlaybackResolver';
import { MachaPlaybackResolver } from './playback/MachaPlaybackResolver';
import { DemoServerApi, MachaServerApi } from './api/MachaServerApi';
import { DemoAcquisitionApi, MachaAcquisitionApi } from './api/MachaAcquisitionApi';
import { SERVER_UNREACHABLE_EVENT, SERVER_UNREACHABLE_MESSAGE } from './api/serverConnection';
import { ContinueWatchingStore } from './state/continueWatching';
import { migrateEpisodeContext, needsEpisodeContextMigration } from './state/continueWatchingMigration';
import { PlaybackQueueStore } from './state/playbackQueue';
import { MusicPlaylistStore } from './state/musicPlaylist';
import { VolumeStore } from './state/volume';
import { getApiToken, getClientId, getServerUrl, setApiToken as persistApiToken, setServerUrl as persistServerUrl, } from './state/client';
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
import { pathForMedia, routes } from './routing';
const navItems = [
    { to: routes.home, label: 'Home', end: true },
    { to: routes.movies, label: 'Movies', end: false },
    { to: routes.series, label: 'TV Shows', end: false },
    { to: routes.music, label: 'Music', end: false },
    { to: routes.search, label: 'Search', end: false },
    { to: routes.ingest, label: 'Import', end: false },
    { to: routes.settings, label: 'Settings', end: false },
];
function required(value, name) {
    if (!value)
        throw new Error(`Missing route parameter: ${name}`);
    return value;
}
function playerRouteItemId(pathname) {
    const match = pathname.match(/^\/play\/([^/]+)$/);
    if (!match)
        return undefined;
    try {
        return decodeURIComponent(match[1]);
    }
    catch {
        return match[1];
    }
}
function shuffled(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swapWith = Math.floor(Math.random() * (index + 1));
        [result[index], result[swapWith]] = [result[swapWith], result[index]];
    }
    return result;
}
function DetailRoute({ api, onPlay, onPlayFromStart, progressById, parameter, onEdit }) {
    const params = useParams();
    const navigate = useNavigate();
    const itemId = required(params[parameter], parameter);
    return (_jsx(DetailScreen, { api: api, itemId: itemId, onBack: () => navigate(-1), onPlay: onPlay, onPlayFromStart: onPlayFromStart, progress: progressById.get(itemId), onEdit: onEdit ? () => onEdit(itemId) : undefined }));
}
function SeriesRoute({ api, onOpenSeason, onEdit }) {
    const { seriesId } = useParams();
    const navigate = useNavigate();
    const resolvedSeriesId = required(seriesId, 'seriesId');
    return (_jsx(SeriesScreen, { api: api, seriesId: resolvedSeriesId, onBack: () => navigate(-1), onOpenSeason: onOpenSeason, onEdit: onEdit ? () => onEdit(resolvedSeriesId) : undefined }));
}
function SeasonRoute({ api, progress, onPlayEpisode, onEdit }) {
    const { seriesId, seasonId } = useParams();
    const navigate = useNavigate();
    const resolvedSeriesId = required(seriesId, 'seriesId');
    const resolvedSeasonId = required(seasonId, 'seasonId');
    return (_jsx(SeasonScreen, { api: api, seriesId: resolvedSeriesId, seasonId: resolvedSeasonId, onBack: () => navigate(-1), progress: progress, onPlayEpisode: onPlayEpisode, onEdit: onEdit ? () => onEdit(resolvedSeasonId) : undefined }));
}
function ArtistRoute({ api, onOpenAlbum, onAddToPlaylist, onPlayNext, onPlayLater, onShuffle, onEdit }) {
    const { artistId } = useParams();
    const navigate = useNavigate();
    const resolvedArtistId = required(artistId, 'artistId');
    return (_jsx(ArtistScreen, { api: api, artistId: resolvedArtistId, onBack: () => navigate(routes.musicArtists), onOpenAlbum: onOpenAlbum, onAddToPlaylist: onAddToPlaylist, onPlayNext: onPlayNext, onPlayLater: onPlayLater, onShuffle: onShuffle, onEdit: onEdit ? () => onEdit(resolvedArtistId) : undefined }));
}
function AlbumRoute({ api, onPlay, onPlayAll, onOpenTrack, onAddToPlaylist, onPlayNext, onPlayLater, onShuffle, onEdit }) {
    const { albumId } = useParams();
    const navigate = useNavigate();
    const resolvedAlbumId = required(albumId, 'albumId');
    return (_jsx(AlbumScreen, { api: api, albumId: resolvedAlbumId, onBack: () => navigate(-1), onPlayTrack: onPlay, onPlayAll: onPlayAll, onOpenTrack: onOpenTrack, onAddToPlaylist: onAddToPlaylist, onPlayNext: onPlayNext, onPlayLater: onPlayLater, onShuffle: onShuffle, onEdit: onEdit ? () => onEdit(resolvedAlbumId) : undefined }));
}
function MetadataEditorRoute({ api }) {
    const { itemId } = useParams();
    const navigate = useNavigate();
    return (_jsx(MetadataEditorScreen, { api: api, itemId: required(itemId, 'itemId'), onBack: () => navigate(-1), onSaved: () => navigate(-1), onCleared: (item) => {
            const destination = item.kind === 'movie'
                ? routes.movies
                : (item.kind === 'show' || item.kind === 'season' || item.kind === 'episode')
                    ? routes.series
                    : routes.music;
            navigate(destination, { replace: true });
        } }));
}
export default function App({ platform, apiOverride, playbackOverride }) {
    useTvNavigation();
    const navigate = useNavigate();
    const location = useLocation();
    const [serverUrl, setServerUrl] = useState(() => getServerUrl());
    const [apiToken, setApiToken] = useState(() => getApiToken());
    const [connectionNotice, setConnectionNotice] = useState();
    const clientId = useMemo(() => getClientId(), []);
    const progressStore = useMemo(() => new ContinueWatchingStore(clientId), [clientId]);
    const queueStore = useMemo(() => new PlaybackQueueStore(clientId), [clientId]);
    const playlistStore = useMemo(() => new MusicPlaylistStore(clientId), [clientId]);
    const volumeStore = useMemo(() => new VolumeStore(clientId), [clientId]);
    const requestSequence = useRef(0);
    const restoredPersistedPlayback = useRef(false);
    const stoppingPlayback = useRef(false);
    const [queueState, setQueueState] = useState(() => queueStore.load());
    const [playlistEntries, setPlaylistEntries] = useState(() => playlistStore.load());
    const [volume, setVolume] = useState(() => platform.initialVolume?.() ?? volumeStore.load());
    const [activePlayback, setActivePlayback] = useState();
    const [continueWatching, setContinueWatching] = useState(() => (progressStore.list().filter((entry) => !needsEpisodeContextMigration(entry))));
    const demo = import.meta.env.VITE_DEMO === 'true';
    const catalogueApi = useMemo(() => new MachaCatalogueApi(serverUrl, apiToken), [apiToken, serverUrl]);
    const metadataEditingAvailable = !demo && !apiOverride;
    const api = useMemo(() => {
        if (apiOverride)
            return apiOverride;
        if (demo)
            return new MockMediaApi();
        return new MachaMediaApi(catalogueApi);
    }, [apiOverride, catalogueApi, demo]);
    const playbackResolver = useMemo(() => {
        if (playbackOverride)
            return playbackOverride;
        return demo ? new DemoPlaybackResolver() : new MachaPlaybackResolver(serverUrl, apiToken);
    }, [apiToken, demo, playbackOverride, serverUrl]);
    const serverApi = useMemo(() => (demo ? new DemoServerApi() : new MachaServerApi(serverUrl, apiToken)), [apiToken, demo, serverUrl]);
    const acquisitionApi = useMemo(() => (demo ? new DemoAcquisitionApi() : new MachaAcquisitionApi(serverUrl, apiToken)), [apiToken, demo, serverUrl]);
    useEffect(() => {
        const onServerUnreachable = (event) => {
            const detail = event.detail;
            setConnectionNotice(detail?.message ?? SERVER_UNREACHABLE_MESSAGE);
            if (location.pathname !== routes.settings)
                navigate(routes.settings, { replace: true });
        };
        window.addEventListener(SERVER_UNREACHABLE_EVENT, onServerUnreachable);
        return () => window.removeEventListener(SERVER_UNREACHABLE_EVENT, onServerUnreachable);
    }, [location.pathname, navigate]);
    useEffect(() => {
        let cancelled = false;
        const legacyEntries = progressStore.list().filter(needsEpisodeContextMigration);
        if (legacyEntries.length === 0)
            return undefined;
        void (async () => {
            const repaired = [];
            for (const entry of legacyEntries) {
                try {
                    repaired.push(await migrateEpisodeContext(api, entry));
                }
                catch (error) {
                    console.warn('[macha] unable to migrate legacy Continue Watching episode context', error);
                }
            }
            if (cancelled)
                return;
            let next = progressStore.list();
            for (const entry of repaired)
                next = progressStore.update(entry);
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
    const updateProgress = useCallback((progress) => {
        setContinueWatching(progressStore.update(progress));
    }, [progressStore]);
    const removeFromContinueWatching = useCallback((item) => {
        setContinueWatching(progressStore.clear(item.id));
    }, [progressStore]);
    const startPlayback = useCallback((item, options = {}) => {
        stoppingPlayback.current = false;
        const queue = options.queue?.length ? options.queue : [item];
        const requestedIndex = options.queueIndex ?? queue.findIndex((candidate) => candidate.id === item.id);
        const index = requestedIndex >= 0 ? requestedIndex : 0;
        const persistedQueue = queueStore.replace(queue, index);
        setQueueState(persistedQueue);
        const storedPosition = progressStore.list().find((entry) => entry.mediaId === item.id)?.positionMs ?? 0;
        const returnTo = playerRouteActive
            ? activePlayback?.returnTo ?? pathForMedia(item)
            : `${location.pathname}${location.search}`;
        const request = {
            media: item,
            startPositionMs: options.fromStart ? 0 : storedPosition,
            requestId: ++requestSequence.current,
            returnTo,
        };
        setActivePlayback(request);
        const state = {
            media: item,
            queue: persistedQueue.items,
            queueIndex: persistedQueue.currentIndex,
            returnTo,
        };
        navigate(options.fromStart ? routes.playerFromStart(item.id) : routes.player(item.id), { state });
    }, [activePlayback?.returnTo, location.pathname, location.search, navigate, playerRouteActive, progressStore, queueStore]);
    const open = useCallback((item) => navigate(pathForMedia(item)), [navigate]);
    const openPlayer = useCallback((item) => startPlayback(item), [startPlayback]);
    const openPlayerFromStart = useCallback((item) => startPlayback(item, { fromStart: true }), [startPlayback]);
    const openAlbumTrack = useCallback((track, queue, queueIndex) => {
        startPlayback(track, { queue, queueIndex });
    }, [startPlayback]);
    const musicTracksFor = useCallback(async (item) => {
        if (item.kind === 'track')
            return [item];
        if (item.kind !== 'album')
            return [];
        const details = await api.details(item.id);
        return details.kind === 'album' && 'tracks' in details ? details.tracks : [];
    }, [api]);
    const playMusicNow = useCallback((item) => {
        void musicTracksFor(item).then((tracks) => {
            const first = tracks[0];
            if (first)
                startPlayback(first, { queue: tracks, queueIndex: 0 });
        }).catch((error) => console.error('[macha] unable to start music playback', error));
    }, [musicTracksFor, startPlayback]);
    const addMusicToPlaylist = useCallback((item) => {
        void musicTracksFor(item).then((tracks) => {
            if (tracks.length > 0)
                setPlaylistEntries(playlistStore.add(tracks));
        }).catch((error) => console.error('[macha] unable to add music to playlist', error));
    }, [musicTracksFor, playlistStore]);
    const playAlbumAll = useCallback((item) => {
        void musicTracksFor(item).then((tracks) => {
            const first = tracks[0];
            if (!first)
                return;
            setPlaylistEntries(playlistStore.replace(tracks));
            startPlayback(first, { queue: tracks, queueIndex: 0 });
        }).catch((error) => console.error('[macha] unable to play album', error));
    }, [musicTracksFor, playlistStore, startPlayback]);
    const queueMusic = useCallback(async (item, placement) => {
        const tracks = await musicTracksFor(item);
        const first = tracks[0];
        if (!first)
            return;
        const current = queueStore.load();
        if (!activePlayback || !current) {
            startPlayback(first, { queue: tracks, queueIndex: 0 });
            return;
        }
        const nextQueue = placement === 'next' ? queueStore.insertNext(tracks) : queueStore.append(tracks);
        if (nextQueue)
            setQueueState(nextQueue);
    }, [activePlayback, musicTracksFor, queueStore, startPlayback]);
    const playMusicNext = useCallback((item) => {
        void queueMusic(item, 'next').catch((error) => console.error('[macha] unable to queue music next', error));
    }, [queueMusic]);
    const playMusicLater = useCallback((item) => {
        void queueMusic(item, 'later').catch((error) => console.error('[macha] unable to queue music later', error));
    }, [queueMusic]);
    const shuffleMusic = useCallback((item) => {
        void musicTracksFor(item).then((tracks) => {
            const queue = shuffled(tracks);
            const first = queue[0];
            if (first)
                startPlayback(first, { queue, queueIndex: 0 });
        }).catch((error) => console.error('[macha] unable to shuffle music', error));
    }, [musicTracksFor, startPlayback]);
    const playPlaylist = useCallback((shuffle = false, queueIndex = 0) => {
        const tracks = playlistEntries.map((entry) => entry.track);
        const queue = shuffle ? shuffled(tracks) : tracks;
        const boundedIndex = Math.max(0, Math.min(queue.length - 1, queueIndex));
        const first = queue[boundedIndex];
        if (!first)
            return;
        startPlayback(first, { queue, queueIndex: boundedIndex });
    }, [playlistEntries, startPlayback]);
    const removePlaylistEntry = useCallback((entryId) => {
        setPlaylistEntries(playlistStore.remove(entryId));
    }, [playlistStore]);
    const movePlaylistEntry = useCallback((entryId, toIndex) => {
        setPlaylistEntries(playlistStore.move(entryId, toIndex));
    }, [playlistStore]);
    const clearPlaylist = useCallback(() => {
        setPlaylistEntries(playlistStore.clear());
    }, [playlistStore]);
    const changeVolume = useCallback((nextVolume) => {
        setVolume(volumeStore.save(nextVolume));
    }, [volumeStore]);
    const openSeasonEpisode = useCallback((episode, queue, queueIndex, fromStart) => {
        startPlayback(episode, { queue, queueIndex, fromStart });
    }, [startPlayback]);
    // A /play URL is only a presentation request. If the application was
    // reloaded on that URL, reconstruct the playback request from route state,
    // the persisted queue, Continue Watching metadata, or finally the catalogue.
    useEffect(() => {
        if (stoppingPlayback.current)
            return undefined;
        if (!playerItemId || activePlayback?.media.id === playerItemId)
            return undefined;
        let cancelled = false;
        const routeState = location.state ?? undefined;
        const fromStart = /(?:^|[?&])start=0(?:&|$)/.test(location.search);
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
            if (!media && queueIndex >= 0)
                media = nextQueue?.items[queueIndex];
            if (!media)
                media = progressStore.list().find((entry) => entry.mediaId === playerItemId)?.media;
            if (!media)
                media = await api.details(playerItemId);
            if (cancelled)
                return;
            if (!nextQueue || queueIndex < 0) {
                nextQueue = queueStore.replace([media], 0);
                queueIndex = 0;
            }
            else if (queueIndex !== nextQueue.currentIndex) {
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
        if (restoredPersistedPlayback.current)
            return;
        restoredPersistedPlayback.current = true;
        if (playerRouteActive || activePlayback || !queueState)
            return;
        const media = queueState.items[queueState.currentIndex];
        if (!media)
            return;
        const storedPosition = progressStore.list().find((entry) => entry.mediaId === media.id)?.positionMs ?? 0;
        setActivePlayback({
            media,
            startPositionMs: Math.max(storedPosition, queueState.positionMs),
            requestId: ++requestSequence.current,
            returnTo: `${location.pathname}${location.search}`,
        });
    }, [activePlayback, location.pathname, location.search, playerRouteActive, progressStore, queueState]);
    const persistPlaybackPosition = useCallback((media, positionMs) => {
        const persisted = queueStore.load();
        if (persisted?.items[persisted.currentIndex]?.id !== media.id)
            return;
        queueStore.updatePosition(positionMs);
    }, [queueStore]);
    const selectQueueIndex = useCallback((nextIndex) => {
        if (!queueState || nextIndex < 0 || nextIndex >= queueState.items.length)
            return;
        const nextQueue = queueStore.select(nextIndex);
        if (!nextQueue)
            return;
        const media = nextQueue.items[nextIndex];
        setQueueState(nextQueue);
        setActivePlayback((current) => ({
            media,
            startPositionMs: 0,
            requestId: ++requestSequence.current,
            returnTo: current?.returnTo ?? currentBrowsePath,
        }));
        if (playerRouteActive) {
            const state = {
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
        if (queueState)
            selectQueueIndex(queueState.currentIndex - 1);
    }, [queueState, selectQueueIndex]);
    const next = useCallback(() => {
        if (queueState)
            selectQueueIndex(queueState.currentIndex + 1);
    }, [queueState, selectQueueIndex]);
    const handleEnded = useCallback(() => {
        if (queueState && queueState.currentIndex + 1 < queueState.items.length) {
            selectQueueIndex(queueState.currentIndex + 1);
            return;
        }
        queueStore.updatePosition(0);
    }, [queueState, queueStore, selectQueueIndex]);
    const minimizePlayer = useCallback(() => {
        if (!activePlayback)
            return;
        navigate(activePlayback.returnTo || pathForMedia(activePlayback.media), { replace: true });
    }, [activePlayback, navigate]);
    const expandPlayer = useCallback(() => {
        if (!activePlayback)
            return;
        const returnTo = playerRouteActive ? activePlayback.returnTo : `${location.pathname}${location.search}`;
        setActivePlayback((current) => current ? { ...current, returnTo } : current);
        const state = {
            media: activePlayback.media,
            queue: queueState?.items,
            queueIndex: queueState?.currentIndex,
            returnTo,
        };
        navigate(routes.player(activePlayback.media.id), { state });
    }, [activePlayback, location.pathname, location.search, navigate, playerRouteActive, queueState]);
    const stopPlayback = useCallback(() => {
        const returnTo = activePlayback?.returnTo ?? routes.home;
        // Clearing activePlayback while /play/... is still current would otherwise
        // trigger the route restoration effect, which can resurrect the just-closed
        // session from route state and leave it running as the mini-player.
        stoppingPlayback.current = true;
        if (playerRouteActive)
            navigate(returnTo, { replace: true });
        setActivePlayback(undefined);
        setQueueState(undefined);
        queueStore.clear();
    }, [activePlayback?.returnTo, navigate, playerRouteActive, queueStore]);
    useEffect(() => {
        if (!playerRouteActive)
            stoppingPlayback.current = false;
    }, [playerRouteActive]);
    const saveServer = useCallback((url, token) => {
        setConnectionNotice(undefined);
        persistServerUrl(url);
        persistApiToken(token);
        setServerUrl(url.trim().replace(/\/+$/, ''));
        setApiToken(token.trim());
        navigate(routes.home, { replace: true });
    }, [navigate]);
    const openMetadataEditor = useCallback((id) => {
        navigate(routes.edit(id));
    }, [navigate]);
    const miniPlayerActive = Boolean(activePlayback && !playerRouteActive);
    return (_jsxs("div", { className: `app-shell${miniPlayerActive ? ' has-mini-player' : ''}`, children: [!playerRouteActive && _jsx("img", { className: "app-watermark", src: logoUrl, alt: "", "aria-hidden": "true" }), _jsxs("header", { className: "topbar", children: [_jsxs(NavLink, { to: routes.home, className: "brand-link", "aria-label": "Macha home", children: [_jsx(AppLogo, {}), _jsx("span", { className: "brand-name", children: "Macha" })] }), _jsx("nav", { "aria-label": "Main navigation", children: navItems.map((item) => (_jsx(NavLink, { to: item.to, end: item.end, "data-tv-focusable": "true", className: ({ isActive }) => isActive ? 'active' : undefined, children: item.label }, item.to))) }), _jsx("div", { className: "platform-badge", children: import.meta.env.MODE === 'samsung' ? 'SAMSUNG TV' : platform.name.toUpperCase() })] }), _jsx("main", { children: _jsxs(Routes, { children: [_jsx(Route, { path: routes.home, element: _jsx(HomeScreen, { api: api, continueWatching: continueWatching, onOpen: open, onResume: openPlayer, onRemoveFromContinueWatching: removeFromContinueWatching }) }), _jsx(Route, { path: routes.movies, element: _jsx(LibraryScreen, { api: api, kind: "movies", onOpen: open }) }), _jsx(Route, { path: "/movies/:movieId", element: _jsx(DetailRoute, { api: api, onPlay: openPlayer, onPlayFromStart: openPlayerFromStart, progressById: progressById, parameter: "movieId", onEdit: metadataEditingAvailable ? openMetadataEditor : undefined }) }), _jsx(Route, { path: routes.series, element: _jsx(LibraryScreen, { api: api, kind: "shows", onOpen: open }) }), _jsx(Route, { path: "/series/:seriesId", element: _jsx(SeriesRoute, { api: api, onOpenSeason: open, onEdit: metadataEditingAvailable ? openMetadataEditor : undefined }) }), _jsx(Route, { path: "/series/:seriesId/seasons/:seasonId", element: _jsx(SeasonRoute, { api: api, progress: progressById, onPlayEpisode: openSeasonEpisode, onEdit: metadataEditingAvailable ? openMetadataEditor : undefined }) }), _jsx(Route, { path: "/episodes/:episodeId", element: _jsx(DetailRoute, { api: api, onPlay: openPlayer, onPlayFromStart: openPlayerFromStart, progressById: progressById, parameter: "episodeId", onEdit: metadataEditingAvailable ? openMetadataEditor : undefined }) }), _jsx(Route, { path: routes.music, element: _jsx(Navigate, { to: routes.musicArtists, replace: true }) }), _jsx(Route, { path: routes.musicArtists, element: _jsx(MusicScreen, { api: api, section: "artists", onOpen: open, onPlayNow: playMusicNow, onAddToPlaylist: addMusicToPlaylist, onPlayNext: playMusicNext, onPlayLater: playMusicLater, onShuffle: shuffleMusic }) }), _jsx(Route, { path: routes.musicAlbums, element: _jsx(MusicScreen, { api: api, section: "albums", onOpen: open, onPlayNow: playMusicNow, onAddToPlaylist: addMusicToPlaylist, onPlayNext: playMusicNext, onPlayLater: playMusicLater, onShuffle: shuffleMusic }) }), _jsx(Route, { path: routes.musicTracks, element: _jsx(MusicScreen, { api: api, section: "tracks", onOpen: open, onPlayNow: playMusicNow, onAddToPlaylist: addMusicToPlaylist, onPlayNext: playMusicNext, onPlayLater: playMusicLater, onShuffle: shuffleMusic }) }), _jsx(Route, { path: routes.musicPlaylist, element: _jsx(MusicPlaylistScreen, { api: api, entries: playlistEntries, onPlay: (index) => playPlaylist(false, index), onShuffle: () => playPlaylist(true), onRemove: removePlaylistEntry, onMove: movePlaylistEntry, onClear: clearPlaylist }) }), _jsx(Route, { path: "/music/artists/:artistId", element: _jsx(ArtistRoute, { api: api, onOpenAlbum: open, onAddToPlaylist: addMusicToPlaylist, onPlayNext: playMusicNext, onPlayLater: playMusicLater, onShuffle: shuffleMusic, onEdit: metadataEditingAvailable ? openMetadataEditor : undefined }) }), _jsx(Route, { path: "/music/albums/:albumId", element: _jsx(AlbumRoute, { api: api, onPlay: openAlbumTrack, onPlayAll: playAlbumAll, onOpenTrack: open, onAddToPlaylist: addMusicToPlaylist, onPlayNext: playMusicNext, onPlayLater: playMusicLater, onShuffle: shuffleMusic, onEdit: metadataEditingAvailable ? openMetadataEditor : undefined }) }), _jsx(Route, { path: "/music/tracks/:trackId", element: _jsx(DetailRoute, { api: api, onPlay: openPlayer, onPlayFromStart: openPlayerFromStart, progressById: progressById, parameter: "trackId", onEdit: metadataEditingAvailable ? openMetadataEditor : undefined }) }), _jsx(Route, { path: "/play/:itemId", element: _jsx("div", { className: "player-route-placeholder", "aria-hidden": "true" }) }), _jsx(Route, { path: "/items/:itemId", element: _jsx(DetailRoute, { api: api, onPlay: openPlayer, onPlayFromStart: openPlayerFromStart, progressById: progressById, parameter: "itemId", onEdit: metadataEditingAvailable ? openMetadataEditor : undefined }) }), _jsx(Route, { path: "/items/:itemId/edit", element: metadataEditingAvailable ? _jsx(MetadataEditorRoute, { api: catalogueApi }) : _jsx(Navigate, { to: routes.home, replace: true }) }), _jsx(Route, { path: routes.search, element: _jsx(SearchScreen, { api: api, onOpen: open }) }), _jsx(Route, { path: routes.ingest, element: _jsx(IngestScreen, { api: acquisitionApi }) }), _jsx(Route, { path: routes.settings, element: _jsx(SettingsScreen, { api: api, serverApi: serverApi, serverUrl: serverUrl, apiToken: apiToken, connectionNotice: connectionNotice, onSave: saveServer }) }), _jsx(Route, { path: routes.sponsor, element: _jsx(SponsorScreen, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: routes.home, replace: true }) })] }) }), activePlayback && (_jsx(PlayerHost, { api: api, request: activePlayback, platform: platform, playbackResolver: playbackResolver, presentation: playerRouteActive ? 'full' : 'mini', onProgress: updateProgress, onPosition: persistPlaybackPosition, onMinimize: minimizePlayer, onExpand: expandPlayer, onStop: stopPlayback, onPrevious: previous, onNext: next, onEnded: handleEnded, canPrevious: canPrevious, canNext: canNext, queuePosition: queueState ? { index: queueState.currentIndex, total: queueState.items.length } : undefined, volume: volume, onVolumeChange: changeVolume }))] }));
}
