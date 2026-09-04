// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MediaPageTitle } from './MediaPageTitle';

describe('MediaPageTitle', () => {
  it('keeps the page heading and refresh action in one shared title row', () => {
    const { container } = render(
      <MediaPageTitle refreshing={false} onRefresh={vi.fn()}>Movies</MediaPageTitle>,
    );

    expect(container.querySelector('.media-page-title-row')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Movies' })).not.toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh Movies' }).disabled).toBe(false);
  });

  it('uses the fixed disabled progress state while refreshing', () => {
    render(<MediaPageTitle refreshing onRefresh={vi.fn()}>Movies</MediaPageTitle>);

    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh Movies in progress' });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.button-spinner')).not.toBeNull();
  });
});
