import { useMemo } from 'react';
import { DemoAcquisitionApi, MachaAcquisitionApi } from '../api/MachaAcquisitionApi';
import type { CatalogueApi } from '../api/CatalogueApi';
import { DemoClusterStatusApi, MachaClusterStatusApi, type ClusterStatusApi } from '../api/ClusterStatusApi';
import { MachaCatalogueApi } from '../api/MachaCatalogueApi';
import { MachaManageApi } from '../api/MachaManageApi';
import { MachaMediaApi } from '../api/MachaMediaApi';
import type { MediaApi } from '../api/MediaApi';
import { MockMediaApi } from '../api/MockMediaApi';
import { DemoServerApi, MachaServerApi, type ServerApi } from '../api/MachaServerApi';
import { DemoPlaybackResolver } from '../playback/DemoPlaybackResolver';
import { MachaPlaybackResolver } from '../playback/MachaPlaybackResolver';
import type { PlaybackResolver } from '../playback/PlaybackResolver';

export interface MachaServices {
  catalogueApi: CatalogueApi;
  manageApi: MachaManageApi;
  mediaApi: MediaApi;
  playbackResolver: PlaybackResolver;
  serverApi: ServerApi;
  clusterStatusApi: ClusterStatusApi;
  acquisitionApi: DemoAcquisitionApi | MachaAcquisitionApi;
  managementAvailable: boolean;
}

export function useMachaServices(options: {
  serverUrl: string;
  apiToken: string;
  demo: boolean;
  apiOverride?: MediaApi;
  playbackOverride?: PlaybackResolver;
}): MachaServices {
  const { serverUrl, apiToken, demo, apiOverride, playbackOverride } = options;
  const catalogueApi = useMemo(() => new MachaCatalogueApi(serverUrl, apiToken), [apiToken, serverUrl]);
  const manageApi = useMemo(() => new MachaManageApi(serverUrl, apiToken), [apiToken, serverUrl]);
  const mediaApi = useMemo<MediaApi>(() => {
    if (apiOverride) return apiOverride;
    return demo ? new MockMediaApi() : new MachaMediaApi(catalogueApi);
  }, [apiOverride, catalogueApi, demo]);
  const playbackResolver = useMemo<PlaybackResolver>(() => {
    if (playbackOverride) return playbackOverride;
    return demo ? new DemoPlaybackResolver() : new MachaPlaybackResolver(serverUrl, apiToken);
  }, [apiToken, demo, playbackOverride, serverUrl]);
  const serverApi = useMemo<ServerApi>(
    () => demo ? new DemoServerApi() : new MachaServerApi(serverUrl, apiToken),
    [apiToken, demo, serverUrl],
  );
  const clusterStatusApi = useMemo<ClusterStatusApi>(
    () => demo ? new DemoClusterStatusApi() : new MachaClusterStatusApi(serverUrl, apiToken),
    [apiToken, demo, serverUrl],
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
  };
}
