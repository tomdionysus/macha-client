import { describe, expect, it } from 'vitest';
import type { ClusterNodeStatus, EndpointCandidate } from '@machafoundation/core';
import { nodeIdentityAdvertisements } from './nodeAdvertisements';

function candidate(id: string, baseUrl: string): EndpointCandidate {
  return { endpoint: { id, baseUrl, source: 'bootstrap' }, health: { consecutiveFailures: 0 }, ready: true } as EndpointCandidate;
}

function node(id: string, host: string, port: number, apiEndpoint?: string): ClusterNodeStatus {
  return { id, host, port, api_endpoint: apiEndpoint, state: 'online' } as ClusterNodeStatus;
}

describe('nodeIdentityAdvertisements', () => {
  it('names both doors onto one node, which is the whole point', () => {
    const advertisements = nodeIdentityAdvertisements(
      [node('node-1', '10.44.1.50', 7438, 'https://macnessa.macha.network')],
      [candidate('a', 'http://10.44.1.50:7438'), candidate('b', 'https://macnessa.macha.network')],
    );
    expect(advertisements).toEqual([
      { nodeId: 'node-1', apiBaseUrls: ['http://10.44.1.50:7438', 'https://macnessa.macha.network'] },
    ]);
  });

  it('advertises nothing for a node this client cannot already reach', () => {
    const advertisements = nodeIdentityAdvertisements(
      [node('node-2', '10.34.1.50', 7438, 'https://elsewhere.test')],
      [candidate('a', 'http://10.44.1.50:7438')],
    );
    expect(advertisements).toEqual([]);
  });

  it('never invents a URL, because an invented one becomes a discovered endpoint', () => {
    const advertisements = nodeIdentityAdvertisements(
      [node('node-1', '10.44.1.50', 7438, 'https://macnessa.macha.network')],
      [candidate('a', 'http://10.44.1.50:7438')],
    );
    expect(advertisements[0].apiBaseUrls).toEqual(['http://10.44.1.50:7438']);
  });

  it('reads the default port from the scheme when the URL leaves it out', () => {
    const advertisements = nodeIdentityAdvertisements(
      [node('node-3', 'ramaroja.macha.network', 443)],
      [candidate('a', 'https://ramaroja.macha.network')],
    );
    expect(advertisements[0].apiBaseUrls).toEqual(['https://ramaroja.macha.network']);
  });

  it('does not claim an endpoint on the right host but the wrong port', () => {
    const advertisements = nodeIdentityAdvertisements(
      [node('node-1', '10.44.1.50', 7438)],
      [candidate('a', 'http://10.44.1.50:9999')],
    );
    expect(advertisements).toEqual([]);
  });

  it('keeps nodes apart', () => {
    const advertisements = nodeIdentityAdvertisements(
      [node('node-1', '10.44.1.50', 7438), node('node-2', '10.34.1.50', 7438)],
      [candidate('a', 'http://10.44.1.50:7438'), candidate('b', 'http://10.34.1.50:7438')],
    );
    expect(advertisements).toEqual([
      { nodeId: 'node-1', apiBaseUrls: ['http://10.44.1.50:7438'] },
      { nodeId: 'node-2', apiBaseUrls: ['http://10.34.1.50:7438'] },
    ]);
  });

  it('skips an endpoint with no base URL rather than matching same-origin to everything', () => {
    const advertisements = nodeIdentityAdvertisements(
      [node('node-1', '10.44.1.50', 7438)],
      [candidate('same-origin', '')],
    );
    expect(advertisements).toEqual([]);
  });
});
