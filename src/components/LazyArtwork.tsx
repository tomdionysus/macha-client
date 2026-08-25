import type { ReactNode } from 'react';
import type { MediaApi } from '../api/MediaApi';
import { useArtworkVisibility, useLazyArtworkUrl } from '../hooks/useLazyArtworkUrl';
import type { ArtworkRef } from '../types';

interface Props {
  api: MediaApi;
  artwork?: ArtworkRef;
  alt?: string;
  placeholder: ReactNode;
  draggable?: boolean;
  eager?: boolean;
}

export function LazyArtwork({ api, artwork, alt = '', placeholder, draggable, eager = false }: Props) {
  const visibility = useArtworkVisibility(eager);
  const image = useLazyArtworkUrl(
    api,
    artwork,
    eager || visibility.nearby,
    eager || visibility.visible,
  );

  return (
    <span ref={visibility.ref} className="lazy-artwork">
      {image
        ? <img src={image} alt={alt} decoding="async" draggable={draggable} />
        : placeholder}
    </span>
  );
}
