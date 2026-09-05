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
import type { EndpointRegistry } from '../cluster/EndpointRegistry';
import { ClusterEndpointRouter } from '../cluster/endpointRouting';
import type { AuthenticatedFetch } from '../api/SessionManager';

export interface MachaServices {
  catalogueApi: CatalogueApi;
  manageApi: ManageApi;
  mediaApi: MediaApi;
  playbackResolver: PlaybackResolver;
  serverApi: ServerApi;
  clusterStatusApi: ClusterStatusApi;
  acquisitionApi: AcquisitionApi;
  managementAvailable: boolean;
}

export function useMachaServices(options: {
  endpointRegistry: EndpointRegistry;
  auth: AuthenticatedFetch;
  demo: boolean;
  apiOverride?: MediaApi;
  playbackOverride?: PlaybackResolver;
}): MachaServices {
  const { endpointRegistry, auth, demo, apiOverride, playbackOverride } = options;
  const endpointRouter = useMemo(() => new ClusterEndpointRouter(endpointRegistry), [endpointRegistry]);
  // Every service below authenticates through `auth` at request time — the
  // real one is the app-wide session singleton, so a refresh (expiry, 401)
  // is never a reason to recreate these; recreating them would orphan an
  // active playback generation's node ownership. They only need rebuilding
  // when routing itself changes.
  const catalogueApi = useMemo(
    () => new ClusterCatalogueApi(endpointRouter, auth),
    [endpointRouter, auth],
  );
  const manageApi = useMemo<ManageApi>(() => new ClusterManageApi(endpointRouter, auth), [endpointRouter, auth]);
  const mediaApi = useMemo<MediaApi>(() => {
    if (apiOverride) return apiOverride;
    return demo ? new MockMediaApi() : new MachaMediaApi(catalogueApi);
  }, [apiOverride, catalogueApi, demo]);
  const playbackResolver = useMemo<PlaybackResolver>(() => {
    if (playbackOverride) return playbackOverride;
    if (demo) return new DemoPlaybackResolver();
    return new ClusterPlaybackResolver(endpointRouter, auth);
  }, [demo, endpointRouter, playbackOverride, auth]);
  const serverApi = useMemo<ServerApi>(
    () => demo ? new DemoServerApi() : new ClusterServerApi(endpointRouter, auth),
    [demo, endpointRouter, auth],
  );
  const clusterStatusApi = useMemo<ClusterStatusApi>(
    () => demo ? new DemoClusterStatusApi() : new ClusterStatusRouter(endpointRouter, auth),
    [demo, endpointRouter, auth],
  );
  const acquisitionApi = useMemo(
    () => demo ? new DemoAcquisitionApi() : new ClusterAcquisitionApi(endpointRouter, auth),
    [demo, endpointRouter, auth],
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
