import type { ReactNode } from 'react';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { buildPlatformTraits } from '../platform/traits';

/**
 * The router, configured the one way this application can tolerate.
 *
 * `useTransitions={false}` is the whole point of this component existing.
 * By default React Router publishes every location change inside
 * `React.startTransition`, which puts it in a lower-priority lane than an
 * ordinary `setState`. Anything this app changes *beside* a navigation — the
 * playback runtime's own lifecycle publication, above all — therefore commits
 * a render earlier, and for that render the route still describes where we
 * were. Presentation derived from the route is wrong in exactly that window:
 * the player is visible, `/play/:id` has not arrived, so the player mounts as
 * the mini bar and swaps to full once the transition lane commits. Measured at
 * around a tenth of a second on the television, which is long enough to read
 * as a flash of the wrong screen. Ordering the two calls does not help — lane
 * priority decides which commits first, not call order.
 *
 * Nothing here uses Suspense, lazy routes or view transitions, so the
 * transition lane buys this application nothing and costs it that.
 */
export function AppRouter({ children }: { children: ReactNode }) {
  const Router = buildPlatformTraits.usesHashRouting ? HashRouter : BrowserRouter;
  return <Router useTransitions={false}>{children}</Router>;
}
