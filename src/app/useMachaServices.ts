import { useMemo } from 'react';
import { createMachaServices, type MachaServices, type MachaServicesOptions } from '@machafoundation/core';

/**
 * Services authenticate through `auth` per request, so only a routing change rebuilds them;
 * rebuilding orphans an active playback generation's node ownership.
 */
export function useMachaServices(options: MachaServicesOptions): MachaServices {
  const { endpointRegistry, auth, apiOverride, playbackOverride } = options;
  return useMemo(
    () => createMachaServices({ endpointRegistry, auth, apiOverride, playbackOverride }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the overrides are test seams
    [endpointRegistry, auth],
  );
}
