import type { MediaApi } from '../api/MediaApi';
import type { MediaSummary, PlaybackProgress } from '../types';
import { useAsync } from '../hooks/useAsync';
import { ErrorMessage, Loading } from '../components/Status';
import { MediaRow } from '../components/MediaRow';

interface Props {
  api: MediaApi;
  continueWatching: PlaybackProgress[];
  onOpen: (item: MediaSummary) => void;
  onResume: (item: MediaSummary) => void;
}

export function HomeScreen({ api, continueWatching, onOpen, onResume }: Props) {
  const home = useAsync(() => api.home(), [api]);
  if (home.loading) return <Loading />;
  if (home.error) return <ErrorMessage error={home.error} />;
  if (!home.value) return null;

  const progressItems = continueWatching.flatMap((entry) => entry.media ? [entry.media] : []);
  const progressMap = new Map(continueWatching.map((entry) => [entry.mediaId, entry]));

  return (
    <>
      <MediaRow api={api} title="Continue Watching" items={progressItems} onOpen={onResume} progress={progressMap} variant="continue-watching" />
      <MediaRow api={api} title="Movies" items={home.value.movies.slice(0, 14)} onOpen={onOpen} />
      <MediaRow api={api} title="TV Shows" items={home.value.shows.slice(0, 14)} onOpen={onOpen} />
      <MediaRow api={api} title="Music" items={home.value.albums.slice(0, 14)} onOpen={onOpen} />
    </>
  );
}
