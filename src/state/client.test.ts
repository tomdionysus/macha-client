import { describe, expect, it } from 'vitest';
import { getBootstrapEndpoints, getServerUrl, setBootstrapEndpoints, setServerUrl } from './client';

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
    setBootstrapEndpoints(['http://node-a/', ' http://node-b ', 'http://node-a'], storage);

    expect(getBootstrapEndpoints(storage)).toEqual(['http://node-a', 'http://node-b']);
    expect(getServerUrl(storage)).toBe('http://node-a');
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
