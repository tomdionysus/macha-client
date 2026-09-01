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
  apiToken: string;
  demo: boolean;
  apiOverride?: MediaApi;
  playbackOverride?: PlaybackResolver;
}): MachaServices {
  const { bootstrapEndpoints: bootstrapUrls, apiToken, demo, apiOverride, playbackOverride } = options;
  const endpointKey = bootstrapUrls.join('\n');
  const endpointRegistry = useMemo(
    () => new EndpointRegistry(bootstrapEndpoints(bootstrapUrls)),
    [endpointKey],
  );
  const endpointRouter = useMemo(() => new ClusterEndpointRouter(endpointRegistry), [endpointRegistry]);
  const catalogueApi = useMemo(
    () => new ClusterCatalogueApi(endpointRouter, apiToken),
    [apiToken, endpointRouter],
  );
  const manageApi = useMemo<ManageApi>(() => new ClusterManageApi(endpointRouter, apiToken), [apiToken, endpointRouter]);
  const mediaApi = useMemo<MediaApi>(() => {
    if (apiOverride) return apiOverride;
    return demo ? new MockMediaApi() : new MachaMediaApi(catalogueApi);
  }, [apiOverride, catalogueApi, demo]);
  const playbackResolver = useMemo<PlaybackResolver>(() => {
    if (playbackOverride) return playbackOverride;
    if (demo) return new DemoPlaybackResolver();
    return new ClusterPlaybackResolver(endpointRouter, apiToken);
  }, [apiToken, demo, endpointRouter, playbackOverride]);
  const serverApi = useMemo<ServerApi>(
    () => demo ? new DemoServerApi() : new ClusterServerApi(endpointRouter, apiToken),
    [apiToken, demo, endpointRouter],
  );
  const clusterStatusApi = useMemo<ClusterStatusApi>(
    () => demo ? new DemoClusterStatusApi() : new ClusterStatusRouter(endpointRouter, apiToken),
    [apiToken, demo, endpointRouter],
  );
  const acquisitionApi = useMemo(
    () => demo ? new DemoAcquisitionApi() : new ClusterAcquisitionApi(endpointRouter, apiToken),
    [apiToken, demo, endpointRouter],
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
