import { describe, expect, it } from 'vitest';
import { getBootstrapEndpoints, getDiscoveredEndpoints, getServerUrl, setBootstrapEndpoints, setDiscoveredEndpoints, setServerUrl } from './client';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('client server endpoint persistence', () => {
  it('migrates the legacy single URL into versioned endpoint state', () => {
    const storage = new MemoryStorage();
    storage.setItem('macha-server-url', 'http://node-a/');

    expect(getBootstrapEndpoints(storage)).toEqual(['http://node-a']);
    expect(storage.getItem('macha-server-url')).toBeNull();
    expect(JSON.parse(storage.getItem('macha-bootstrap-endpoints-v1') ?? '')).toEqual({
      version: 1,
      urls: ['http://node-a'],
    });
  });

  it('normalizes and deduplicates a bootstrap endpoint set', () => {
    const storage = new MemoryStorage();
    setBootstrapEndpoints(['http://node-a/', '', ' http://node-b ', '  ', 'http://node-a'], storage);

    expect(getBootstrapEndpoints(storage)).toEqual(['http://node-a', 'http://node-b']);
    expect(getServerUrl(storage)).toBe('http://node-a');
  });

  it('removes obsolete same-origin entries from persisted endpoint state', () => {
    const storage = new MemoryStorage();
    storage.setItem('macha-bootstrap-endpoints-v1', JSON.stringify({
      version: 1,
      urls: ['', 'http://node-a', '/', 'http://node-a/'],
    }));

    expect(getBootstrapEndpoints(storage)).toEqual(['http://node-a']);
    expect(JSON.parse(storage.getItem('macha-bootstrap-endpoints-v1') ?? '')).toEqual({
      version: 1,
      urls: ['http://node-a'],
    });
  });

  it('retains the single-URL compatibility API', () => {
    const storage = new MemoryStorage();
    setServerUrl('http://node-a/', storage);
    expect(getBootstrapEndpoints(storage)).toEqual(['http://node-a']);
  });

  it('discards malformed versioned state and falls back safely', () => {
    const storage = new MemoryStorage();
    storage.setItem('macha-bootstrap-endpoints-v1', '{broken');
    expect(getBootstrapEndpoints(storage)).toEqual([]);
    expect(storage.getItem('macha-bootstrap-endpoints-v1')).toBeNull();
  });

  it('migrates the interim multi-endpoint key without losing candidates', () => {
    const storage = new MemoryStorage();
    storage.setItem('macha-server-endpoints-v1', JSON.stringify({ version: 1, urls: ['http://a', 'http://b'] }));
    expect(getBootstrapEndpoints(storage)).toEqual(['http://a', 'http://b']);
    expect(storage.getItem('macha-server-endpoints-v1')).toBeNull();
  });
});

describe('discovered endpoint persistence', () => {
  it('persists and reads back confirmed-reachable discovered endpoints under their own key, separate from bootstrap configuration', () => {
    const storage = new MemoryStorage();
    setDiscoveredEndpoints(['http://node-b/', '', ' http://node-c ', 'http://node-b'], storage);

    expect(getDiscoveredEndpoints(storage)).toEqual(['http://node-b', 'http://node-c']);
    expect(storage.getItem('macha-bootstrap-endpoints-v1')).toBeNull();
    expect(JSON.parse(storage.getItem('macha-discovered-endpoints-v1') ?? '')).toEqual({
      version: 1,
      urls: ['http://node-b', 'http://node-c'],
    });
  });

  it('clears the discovered-endpoints key once nothing is confirmed reachable any more', () => {
    const storage = new MemoryStorage();
    setDiscoveredEndpoints(['http://node-b'], storage);
    expect(getDiscoveredEndpoints(storage)).toEqual(['http://node-b']);

    setDiscoveredEndpoints([], storage);
    expect(getDiscoveredEndpoints(storage)).toEqual([]);
    expect(storage.getItem('macha-discovered-endpoints-v1')).toBeNull();
  });

  it('bounds the persisted discovered set instead of accumulating unbounded discovery history', () => {
    const storage = new MemoryStorage();
    const many = Array.from({ length: 40 }, (_, index) => `http://node-${index}`);

    setDiscoveredEndpoints(many, storage);

    expect(getDiscoveredEndpoints(storage)).toHaveLength(16);
    expect(getDiscoveredEndpoints(storage)).toEqual(many.slice(0, 16));
  });

  it('self-heals a malformed discovered-endpoints value into its own key, never the bootstrap key', () => {
    // The read/normalize/rewrite helper is shared with the bootstrap-endpoint
    // key; it must rewrite whichever key it was actually asked to read, not a
    // hardcoded one, or a discovered-endpoints value that needs normalizing
    // would silently leak into user-facing bootstrap configuration.
    const storage = new MemoryStorage();
    storage.setItem('macha-discovered-endpoints-v1', JSON.stringify({ version: 1, urls: ['http://node-b/', '/'] }));

    expect(getDiscoveredEndpoints(storage)).toEqual(['http://node-b']);
    expect(JSON.parse(storage.getItem('macha-discovered-endpoints-v1') ?? '')).toEqual({
      version: 1,
      urls: ['http://node-b'],
    });
    expect(storage.getItem('macha-bootstrap-endpoints-v1')).toBeNull();
  });

  it('discards malformed discovered-endpoints state and falls back to empty, independent of bootstrap state', () => {
    const storage = new MemoryStorage();
    setBootstrapEndpoints(['http://node-a'], storage);
    storage.setItem('macha-discovered-endpoints-v1', '{broken');

    expect(getDiscoveredEndpoints(storage)).toEqual([]);
    expect(storage.getItem('macha-discovered-endpoints-v1')).toBeNull();
    expect(getBootstrapEndpoints(storage)).toEqual(['http://node-a']);
  });
});
