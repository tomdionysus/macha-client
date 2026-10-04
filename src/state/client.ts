import { MachaClientConfiguration, parseEndpointList } from '@machafoundation/core';

/**
 * The web build's binding of core's client configuration: `import.meta.env`
 * exists only in a Vite build, so it is read here. The Samsung package pins its
 * build-time endpoints so stale storage on the TV cannot override them.
 */
export const clientConfiguration = new MachaClientConfiguration({
  // Precedence lives in core. A `.env` unsets a variable by defining it empty, which an `??` here would not fall through.
  environmentEndpoints: parseEndpointList(
    import.meta.env.VITE_MACHA_SERVERS as string | undefined,
    import.meta.env.VITE_MACHA_SERVER as string | undefined,
  ),
  pinnedEndpoints: import.meta.env.MODE === 'samsung',
});

export function getClientId(): string {
  return clientConfiguration.clientId();
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

