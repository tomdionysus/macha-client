import { useCallback, useEffect, useRef, useState } from 'react';
import { ArtworkRequestScheduler } from './artworkScheduler';
import { observeArtworkVisibility } from './artworkVisibility';
import { fetchArtworkWithRetry } from './artworkRetry';
const schedulers = new WeakMap();
function schedulerFor(api) {
    let scheduler = schedulers.get(api);
    if (!scheduler) {
        scheduler = new ArtworkRequestScheduler(6);
        schedulers.set(api, scheduler);
    }
    return scheduler;
}
export function useArtworkVisibility(eager = false) {
    const [element, setElement] = useState(null);
    const [nearby, setNearby] = useState(eager);
    const [visible, setVisible] = useState(eager);
    const ref = useCallback((next) => setElement(next), []);
    useEffect(() => {
        if (eager) {
            setNearby(true);
            setVisible(true);
            return;
        }
        if (!element)
            return;
        if (typeof IntersectionObserver === 'undefined') {
            setNearby(true);
            setVisible(true);
            return;
        }
        return observeArtworkVisibility(element, setNearby, setVisible);
    }, [eager, element]);
    return { ref, nearby, visible };
}
export function useLazyArtworkUrl(api, ref, enabled, visible) {
    const [url, setUrl] = useState();
    const objectUrlRef = useRef(undefined);
    const handleRef = useRef(undefined);
    useEffect(() => {
        if (visible)
            handleRef.current?.promote();
    }, [visible]);
    useEffect(() => {
        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = undefined;
        }
        setUrl(undefined);
        if (!enabled || !ref)
            return;
        let active = true;
        const handle = schedulerFor(api).request(ref.id, () => fetchArtworkWithRetry(() => api.artwork(ref)), visible ? 'visible' : 'nearby');
        handleRef.current = handle;
        void handle.promise.then((blob) => {
            if (!active)
                return;
            const objectUrl = URL.createObjectURL(blob);
            objectUrlRef.current = objectUrl;
            setUrl(objectUrl);
        }).catch(() => {
            if (active)
                setUrl(undefined);
        });
        return () => {
            active = false;
            handle.cancel();
            if (handleRef.current === handle)
                handleRef.current = undefined;
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
                objectUrlRef.current = undefined;
            }
        };
    }, [api, enabled, ref?.id]);
    return url;
}
