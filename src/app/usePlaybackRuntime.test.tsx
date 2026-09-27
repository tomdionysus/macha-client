// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackRuntime, type Platform, type PlaybackResolver } from '@machafoundation/core';
import { createFakePlayer } from '../test/fakePlayer';
import { usePlaybackRuntime } from './usePlaybackRuntime';

const platform = { name: 'web', capabilities: vi.fn(), createPlayer: () => createFakePlayer() } as unknown as Platform;
const resolver = {} as PlaybackResolver;

describe('leaving the page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('closes playback on every pagehide, including one into the back-forward cache', () => {
    const terminate = vi.spyOn(PlaybackRuntime.prototype, 'terminateForPageExit').mockImplementation(() => undefined);
    renderHook(() => usePlaybackRuntime(platform, resolver));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(terminate).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    expect(terminate).toHaveBeenCalledTimes(2);
  });
});
