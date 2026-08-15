import type { MediaApi } from '../api/MediaApi';
import type { MediaSummary } from '../types';
import { useAsync } from '../hooks/useAsync';
import { ErrorMessage, Loading } from '../components/Status';
import { MediaCard } from '../components/MediaCard';

interface Props {
  api: MediaApi;
  kind: 'movies' | 'shows';
  onOpen: (item: MediaSummary) => void;
}

export function LibraryScreen({ api, kind, onOpen }: Props) {
  const result = useAsync(() => kind === 'movies' ? api.movies() : api.shows(), [api, kind]);
  if (result.loading) return <Loading />;
  if (result.error) return <ErrorMessage error={result.error} />;

  return (
    <section>
      <h1>{kind === 'movies' ? 'Movies' : 'TV Shows'}</h1>
      <div className="media-grid">
        {(result.value ?? []).map((item) => <MediaCard key={item.id} api={api} item={item} onOpen={onOpen} />)}
      </div>
    </section>
  );
}
