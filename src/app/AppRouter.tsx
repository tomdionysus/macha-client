import type { ReactNode } from 'react';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { buildPlatformTraits } from '../platform/traits';

/**
 * `useTransitions={false}` is required. React Router otherwise publishes
 * location changes in a transition lane, so state set beside a navigation (the
 * playback runtime's lifecycle) commits a render first, against the old route:
 * the player flashes as the mini bar before `/play/:id` arrives. Call order
 * cannot fix this; lane priority decides which commits first.
 */
export function AppRouter({ children }: { children: ReactNode }) {
  const Router = buildPlatformTraits.usesHashRouting ? HashRouter : BrowserRouter;
  return <Router useTransitions={false}>{children}</Router>;
}
