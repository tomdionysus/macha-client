import { useMemo } from 'react';
import { DemoAcquisitionApi } from '../api/MachaAcquisitionApi';
import { ClusterAcquisitionApi } from '../api/ClusterAcquisitionApi';
import type { AcquisitionApi } from '../api/AcquisitionApi';
import type { CatalogueApi } from '../api/CatalogueApi';
import { DemoClusterStatusApi, type ClusterStatusApi } from '../api/ClusterStatusApi';
import { ClusterStatusRouter } from '../api/ClusterStatusRouter';
import { ClusterCatalogueApi } from '../api/ClusterCatalogueApi';
import { ClusterManageApi } from '../api/ClusterManageApi';
import type { ManageApi } from '../api/ManageApi';
import { MachaMediaApi } from '../api/MachaMediaApi';
import type { MediaApi } from '../api/MediaApi';
import { MockMediaApi } from '../api/MockMediaApi';
import { DemoServerApi, type ServerApi } from '../api/MachaServerApi';
import { ClusterServerApi } from '../api/ClusterServerApi';
import { DemoPlaybackResolver } from '../playback/DemoPlaybackResolver';
import { ClusterPlaybackResolver } from '../playback/ClusterPlaybackResolver';
import type { PlaybackResolver } from '../playback/PlaybackResolver';
import { bootstrapEndpoints, EndpointRegistry } from '../cluster/EndpointRegistry';
import { ClusterEndpointRouter } from '../cluster/endpointRouting';
import type { SessionTokenStore } from '../api/SessionTokenStore';

export interface MachaServices {
  catalogueApi: CatalogueApi;
  manageApi: ManageApi;
  mediaApi: MediaApi;
  playbackResolver: PlaybackResolver;
  serverApi: ServerApi;
  clusterStatusApi: ClusterStatusApi;
  acquisitionApi: AcquisitionApi;
  managementAvailable: boolean;
  /** Shared, client-owned API endpoint evidence for routing and diagnostics. */
  endpointRegistry: EndpointRegistry;
}

export function useMachaServices(options: {
  serverUrl: string;
  bootstrapEndpoints: readonly string[];
  tokenStore: SessionTokenStore;
  demo: boolean;
  apiOverride?: MediaApi;
  playbackOverride?: PlaybackResolver;
}): MachaServices {
  const { bootstrapEndpoints: bootstrapUrls, tokenStore, demo, apiOverride, playbackOverride } = options;
  const endpointKey = bootstrapUrls.join('\n');
  const endpointRegistry = useMemo(
    () => new EndpointRegistry(bootstrapEndpoints(bootstrapUrls)),
    [endpointKey],
  );
  const endpointRouter = useMemo(() => new ClusterEndpointRouter(endpointRegistry), [endpointRegistry]);
  // Every service below reads the token live off `tokenStore` at request
  // time, so a session refresh (expiry, 401) is never a reason to recreate
  // these — recreating them would orphan an active playback generation's
  // node ownership. They only need rebuilding when routing itself changes.
  const catalogueApi = useMemo(
    () => new ClusterCatalogueApi(endpointRouter, tokenStore),
    [endpointRouter, tokenStore],
  );
  const manageApi = useMemo<ManageApi>(() => new ClusterManageApi(endpointRouter, tokenStore), [endpointRouter, tokenStore]);
  const mediaApi = useMemo<MediaApi>(() => {
    if (apiOverride) return apiOverride;
    return demo ? new MockMediaApi() : new MachaMediaApi(catalogueApi);
  }, [apiOverride, catalogueApi, demo]);
  const playbackResolver = useMemo<PlaybackResolver>(() => {
    if (playbackOverride) return playbackOverride;
    if (demo) return new DemoPlaybackResolver();
    return new ClusterPlaybackResolver(endpointRouter, tokenStore);
  }, [demo, endpointRouter, playbackOverride, tokenStore]);
  const serverApi = useMemo<ServerApi>(
    () => demo ? new DemoServerApi() : new ClusterServerApi(endpointRouter, tokenStore),
    [demo, endpointRouter, tokenStore],
  );
  const clusterStatusApi = useMemo<ClusterStatusApi>(
    () => demo ? new DemoClusterStatusApi() : new ClusterStatusRouter(endpointRouter, tokenStore),
    [demo, endpointRouter, tokenStore],
  );
  const acquisitionApi = useMemo(
    () => demo ? new DemoAcquisitionApi() : new ClusterAcquisitionApi(endpointRouter, tokenStore),
    [demo, endpointRouter, tokenStore],
  );

  return {
    catalogueApi,
    manageApi,
    mediaApi,
    playbackResolver,
    serverApi,
    clusterStatusApi,
    acquisitionApi,
    managementAvailable: !demo && !apiOverride,
    endpointRegistry,
  };
}
