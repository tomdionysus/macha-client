import { useEffect, useMemo, useState } from 'react';
import type { Platform } from '@machafoundation/core';
import type { PlaybackResolver } from '@machafoundation/core';
import { PlaybackRuntime, type PlaybackRuntimeOptions } from '@machafoundation/core';
import { platformTraits } from '../platform/traits';

export function usePlaybackRuntime(platform: Platform, resolver: PlaybackResolver, options?: PlaybackRuntimeOptions) {
  // Keyed by platform only: resolver changes are applied in place, and `options` is read once.
  const runtime = useMemo(() => new PlaybackRuntime(platform, resolver, options), [platform]);
  const [state, setState] = useState(() => runtime.getSnapshot());

  useEffect(() => runtime.subscribeLifecycle(setState), [runtime]);
  useEffect(() => { runtime.setResolver(resolver); }, [resolver, runtime]);
  useEffect(() => () => { void runtime.dispose(); }, [runtime]);
  useEffect(() => {
    // Every pagehide, including into the back-forward cache: a cached page keeps its
    // node session and transcode slot, with no event on eviction. A restored page
    // restarts playback from its player route.
    const onPageHide = () => runtime.terminateForPageExit();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [runtime]);

  // A TV or app host suspends without firing `pagehide`, so `visibilitychange` ends
  // the session there. Not on the web, where a backgrounded tab is still playing.
  const suspendEndsPlayback = !platformTraits(platform).hasPointerControls;
  useEffect(() => {
    if (!suspendEndsPlayback) return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') runtime.terminateForPageExit();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [runtime, suspendEndsPlayback]);

  return { runtime, state };
}
