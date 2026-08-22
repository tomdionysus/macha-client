import { jsx as _jsx } from "react/jsx-runtime";
import { useArtworkVisibility, useLazyArtworkUrl } from '../hooks/useLazyArtworkUrl';
export function LazyArtwork({ api, artwork, alt = '', placeholder, draggable, eager = false }) {
    const visibility = useArtworkVisibility(eager);
    const image = useLazyArtworkUrl(api, artwork, eager || visibility.nearby, eager || visibility.visible);
    return (_jsx("span", { ref: visibility.ref, className: "lazy-artwork", children: image
            ? _jsx("img", { src: image, alt: alt, loading: eager ? 'eager' : 'lazy', decoding: "async", draggable: draggable })
            : placeholder }));
}
