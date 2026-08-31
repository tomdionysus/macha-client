import { useEffect, useState, type ReactNode } from 'react';
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
  const [decodeFailures, setDecodeFailures] = useState(0);
  const image = useViewportArtworkUrl(api, artwork, element, eager, decodeFailures);

  useEffect(() => setDecodeFailures(0), [api, artwork?.id]);

  const handleImageError = () => {
    if (!artwork) return;
    if (decodeFailures >= 2) {
      setDecodeFailures(3);
      return;
    }
    api.invalidateArtwork?.(artwork);
    setDecodeFailures((failures) => failures + 1);
  };

  return (
    <span ref={setElement} className="lazy-artwork">
      {image && decodeFailures < 3
        ? <img src={image} alt={alt} decoding="async" draggable={draggable} onError={handleImageError} />
        : placeholder}
    </span>
  );
}
