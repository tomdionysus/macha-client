import { describe, expect, it } from 'vitest';
import type { EndpointCandidate } from '../cluster/EndpointRegistry';
import { clientEndpointHealth } from './StatusScreen';

function candidate(health: EndpointCandidate['health']): EndpointCandidate {
  return {
    endpoint: { id: 'http://node', baseUrl: 'http://node', source: 'bootstrap' },
    health,
  };
}

describe('client API endpoint status', () => {
  it('distinguishes no evidence, success, active cooldown and elapsed cooldown', () => {
    expect(clientEndpointHealth(candidate({ consecutiveFailures: 0 }), 1_000).label).toBe('Not tried');
    expect(clientEndpointHealth(candidate({ consecutiveFailures: 0, lastSuccessAt: 900 }), 1_000).label).toBe('Available');
    expect(clientEndpointHealth(candidate({ consecutiveFailures: 1, retryAt: 1_500 }), 1_000).label).toBe('Cooling down');
    expect(clientEndpointHealth(candidate({ consecutiveFailures: 1, retryAt: 900 }), 1_000).label).toBe('Retry eligible');
  });
});
