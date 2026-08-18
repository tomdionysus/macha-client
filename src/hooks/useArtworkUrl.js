import { useEffect, useState } from 'react';
import { fetchArtworkWithRetry } from './artworkRetry';
export function useArtworkUrl(api, ref) {
    const [url, setUrl] = useState();
    useEffect(() => {
        let active = true;
        let objectUrl;
        const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
        setUrl(undefined);
        if (!ref)
            return;
        void fetchArtworkWithRetry(() => api.artwork(ref), controller?.signal).then((blob) => {
            if (!active)
                return;
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
        }).catch(() => {
            if (active)
                setUrl(undefined);
        });
        return () => {
            active = false;
            controller?.abort();
            if (objectUrl)
                URL.revokeObjectURL(objectUrl);
        };
    }, [api, ref?.id]);
    return url;
}
