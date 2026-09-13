import { describe, expect, it } from 'vitest';
import { installLogcatConsoleBridge } from './logcatConsole';

function fakeConsole() {
  const lines: unknown[][] = [];
  const record = (...args: unknown[]) => { lines.push(args); };
  return {
    lines,
    target: { debug: record, info: record, warn: record, error: record, log: record } as unknown as Console,
  };
}

describe('flattening console output for logcat', () => {
  it('serialises the detail that would otherwise arrive as [object Object]', () => {
    const { lines, target } = fakeConsole();
    installLogcatConsoleBridge(target);

    target.warn('[macha] media-time', { endpoint: 'http://node-b:7438', decodedBytes: { audio: 12, video: 34 } });

    expect(lines[0][0]).toBe('[macha] media-time');
    expect(lines[0][1]).toBe('{"endpoint":"http://node-b:7438","decodedBytes":{"audio":12,"video":34}}');
  });

  it('keeps an error’s message, which JSON alone renders as {}', () => {
    const { lines, target } = fakeConsole();
    installLogcatConsoleBridge(target);

    target.error('[macha] fatal', { error: new Error('no untried endpoint remains') });

    expect(String(lines[0][1])).toContain('no untried endpoint remains');
  });

  it('leaves strings and numbers exactly as they were', () => {
    const { lines, target } = fakeConsole();
    installLogcatConsoleBridge(target);

    target.info('plain', 42, undefined, null);

    expect(lines[0]).toEqual(['plain', 42, undefined, null]);
  });

  it('survives a circular structure rather than throwing inside a log call', () => {
    const { lines, target } = fakeConsole();
    installLogcatConsoleBridge(target);
    const cyclic: Record<string, unknown> = { name: 'session' };
    cyclic.self = cyclic;

    expect(() => target.debug('[macha] cyclic', cyclic)).not.toThrow();
    expect(String(lines[0][1])).toContain('circular');
  });

  it('bounds one line so a large payload cannot fill the buffer', () => {
    const { lines, target } = fakeConsole();
    installLogcatConsoleBridge(target);

    target.debug('[macha] big', { blob: 'x'.repeat(20_000) });

    expect(String(lines[0][1])).toHaveLength(4_001);
    expect(String(lines[0][1]).endsWith('…')).toBe(true);
  });
});
