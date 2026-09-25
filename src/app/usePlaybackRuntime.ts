import { useEffect, useMemo, useState } from 'react';
import type { Platform } from '@machafoundation/core';
import type { PlaybackResolver } from '@machafoundation/core';
import { PlaybackRuntime, type PlaybackRuntimeOptions } from '@machafoundation/core';
import { platformTraits } from '../platform/traits';

export function usePlaybackRuntime(platform: Platform, resolver: PlaybackResolver, options?: PlaybackRuntimeOptions) {
  // The runtime is keyed only by platform. Resolver changes are applied without
  // replacing the application-scoped player or an unrelated presentation host.
  // `options` supplies the facts and host policy the instruction chooser needs;
  // it is read once for the same reason, and its contents are stable.
  const runtime = useMemo(() => new PlaybackRuntime(platform, resolver, options), [platform]);
  const [state, setState] = useState(() => runtime.getSnapshot());

  useEffect(() => runtime.subscribeLifecycle(setState), [runtime]);
  useEffect(() => { runtime.setResolver(resolver); }, [resolver, runtime]);
  useEffect(() => () => { void runtime.dispose(); }, [runtime]);
  useEffect(() => {
    // Every pagehide, including one into the back-forward cache
    // (`persisted`). Chrome caches a playing page on an ordinary navigation,
    // and a cached page keeps its node session, and on a one-slot node the
    // only transcode slot, for as long as it stays cached, with no event when
    // it is evicted. Measured 2026-09-25: a navigation away from a 720p
    // transcode fired pagehide with persisted true, and fi-1 refused the next
    // viewer until its idle rule freed the slot. A page restored from the
    // cache finds no playback on its player route and starts it again from
    // the saved position, as a deep link does.
    const onPageHide = () => runtime.terminateForPageExit();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [runtime]);

  // A TV or app host suspends us without ever firing `pagehide`, so the
  // keepalive DELETE above never runs and the server keeps the session — which
  // on a node allowing one transcode at a time means the next viewer is
  // refused. `visibilitychange` is the one signal such a host reliably does
  // send. Deliberately not on the web, where a backgrounded tab is still
  // playing and stopping it would be wrong.
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
