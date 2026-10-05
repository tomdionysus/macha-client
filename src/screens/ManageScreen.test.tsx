// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MachaClusterRouteError, MachaConnectionError, type ManageApi, type UnmatchedFile } from '@machafoundation/core';
import { ManageScreen } from './ManageScreen';
import { NO_NODE_ANSWERED_TEXT } from '../text/viewerText';
import { settle } from '../test/settle';

const file: UnmatchedFile = {
  id: 'f1', path: '/incoming/some.file.mkv', provider: 'movies', media_id: 'media-f1', result: 'no_provider_match',
  attempts: 1, updated_unix_ms: 0, size: 1_000, mtime_ns: 0, current: true,
};

describe('the unmatched list', () => {
  it('says no server answered, without a count, when the first load fails, and lists the files once a retry succeeds', async () => {
    const timedOut = new MachaClusterRouteError(['fi-1', 'gbni-1'], true, new MachaConnectionError('exceeded 8000 ms'));
    const unmatched = vi.fn<() => Promise<UnmatchedFile[]>>().mockRejectedValueOnce(timedOut).mockResolvedValueOnce([file]);
    render(<MemoryRouter><ManageScreen api={{ unmatched } as unknown as ManageApi} section="unmatched" users={null} /></MemoryRouter>);
    await settle();
    expect(screen.getByRole('alert').textContent).toBe(NO_NODE_ANSWERED_TEXT);
    expect(screen.getByRole('heading', { name: 'Unmatched files' }).textContent).toBe('Unmatched files');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(unmatched).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { name: /Unmatched files/ }).textContent).toBe('Unmatched files 1');
    expect(screen.getByText('some.file.mkv')).toBeTruthy();
  });

  it('selects and deselects a file by a click anywhere on its row, and opens it only from its name', async () => {
    const unmatched = vi.fn(async () => [file]);
    render(<MemoryRouter><ManageScreen api={{ unmatched } as unknown as ManageApi} section="unmatched" users={null} /></MemoryRouter>);
    await settle();
    const box = screen.getByRole('checkbox', { name: 'Select some.file.mkv' }) as HTMLInputElement;
    const size = document.querySelector('td.col-size') as HTMLElement;
    fireEvent.click(size);
    expect(box.checked).toBe(true);
    fireEvent.click(size);
    expect(box.checked).toBe(false);
    expect(screen.getByRole('link', { name: 'some.file.mkv' }).getAttribute('href')).toBe('/manage/unmatched/f1');
  });
});
