// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QualityPreferenceStore, type MediaApi, type QualityCeiling, type ServerApi, type StorageLike } from '@machafoundation/core';
import { SettingsScreen } from './SettingsScreen';

function show(ceiling: () => QualityCeiling | undefined) {
  const entries = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: (key) => { entries.delete(key); },
  };
  const store = new QualityPreferenceStore(storage);
  const api = { status: vi.fn(() => new Promise(() => {})) } as unknown as MediaApi;
  const serverApi = { status: vi.fn(() => new Promise(() => {})) } as unknown as ServerApi;
  render(<MemoryRouter><SettingsScreen api={api} serverApi={serverApi} bootstrapEndpoints={[]} onSave={vi.fn()} qualityPreferences={store} qualityCeiling={ceiling} /></MemoryRouter>);
  return store;
}

const selected = (label: string) => screen.getByText(label, { selector: 'button' }).className === 'selected';

describe('the Maximum quality setting', () => {
  it('starts on Automatic and says what the screen allows', () => {
    show(() => ({ quality: 1080, reason: 'ceiling-display' }));
    expect(selected('Automatic')).toBe(true);
    expect(screen.getByText('Automatic: Play chooses up to 1080p, the most this screen shows.')).toBeTruthy();
  });

  it('says so when the screen is unknown rather than inventing a cap', () => {
    show(() => undefined);
    expect(screen.getByText("Automatic: Play chooses the best file, as this screen's size is not known.")).toBeTruthy();
  });

  it('keeps a chosen ceiling in core\'s store as the Wi-Fi one, and Automatic clears it', () => {
    const store = show(() => undefined);
    fireEvent.click(screen.getByText('720p', { selector: 'button' }));
    expect(store.get()).toEqual({ wifi: 720 });
    expect(selected('720p')).toBe(true);
    expect(screen.getByText("Play chooses up to 720p on this device. Any quality can still be picked on a title's page.")).toBeTruthy();
    fireEvent.click(screen.getByText('Automatic', { selector: 'button' }));
    expect(store.get()).toEqual({});
    expect(selected('Automatic')).toBe(true);
  });

  it('limits what is offered to this device until the viewer asks for everything', () => {
    const store = show(() => undefined);
    const offerAll = screen.getByLabelText(/Offer every quality and mode/) as HTMLInputElement;
    expect(offerAll.checked).toBe(false);
    fireEvent.click(offerAll);
    expect(store.get()).toEqual({ offerAll: true });
    expect(offerAll.checked).toBe(true);
    fireEvent.click(offerAll);
    expect(store.get()).toEqual({});
  });
});
