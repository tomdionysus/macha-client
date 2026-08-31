import type { EndpointRegistry, MachaEndpoint } from '../cluster/EndpointRegistry';
import { endpointFailure, retryableEndpointFailure } from '../cluster/endpointFailure';
import type { MediaSummary, PlaybackCapabilities } from '../types';
import { MachaPlaybackResolver } from './MachaPlaybackResolver';
import type {
  PlaybackPreferencesUpdate,
  PlaybackResolver,
  PlaybackSession,
  PlaybackStopOptions,
  PlaybackUpdate,
} from './PlaybackResolver';

interface OwnedSession {
  endpoint: MachaEndpoint;
  resolver: MachaPlaybackResolver;
  nodeSessionId: string;
}

/** Creates disposable playback generations on any suitable bootstrap endpoint. */
export class ClusterPlaybackResolver implements PlaybackResolver {
  readonly available = true;
  private readonly resolvers = new Map<string, MachaPlaybackResolver>();
  private readonly sessions = new Map<string, OwnedSession>();
  private failedGenerationEndpoints = new Set<string>();

  constructor(
    private readonly registry: EndpointRegistry,
    private readonly bearerToken?: string,
  ) {}

  async resolve(
    media: MediaSummary,
    capabilities: PlaybackCapabilities,
    seekMs?: number,
    preferences?: PlaybackPreferencesUpdate,
  ): Promise<PlaybackSession> {
    this.failedGenerationEndpoints = new Set();
    return this.create(media, capabilities, seekMs, preferences, new Set(), true);
  }

  async failover(
    failedSession: PlaybackSession,
    media: MediaSummary,
    capabilities: PlaybackCapabilities,
    seekMs: number,
    preferences: PlaybackPreferencesUpdate,
    preparedAlternate?: PlaybackSession,
  ): Promise<PlaybackSession> {
    if (failedSession.endpoint) {
      this.failedGenerationEndpoints.add(failedSession.endpoint.id);
      this.registry.recordFailure(failedSession.endpoint.id);
    }
    if (preparedAlternate) {
      const owned = this.sessions.get(preparedAlternate.sessionId);
      if (owned
        && owned.endpoint.id !== failedSession.endpoint?.id
        && preparedAlternate.mediaId === failedSession.mediaId) {
        this.registry.recordSuccess(owned.endpoint.id);
        return preparedAlternate;
      }
    }
    return this.create(media, capabilities, seekMs, preferences, this.failedGenerationEndpoints, true);
  }

  async prepareAlternate(
    activeSession: PlaybackSession,
    media: MediaSummary,
    capabilities: PlaybackCapabilities,
    seekMs: number,
    preferences: PlaybackPreferencesUpdate,
  ): Promise<PlaybackSession | undefined> {
    if (!activeSession.endpoint) return undefined;
    const excluded = new Set(this.failedGenerationEndpoints);
    excluded.add(activeSession.endpoint.id);
    try {
      const alternate = await this.create(
        media,
        capabilities,
        seekMs,
        { ...preferences, mode: activeSession.mode === 'direct' ? 'direct' : preferences.mode },
        excluded,
        false,
      );
      if (alternate.mode === activeSession.mode) return alternate;
      await this.stop(alternate.sessionId).catch(() => undefined);
      return undefined;
    } catch {
      // Standby preparation is opportunistic and must never become a viewer
      // failure or alter the already-playing primary generation.
      return undefined;
    }
  }

  private async create(
    media: MediaSummary,
    capabilities: PlaybackCapabilities,
    seekMs: number | undefined,
    preferences: PlaybackPreferencesUpdate | undefined,
    excluded: ReadonlySet<string>,
    preferOnSuccess: boolean,
  ): Promise<PlaybackSession> {
    let lastError: unknown;
    for (const { endpoint } of this.registry.candidates(excluded)) {
      const resolver = this.resolver(endpoint);
      try {
        const session = await resolver.resolve(media, capabilities, seekMs, preferences);
        session.endpoint = { id: endpoint.id, baseUrl: endpoint.baseUrl };
        const nodeSessionId = session.sessionId;
        session.sessionId = `${endpoint.id}::${encodeURIComponent(nodeSessionId)}`;
        this.sessions.set(session.sessionId, { endpoint, resolver, nodeSessionId });
        if (preferOnSuccess) this.registry.recordSuccess(endpoint.id);
        else this.registry.recordProbeSuccess(endpoint.id);
        return session;
      } catch (error) {
        if (!retryableEndpointFailure(error)) throw error;
        this.registry.recordFailure(endpoint.id);
        lastError = endpointFailure(endpoint.id, endpoint.baseUrl, error);
      }
    }
    throw lastError ?? new Error('No untried Macha playback endpoint remains.');
  }

  async update(sessionId: string, update: PlaybackUpdate): Promise<PlaybackSession> {
    const owned = this.sessions.get(sessionId);
    if (!owned) throw new Error(`Playback generation ${sessionId} has no endpoint provenance.`);
    try {
      const session = await owned.resolver.update(owned.nodeSessionId, update);
      const nodeSessionId = session.sessionId;
      session.sessionId = sessionId;
      session.endpoint = { id: owned.endpoint.id, baseUrl: owned.endpoint.baseUrl };
      owned.nodeSessionId = nodeSessionId;
      this.registry.recordSuccess(owned.endpoint.id);
      return session;
    } catch (error) {
      if (retryableEndpointFailure(error)) this.registry.recordFailure(owned.endpoint.id);
      throw endpointFailure(owned.endpoint.id, owned.endpoint.baseUrl, error);
    }
  }

  async stop(sessionId: string, options?: PlaybackStopOptions): Promise<void> {
    const owned = this.sessions.get(sessionId);
    if (!owned) return;
    this.sessions.delete(sessionId);
    try {
      await owned.resolver.stop(owned.nodeSessionId, options);
    } catch (error) {
      if (retryableEndpointFailure(error)) this.registry.recordFailure(owned.endpoint.id);
      throw endpointFailure(owned.endpoint.id, owned.endpoint.baseUrl, error);
    }
  }

  private resolver(endpoint: MachaEndpoint): MachaPlaybackResolver {
    let resolver = this.resolvers.get(endpoint.id);
    if (!resolver) {
      resolver = new MachaPlaybackResolver(endpoint.baseUrl, this.bearerToken);
      this.resolvers.set(endpoint.id, resolver);
    }
    return resolver;
  }
}
