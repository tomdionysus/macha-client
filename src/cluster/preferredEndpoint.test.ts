import { describe, expect, it } from 'vitest';
import type { EndpointCandidate } from '@machafoundation/core';
import { preferredEndpointForNode } from './preferredEndpoint';

function candidate(id: string, ready = true): EndpointCandidate {
  return {
    endpoint: { id, baseUrl: `http://${id}.test:7438`, source: 'bootstrap' },
    health: { consecutiveFailures: ready ? 0 : 1 },
    ready,
  } as EndpointCandidate;
}

describe('preferredEndpointForNode', () => {
  it('states the preference against an endpoint that can actually serve it', () => {
    const chosen = preferredEndpointForNode([candidate('lan', false), candidate('wan')], ['lan', 'wan']);
    expect(chosen).toBe('wan');
  });

  it('takes the registry\'s own order between two ready doors onto one node', () => {
    expect(preferredEndpointForNode([candidate('wan'), candidate('lan')], ['lan', 'wan'])).toBe('wan');
    expect(preferredEndpointForNode([candidate('lan'), candidate('wan')], ['lan', 'wan'])).toBe('lan');
  });

  it('still records the choice when the whole node is cooling down', () => {
    const chosen = preferredEndpointForNode([candidate('lan', false), candidate('wan', false)], ['lan', 'wan']);
    expect(chosen).toBe('lan');
  });

  it('names an endpoint the registry has not listed rather than nothing', () => {
    expect(preferredEndpointForNode([candidate('other')], ['gone'])).toBe('gone');
  });

  it('has nothing to say about a node with no endpoints', () => {
    expect(preferredEndpointForNode([candidate('other')], [])).toBeUndefined();
  });
});
