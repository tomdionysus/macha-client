import type { MediaApi } from '../api/MediaApi';
import type { MediaSummary, PlaybackProgress } from '../types';
import { useAsync } from '../hooks/useAsync';
import { ErrorMessage, Loading } from '../components/Status';
import { MediaRow } from '../components/MediaRow';
import { newestCatalogueFirst } from '../recentMedia';

interface Props {
  api: MediaApi;
  continueWatching: PlaybackProgress[];
  onOpen: (item: MediaSummary) => void;
  onResume: (item: MediaSummary) => void;
  onRemoveFromContinueWatching: (item: MediaSummary) => void;
}

export function HomeScreen({ api, continueWatching, onOpen, onResume, onRemoveFromContinueWatching }: Props) {
  const home = useAsync(() => api.home(), [api]);
  if (home.loading) return <Loading />;
  if (home.error) return <ErrorMessage error={home.error} />;
  if (!home.value) return null;

  const progressItems = continueWatching.flatMap((entry) => entry.media ? [entry.media] : []);
  const progressMap = new Map(continueWatching.map((entry) => [entry.mediaId, entry]));
  const recentMovies = newestCatalogueFirst(home.value.movies).slice(0, 14);
  const recentShows = newestCatalogueFirst(home.value.shows).slice(0, 14);
  const recentAlbums = newestCatalogueFirst(home.value.albums).slice(0, 14);

  return (
    <>
      <MediaRow api={api} title="Continue Watching" items={progressItems} onOpen={onResume} onRemoveFromContinueWatching={onRemoveFromContinueWatching} progress={progressMap} variant="continue-watching" />
      <MediaRow api={api} title="Movies" items={recentMovies} onOpen={onOpen} />
      <MediaRow api={api} title="TV Shows" items={recentShows} onOpen={onOpen} />
      <MediaRow api={api} title="Music" items={recentAlbums} onOpen={onOpen} />
    </>
  );
}
