import { MachaClientConfiguration, parseEndpointList } from '@macha/core';

/**
 * The web build's binding of the core's client configuration.
 *
 * The values and all their migration logic live in `MachaClientConfiguration`;
 * only their provenance is web-specific, and this is the one place that reads
 * it. `import.meta.env` exists in a Vite build and nowhere else, which is
 * exactly why it stopped at this boundary rather than going into the package.
 *
 * The Samsung package pins its build-time endpoints: stale storage from an
 * earlier development install on the same TV must not override them.
 */
export const clientConfiguration = new MachaClientConfiguration({
  // Precedence lives in the core: the first candidate yielding a usable
  // endpoint wins. A `.env` leaves a variable unset by defining it empty, so
  // deciding this at the call site invites an `??` that swallows the fallback.
  environmentEndpoints: parseEndpointList(
    import.meta.env.VITE_MACHA_SERVERS as string | undefined,
    import.meta.env.VITE_MACHA_SERVER as string | undefined,
  ),
  pinnedEndpoints: import.meta.env.MODE === 'samsung',
});

export function getClientId(): string {
  return clientConfiguration.clientId();
}

export function getServerUrl(): string {
  return clientConfiguration.serverUrl();
}

export function getBootstrapEndpoints(): string[] {
  return clientConfiguration.bootstrapEndpoints();
}

export function setServerUrl(url: string): void {
  clientConfiguration.setServerUrl(url);
}

export function setBootstrapEndpoints(urls: readonly string[]): void {
  clientConfiguration.setBootstrapEndpoints(urls);
}

export function getDiscoveredEndpoints(): string[] {
  return clientConfiguration.discoveredEndpoints();
}

export function setDiscoveredEndpoints(urls: readonly string[]): void {
  clientConfiguration.setDiscoveredEndpoints(urls);
}

export function getApiToken(): string {
  return clientConfiguration.apiToken();
}

export function setApiToken(token: string): void {
  clientConfiguration.setApiToken(token);
}
