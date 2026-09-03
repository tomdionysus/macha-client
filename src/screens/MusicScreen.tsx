import { useMemo } from 'react';
import type { MediaApi } from '../api/MediaApi';
import { AlphabetIndex } from '../components/AlphabetIndex';
import { MediaCard, type MediaCardAction } from '../components/MediaCard';
import { ErrorMessage, Loading } from '../components/Status';
import { useAlphabetIndex } from '../hooks/useAlphabetIndex';
import { useRefreshableAsync } from '../hooks/useRefreshableAsync';
import { sortMediaByIndexedTitle } from '../titleIndex';
import type { MediaSummary } from '../types';
import { MediaPageTitle } from '../components/MediaPageTitle';

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
  const result = useRefreshableAsync(() => {
    if (section === 'artists') return api.artists();
    if (section === 'albums') return api.albums();
    return api.tracks();
  }, [api, section]);
  const items = useMemo(() => sortMediaByIndexedTitle(result.value ?? []), [result.value]);
  const alphabet = useAlphabetIndex(items);

  if (!result.value) return <section className="catalogue-indexed music-browser">
    <MediaPageTitle refreshing={result.refreshing} onRefresh={result.refresh}>Music</MediaPageTitle>
    {result.loading ? <Loading /> : result.error ? <ErrorMessage error={result.error} /> : null}
  </section>;

  const actions: MediaCardAction[] = section === 'artists' ? [] : [
    { label: section === 'albums' ? 'Add album to playlist' : 'Add track to playlist', onSelect: onAddToPlaylist },
    ...(section === 'albums' ? [{ label: 'Shuffle', onSelect: onShuffle }] : []),
    { label: 'Play next', onSelect: onPlayNext },
    { label: 'Play later', onSelect: onPlayLater },
    { label: section === 'albums' ? 'View album' : 'View track', onSelect: onOpen },
  ];

  return (
    <section className="catalogue-indexed music-browser">
      <MediaPageTitle refreshing={result.refreshing} onRefresh={result.refresh}>Music</MediaPageTitle>
      {result.error && <p className="manage-error media-refresh-error">Refresh failed: {result.error.message}</p>}
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
