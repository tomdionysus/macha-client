import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MediaPageTitle } from './MediaPageTitle';

describe('MediaPageTitle', () => {
  it('keeps the page heading and refresh action in one shared title row', () => {
    const html = renderToStaticMarkup(
      <MediaPageTitle refreshing={false} onRefresh={vi.fn()}>Movies</MediaPageTitle>,
    );

    expect(html).toContain('class="media-page-title-row"');
    expect(html).toContain('<h1>Movies</h1>');
    expect(html).toContain('aria-label="Refresh Movies"');
  });

  it('uses the fixed disabled progress state while refreshing', () => {
    const html = renderToStaticMarkup(
      <MediaPageTitle refreshing onRefresh={vi.fn()}>Movies</MediaPageTitle>,
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('button-spinner');
  });
});
