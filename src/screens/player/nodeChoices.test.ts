import { describe, expect, it } from 'vitest';
import type { EndpointCandidate } from '@machafoundation/core';
import { playerNodeChoices } from './nodeChoices';

function candidate(id: string, baseUrl: string, ready = true, nodeId?: string): EndpointCandidate {
  return {
    endpoint: { id, baseUrl, source: 'bootstrap', ...(nodeId ? { nodeId } : {}) },
    health: { consecutiveFailures: ready ? 0 : 1 },
    ready,
  } as EndpointCandidate;
}

describe('playerNodeChoices', () => {
  it('labels a node by its host, because that is what the Status screen calls it', () => {
    const choices = playerNodeChoices([candidate('a', 'https://macnessa.macha.network:7438')]);
    expect(choices[0].label).toBe('macnessa.macha.network');
  });

  it('adds the port only where a host alone would name two nodes', () => {
    const choices = playerNodeChoices([
      candidate('a', 'http://10.0.0.1:7438'),
      candidate('b', 'http://10.0.0.1:7439'),
      candidate('c', 'http://10.0.0.2:7438'),
    ]);
    expect(choices.map((choice) => choice.label)).toEqual(['10.0.0.1:7438', '10.0.0.1:7439', '10.0.0.2']);
  });

  it('calls the same-origin endpoint what the Status screen calls it', () => {
    expect(playerNodeChoices([candidate('a', '')])[0].label).toBe('same origin');
  });

  it('falls back to the configured string rather than inventing a label', () => {
    expect(playerNodeChoices([candidate('a', 'not a url')])[0].label).toBe('not a url');
  });

  it('marks the node serving this generation and only that one', () => {
    const choices = playerNodeChoices(
      [candidate('a', 'http://a.test:7438'), candidate('b', 'http://b.test:7438')],
      'b',
    );
    expect(choices.map((choice) => choice.active)).toEqual([false, true]);
    expect(choices[1].detail).toContain('serving this stream');
  });

  it('marks nothing active when the generation has no endpoint provenance', () => {
    const choices = playerNodeChoices([candidate('a', 'http://a.test:7438')]);
    expect(choices[0].active).toBe(false);
  });

  it('says why a cooling node is not worth asking for', () => {
    const choices = playerNodeChoices([candidate('a', 'http://a.test:7438', false)]);
    expect(choices[0].ready).toBe(false);
    expect(choices[0].detail).toContain('cooling down');
  });

  it('shows one pill for a node reachable at two addresses', () => {
    const choices = playerNodeChoices([
      candidate('lan', 'http://10.44.1.50:7438', true, 'node-1'),
      candidate('wan', 'https://macnessa.macha.network', true, 'node-1'),
      candidate('other', 'http://10.34.1.50:7438', true, 'node-2'),
    ]);
    expect(choices).toHaveLength(2);
    const node = choices.find((choice) => choice.id === 'node-1')!;
    expect(node.endpointIds).toEqual(['lan', 'wan']);
    expect(node.label).toBe('macnessa.macha.network');
    expect(node.detail).toContain('10.44.1.50:7438');
  });

  it('is active when any address of the node is serving the stream', () => {
    const choices = playerNodeChoices([
      candidate('lan', 'http://10.44.1.50:7438', true, 'node-1'),
      candidate('wan', 'https://macnessa.macha.network', true, 'node-1'),
    ], 'wan');
    expect(choices[0].active).toBe(true);
  });

  it('is ready when any address of the node is, since either door will do', () => {
    const choices = playerNodeChoices([
      candidate('lan', 'http://10.44.1.50:7438', false, 'node-1'),
      candidate('wan', 'https://macnessa.macha.network', true, 'node-1'),
    ]);
    expect(choices[0].ready).toBe(true);
  });

  it('leaves an unidentified endpoint on its own rather than guessing whose it is', () => {
    const choices = playerNodeChoices([
      candidate('lan', 'http://10.44.1.50:7438'),
      candidate('wan', 'https://macnessa.macha.network'),
    ]);
    expect(choices).toHaveLength(2);
  });

  it('draws in the same order whatever order the registry ranked them in', () => {
    const order = (ids: string[]) => playerNodeChoices(
      ids.map((id) => candidate(id, `http://${id}.test:7438`)),
    ).map((choice) => choice.label);
    expect(order(['c', 'a', 'b'])).toEqual(['a.test', 'b.test', 'c.test']);
    expect(order(['b', 'c', 'a'])).toEqual(['a.test', 'b.test', 'c.test']);
  });

  it('sorts addresses by number rather than by digit, which is the whole point with dozens', () => {
    const choices = playerNodeChoices([
      candidate('a', 'http://10.44.1.50:7438'),
      candidate('b', 'http://10.9.1.50:7438'),
      candidate('c', 'http://10.10.1.50:7438'),
      candidate('d', 'http://10.34.1.50:7438'),
    ]);
    expect(choices.map((choice) => choice.label)).toEqual(['10.9.1.50', '10.10.1.50', '10.34.1.50', '10.44.1.50']);
  });

  it('orders names without caring about case', () => {
    const choices = playerNodeChoices([
      candidate('a', 'https://Zulu.macha.network'),
      candidate('b', 'https://alpha.macha.network'),
      candidate('c', 'not a url: Beta'),
    ]);
    expect(choices.map((choice) => choice.label)).toEqual(['alpha.macha.network', 'not a url: Beta', 'zulu.macha.network']);
  });

  it('breaks a tie on identity, so two nodes sharing a label never swap places', () => {
    const one = playerNodeChoices([candidate('b', ''), candidate('a', '')]).map((choice) => choice.id);
    const two = playerNodeChoices([candidate('a', ''), candidate('b', '')]).map((choice) => choice.id);
    expect(one).toEqual(['a', 'b']);
    expect(two).toEqual(['a', 'b']);
  });

  it('leaves the node being streamed from where it belongs rather than floating it to the top', () => {
    const choices = playerNodeChoices([
      candidate('a', 'http://alpha.test:7438'),
      candidate('z', 'http://zulu.test:7438'),
    ], 'z');
    expect(choices.map((choice) => choice.label)).toEqual(['alpha.test', 'zulu.test']);
    expect(choices[1].active).toBe(true);
  });
});
