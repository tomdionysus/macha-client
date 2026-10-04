import { describe, expect, it } from 'vitest';
import { routes } from '@machafoundation/core';
import { postSignInDestination } from '../App';

describe('where a viewer goes after signing in', () => {
  it('returns them to the deep link they were stopped at', () => {
    expect(postSignInDestination('/play/tmdb%3Aepisode%3A110080', routes.home))
      .toBe('/play/tmdb%3Aepisode%3A110080');
    expect(postSignInDestination('/series/1/seasons/2?from=start', routes.home))
      .toBe('/series/1/seasons/2?from=start');
  });

  it('falls back to the landing route when there was no destination', () => {
    expect(postSignInDestination(undefined, routes.home)).toBe(routes.home);
    expect(postSignInDestination(null, routes.settings)).toBe(routes.settings);
  });

  // `from` rides in `location.state`, which a viewer can author through the
  // History API; an absolute or protocol-relative URL would be an open redirect.
  it('refuses anything that is not a same-document path', () => {
    expect(postSignInDestination('https://elsewhere.example/', routes.home)).toBe(routes.home);
    expect(postSignInDestination('//elsewhere.example/', routes.home)).toBe(routes.home);
    expect(postSignInDestination('javascript:alert(1)', routes.home)).toBe(routes.home);
    expect(postSignInDestination(42, routes.home)).toBe(routes.home);
    expect(postSignInDestination({ from: '/movies' }, routes.home)).toBe(routes.home);
  });

  it('never sends them back to the login form', () => {
    expect(postSignInDestination(routes.login, routes.home)).toBe(routes.home);
  });
});
