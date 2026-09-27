// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Pager } from './ListParts';

describe('the pager', () => {
  it('says where the page sits in the list, and asks for the next and previous pages', () => {
    const onPage = vi.fn();
    render(<Pager label="Torrent pages" page={0} pageCount={2} first={1} last={50} total={60} onPage={onPage} />);
    expect(screen.getByText('1–50 of 60 · page 1 of 2')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it('stops at the last page', () => {
    const onPage = vi.fn();
    render(<Pager label="Torrent pages" page={1} pageCount={2} first={51} last={60} total={60} onPage={onPage} />);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPage).toHaveBeenCalledWith(0);
  });

  it('shows nothing for a list of one page', () => {
    const { container } = render(<Pager label="Torrent pages" page={0} pageCount={1} first={1} last={3} total={3} onPage={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });
});
