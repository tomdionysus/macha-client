import { useMemo } from 'react';
import { DemoAcquisitionApi, MachaAcquisitionApi } from '../api/MachaAcquisitionApi';
import type { CatalogueApi } from '../api/CatalogueApi';
import { DemoClusterStatusApi, type ClusterStatusApi } from '../api/ClusterStatusApi';
import { ClusterStatusRouter } from '../api/ClusterStatusRouter';
import { ClusterCatalogueApi } from '../api/ClusterCatalogueApi';
import { MachaManageApi } from '../api/MachaManageApi';
import { MachaMediaApi } from '../api/MachaMediaApi';
import type { MediaApi } from '../api/MediaApi';
import { MockMediaApi } from '../api/MockMediaApi';
import { DemoServerApi, type ServerApi } from '../api/MachaServerApi';
import { ClusterServerApi } from '../api/ClusterServerApi';
import { DemoPlaybackResolver } from '../playback/DemoPlaybackResolver';
import { ClusterPlaybackResolver } from '../playback/ClusterPlaybackResolver';
import type { PlaybackResolver } from '../playback/PlaybackResolver';
import { bootstrapEndpoints, EndpointRegistry } from '../cluster/EndpointRegistry';

export interface MachaServices {
  catalogueApi: CatalogueApi;
  manageApi: MachaManageApi;
  mediaApi: MediaApi;
  playbackResolver: PlaybackResolver;
  serverApi: ServerApi;
  clusterStatusApi: ClusterStatusApi;
  acquisitionApi: DemoAcquisitionApi | MachaAcquisitionApi;
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
  const { serverUrl, bootstrapEndpoints: bootstrapUrls, apiToken, demo, apiOverride, playbackOverride } = options;
  const endpointKey = bootstrapUrls.join('\n');
  const endpointRegistry = useMemo(
    () => new EndpointRegistry(bootstrapEndpoints(bootstrapUrls)),
    [endpointKey],
  );
  const catalogueApi = useMemo(
    () => new ClusterCatalogueApi(endpointRegistry, apiToken),
    [apiToken, endpointRegistry],
  );
  const manageApi = useMemo(() => new MachaManageApi(serverUrl, apiToken), [apiToken, serverUrl]);
  const mediaApi = useMemo<MediaApi>(() => {
    if (apiOverride) return apiOverride;
    return demo ? new MockMediaApi() : new MachaMediaApi(catalogueApi);
  }, [apiOverride, catalogueApi, demo]);
  const playbackResolver = useMemo<PlaybackResolver>(() => {
    if (playbackOverride) return playbackOverride;
    if (demo) return new DemoPlaybackResolver();
    return new ClusterPlaybackResolver(endpointRegistry, apiToken);
  }, [apiToken, demo, endpointRegistry, playbackOverride]);
  const serverApi = useMemo<ServerApi>(
    () => demo ? new DemoServerApi() : new ClusterServerApi(endpointRegistry, apiToken),
    [apiToken, demo, endpointRegistry],
  );
  const clusterStatusApi = useMemo<ClusterStatusApi>(
    () => demo ? new DemoClusterStatusApi() : new ClusterStatusRouter(endpointRegistry, apiToken),
    [apiToken, demo, endpointRegistry],
  );
  const acquisitionApi = useMemo(
    () => demo ? new DemoAcquisitionApi() : new MachaAcquisitionApi(serverUrl, apiToken),
    [apiToken, demo, serverUrl],
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
