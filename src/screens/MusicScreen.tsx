import type { MediaApi } from '../api/MediaApi';
import { ErrorMessage, Loading } from '../components/Status';
import { MediaRow } from '../components/MediaRow';
import { useAsync } from '../hooks/useAsync';
import type { MediaSummary } from '../types';

interface Props {
  api: MediaApi;
  onOpen: (item: MediaSummary) => void;
}

export function MusicScreen({ api, onOpen }: Props) {
  const music = useAsync(async () => {
    const [artists, albums] = await Promise.all([api.artists(), api.albums()]);
    return { artists, albums };
  }, [api]);

  if (music.loading) return <Loading />;
  if (music.error) return <ErrorMessage error={music.error} />;
  if (!music.value) return null;

  return (
    <section>
      <h1>Music</h1>
      <MediaRow api={api} title="Artists" items={music.value.artists} onOpen={onOpen} />
      <MediaRow api={api} title="Albums" items={music.value.albums} onOpen={onOpen} />
    </section>
  );
}
