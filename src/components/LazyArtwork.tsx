import { useState, type ReactNode } from 'react';
import type { MediaApi } from '../api/MediaApi';
import { useViewportArtworkUrl } from '../hooks/useViewportArtworkUrl';
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
  const [element, setElement] = useState<HTMLSpanElement | null>(null);
  const image = useViewportArtworkUrl(api, artwork, element, eager);

  return (
    <span ref={setElement} className="lazy-artwork">
      {image
        ? <img src={image} alt={alt} decoding="async" draggable={draggable} />
        : placeholder}
    </span>
  );
}
