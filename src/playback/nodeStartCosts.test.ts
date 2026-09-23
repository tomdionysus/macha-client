import { describe, expect, it, vi } from 'vitest';
import type { PlaybackResolver } from '@machafoundation/core';
import { measureStartCosts, NodeStartCosts, START_COST_STALE_MS } from './nodeStartCosts';

const GBNI = 'http://10.44.1.50:7438';
const SOURCE = `${GBNI}/api/v1/playback/sessions/ff96/stream/2836/1/master.m3u8`;

function clock() {
  let now = 50_000;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe("a node's measured cost of starting a stream", () => {
  it('is session create to first fragment, for the node that served it', () => {
    // Measured live 2026-09-23 on gbni-1: create 3.3 s, first fragment a
    // further 12.3 s. Both are the node's cost, because the node starts
    // producing from the position it was asked for at create.
    const time = clock();
    const costs = new NodeStartCosts(time.now);
    costs.requested(SOURCE, time.now());
    time.advance(15_600);
    costs.firstFragment(SOURCE);
    expect(costs.forNode([GBNI])).toEqual({ costMs: 15_600, ageMs: 0 });
  });

  it('measures a session once, not every fragment after the first', () => {
    const time = clock();
    const costs = new NodeStartCosts(time.now);
    costs.requested(SOURCE, time.now());
    time.advance(9_000);
    costs.firstFragment(SOURCE);
    time.advance(30_000);
    costs.firstFragment(SOURCE);
    expect(costs.forNode([GBNI])?.costMs).toBe(9_000);
  });

  it('keeps the latest figure, because a node under load is slower now than it was', () => {
    const time = clock();
    const costs = new NodeStartCosts(time.now);
    costs.requested(SOURCE, time.now());
    time.advance(4_000);
    costs.firstFragment(SOURCE);
    const second = SOURCE.replace('ff96', 'aa11');
    costs.requested(second, time.now());
    time.advance(12_000);
    costs.firstFragment(second);
    expect(costs.forNode([GBNI])?.costMs).toBe(12_000);
  });

  it('answers for a node reached by two addresses, from whichever measured it last', () => {
    const time = clock();
    const costs = new NodeStartCosts(time.now);
    const named = 'https://macnessa.macha.network';
    costs.requested(`${named}/api/v1/playback/sessions/x/stream/y/1/master.m3u8`, time.now());
    time.advance(7_000);
    costs.firstFragment(`${named}/api/v1/playback/sessions/x/stream/y/1/master.m3u8`);
    expect(costs.forNode([GBNI, named])?.costMs).toBe(7_000);
    expect(costs.forNode([GBNI])).toBeUndefined();
  });

  it('prefers the newer of two addresses onto one node, not the first listed', () => {
    const time = clock();
    const costs = new NodeStartCosts(time.now);
    const named = 'https://macnessa.macha.network';
    const namedSource = `${named}/api/v1/playback/sessions/x/stream/y/1/master.m3u8`;
    costs.requested(SOURCE, time.now());
    time.advance(4_000);
    costs.firstFragment(SOURCE);
    costs.requested(namedSource, time.now());
    time.advance(11_000);
    costs.firstFragment(namedSource);
    expect(costs.forNode([GBNI, named])?.costMs).toBe(11_000);
  });

  it('forgets a figure too old to describe the node now, and invents nothing in its place', () => {
    // Never a constant: a figure frozen in a client is the `look_ahead_ms`
    // fault, a client sized against a node that had since changed.
    const time = clock();
    const costs = new NodeStartCosts(time.now);
    costs.requested(SOURCE, time.now());
    time.advance(9_000);
    costs.firstFragment(SOURCE);
    time.advance(START_COST_STALE_MS + 1);
    expect(costs.forNode([GBNI])).toBeUndefined();
  });

  it('ignores a fragment for a session it never saw requested', () => {
    const time = clock();
    const costs = new NodeStartCosts(time.now);
    costs.firstFragment(SOURCE);
    expect(costs.forNode([GBNI])).toBeUndefined();
  });
});

describe('timing the sessions core asks for', () => {
  const session = { sessionId: 'ff96', source: { url: SOURCE } };

  it('stamps every call that produces a session with when it was asked for', async () => {
    const time = clock();
    const costs = new NodeStartCosts(time.now);
    let answer: (value: unknown) => void = () => {};
    const inner = {
      prepareOn: vi.fn(() => new Promise((resolve) => { answer = resolve; })),
      stop: vi.fn(async () => undefined),
    } as unknown as PlaybackResolver;
    const measured = measureStartCosts(inner, costs);

    const moving = measured.prepareOn!('http://10.44.1.50:7438', {} as never, {} as never, {} as never, 0, {});
    time.advance(3_300);
    answer(session);
    await expect(moving).resolves.toBe(session);
    time.advance(12_300);
    costs.firstFragment(SOURCE);
    expect(costs.forNode([GBNI])?.costMs).toBe(15_600);
  });

  it('passes everything else through untouched, and leaves absent methods absent', async () => {
    const costs = new NodeStartCosts(() => 0);
    const inner = { stop: vi.fn(async () => undefined) } as unknown as PlaybackResolver;
    const measured = measureStartCosts(inner, costs);
    await measured.stop('ff96');
    expect(inner.stop).toHaveBeenCalledWith('ff96');
    // Core branches on whether an optional method exists.
    expect(measured.prepareOn).toBeUndefined();
  });
});
