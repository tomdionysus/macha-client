import { useMemo } from 'react';
import type { MediaApi } from '../api/MediaApi';
import { AlphabetIndex } from '../components/AlphabetIndex';
import { MediaCard, type MediaCardAction } from '../components/MediaCard';
import { MusicNav } from '../components/MusicNav';
import { ErrorMessage, Loading } from '../components/Status';
import { useAlphabetIndex } from '../hooks/useAlphabetIndex';
import { useAsync } from '../hooks/useAsync';
import { sortMediaByIndexedTitle } from '../titleIndex';
import type { MediaSummary } from '../types';

export type MusicSection = 'artists' | 'albums' | 'tracks';

interface Props {
  api: MediaApi;
  section: MusicSection;
  onOpen: (item: MediaSummary) => void;
  onPlayNow: (item: MediaSummary) => void;
  onAddToPlaylist: (item: MediaSummary) => void;
  onPlayNext: (item: MediaSummary) => void;
  onPlayLater: (item: MediaSummary) => void;
  onShuffle: (item: MediaSummary) => void;
}

function titleFor(section: MusicSection): string {
  if (section === 'artists') return 'Artists';
  if (section === 'albums') return 'Albums';
  return 'Tracks';
}

export function MusicScreen({ api, section, onOpen, onPlayNow, onAddToPlaylist, onPlayNext, onPlayLater, onShuffle }: Props) {
  const result = useAsync(() => {
    if (section === 'artists') return api.artists();
    if (section === 'albums') return api.albums();
    return api.tracks();
  }, [api, section]);
  const items = useMemo(() => sortMediaByIndexedTitle(result.value ?? []), [result.value]);
  const alphabet = useAlphabetIndex(items);

  if (result.loading) return <Loading />;
  if (result.error) return <ErrorMessage error={result.error} />;

  const actions: MediaCardAction[] = section === 'artists' ? [] : [
    { label: section === 'albums' ? 'Add album to playlist' : 'Add track to playlist', onSelect: onAddToPlaylist },
    ...(section === 'albums' ? [{ label: 'Shuffle', onSelect: onShuffle }] : []),
    { label: 'Play next', onSelect: onPlayNext },
    { label: 'Play later', onSelect: onPlayLater },
    { label: section === 'albums' ? 'View album' : 'View track', onSelect: onOpen },
  ];

  return (
    <section className="catalogue-indexed music-browser">
      <h1>Music</h1>
      <MusicNav />
      <h2 className="music-browser-heading">{titleFor(section)}</h2>
      <div className="media-grid">
        {items.map((item) => (
          <MediaCard
            key={item.id}
            api={api}
            item={item}
            onOpen={section === 'tracks' ? onPlayNow : onOpen}
            actions={actions}
            elementRef={(element) => alphabet.registerItem(item.id, element)}
          />
        ))}
      </div>
      <AlphabetIndex availableKeys={alphabet.availableKeys} onSelect={alphabet.jumpTo} />
    </section>
  );
}
