import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { MediaApi } from '@machafoundation/core';
import { samsungBackTarget } from '../platform/samsungBackNavigation';
import { buildPlatformTraits } from '../platform/traits';

export function useMediaRouteBack(api: MediaApi, webFallback?: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (!buildPlatformTraits.receivesBackKeyEvents) {
      if (webFallback) navigate(webFallback);
      else navigate(-1);
      return;
    }
    void samsungBackTarget(location.pathname, api).then((target) => { if (target) navigate(target); });
  }, [api, location.pathname, navigate, webFallback]);
}
