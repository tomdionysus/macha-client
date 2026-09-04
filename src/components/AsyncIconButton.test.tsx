// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AsyncIconButton } from './AsyncIconButton';

describe('AsyncIconButton', () => {
  it('keeps the same button disabled and replaces its icon with progress state', () => {
    render(<AsyncIconButton label="Refresh" busy icon={<span>icon</span>} onClick={vi.fn()} />);

    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh in progress' });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.button-spinner')).not.toBeNull();
    expect(screen.queryByText('icon')).toBeNull();
  });
});
