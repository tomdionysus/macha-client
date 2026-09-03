import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AsyncIconButton } from './AsyncIconButton';

describe('AsyncIconButton', () => {
  it('keeps the same button disabled and replaces its icon with progress state', () => {
    const html = renderToStaticMarkup(
      <AsyncIconButton label="Refresh" busy icon={<span>icon</span>} onClick={vi.fn()} />,
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Refresh in progress"');
    expect(html).toContain('button-spinner');
    expect(html).not.toContain('>icon<');
  });
});
