import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useAsync } from '../hooks/useAsync';
import { ErrorMessage, Loading } from '../components/Status';
import { MediaRow } from '../components/MediaRow';
import { newestCatalogueFirst } from '../recentMedia';
export function HomeScreen({ api, continueWatching, onOpen, onResume, onRemoveFromContinueWatching }) {
    const home = useAsync(() => api.home(), [api]);
    if (home.loading)
        return _jsx(Loading, {});
    if (home.error)
        return _jsx(ErrorMessage, { error: home.error });
    if (!home.value)
        return null;
    const progressItems = continueWatching.flatMap((entry) => entry.media ? [entry.media] : []);
    const progressMap = new Map(continueWatching.map((entry) => [entry.mediaId, entry]));
    const recentMovies = newestCatalogueFirst(home.value.movies).slice(0, 14);
    const recentShows = newestCatalogueFirst(home.value.shows).slice(0, 14);
    const recentAlbums = newestCatalogueFirst(home.value.albums).slice(0, 14);
    return (_jsxs(_Fragment, { children: [_jsx(MediaRow, { api: api, title: "Continue Watching", items: progressItems, onOpen: onResume, onRemoveFromContinueWatching: onRemoveFromContinueWatching, progress: progressMap, variant: "continue-watching" }), _jsx(MediaRow, { api: api, title: "Movies", items: recentMovies, onOpen: onOpen }), _jsx(MediaRow, { api: api, title: "TV Shows", items: recentShows, onOpen: onOpen }), _jsx(MediaRow, { api: api, title: "Music", items: recentAlbums, onOpen: onOpen })] }));
}
