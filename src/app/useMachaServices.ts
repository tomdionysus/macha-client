import { useMemo } from 'react';
import { createMachaServices, type MachaServices, type MachaServicesOptions } from '@macha/core';

/**
 * Memoizes the core's service factory for React.
 *
 * Every service authenticates through `auth` at request time, so a session
 * refresh is never a reason to rebuild them — rebuilding would orphan an
 * active playback generation's node ownership. They only need rebuilding when
 * routing itself changes, hence the two dependencies and no more.
 */
export function useMachaServices(options: MachaServicesOptions): MachaServices {
  const { endpointRegistry, auth, apiOverride, playbackOverride } = options;
  return useMemo(
    () => createMachaServices({ endpointRegistry, auth, apiOverride, playbackOverride }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the docblock:
    // overrides are test seams and must not retrigger construction.
    [endpointRegistry, auth],
  );
}
