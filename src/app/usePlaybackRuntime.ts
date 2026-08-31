import { useEffect, useMemo, useState } from 'react';
import type { Platform } from '../platform/Platform';
import type { PlaybackResolver } from '../playback/PlaybackResolver';
import { PlaybackRuntime } from '../playback/PlaybackRuntime';

export function usePlaybackRuntime(platform: Platform, resolver: PlaybackResolver) {
  // The runtime is keyed only by platform. Resolver changes are applied without
  // replacing the application-scoped player or an unrelated presentation host.
  const runtime = useMemo(() => new PlaybackRuntime(platform, resolver), [platform]);
  const [state, setState] = useState(() => runtime.getSnapshot());

  useEffect(() => runtime.subscribeLifecycle(setState), [runtime]);
  useEffect(() => { runtime.setResolver(resolver); }, [resolver, runtime]);
  useEffect(() => () => { void runtime.dispose(); }, [runtime]);
  useEffect(() => {
    const onPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) runtime.terminateForPageExit();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [runtime]);

  return { runtime, state };
}
