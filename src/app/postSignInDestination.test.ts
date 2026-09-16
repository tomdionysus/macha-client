import { describe, expect, it } from 'vitest';
import { routes } from '@machafoundation/core';
import { postSignInDestination } from '../App';

describe('where a viewer goes after signing in', () => {
  /**
   * The point of the whole thing. Somebody follows a link to a title, has no
   * usable session, gets a login — which is the correct answer — and then has
   * to be returned to the title they asked for. Before this, the redirect
   * recorded where they were heading and nothing ever read it, so a successful
   * sign-in left them on the form they had just filled in.
   */
  it('returns them to the deep link they were stopped at', () => {
    expect(postSignInDestination('/play/tmdb%3Aepisode%3A110080', routes.home))
      .toBe('/play/tmdb%3Aepisode%3A110080');
    expect(postSignInDestination('/series/1/seasons/2?from=start', routes.home))
      .toBe('/series/1/seasons/2?from=start');
  });

  // Nothing recorded, so nothing to finish: the account's own landing decides.
  it('falls back to the landing route when there was no destination', () => {
    expect(postSignInDestination(undefined, routes.home)).toBe(routes.home);
    expect(postSignInDestination(null, routes.settings)).toBe(routes.settings);
  });

  /**
   * `from` rides in `location.state`, which a viewer can author through the
   * History API, so it is trusted only as far as being a path this application
   * could have produced. An absolute URL or a protocol-relative one would turn
   * "sign in to keep watching" into an open redirect off the site.
   */
  it('refuses anything that is not a same-document path', () => {
    expect(postSignInDestination('https://elsewhere.example/', routes.home)).toBe(routes.home);
    expect(postSignInDestination('//elsewhere.example/', routes.home)).toBe(routes.home);
    expect(postSignInDestination('javascript:alert(1)', routes.home)).toBe(routes.home);
    expect(postSignInDestination(42, routes.home)).toBe(routes.home);
    expect(postSignInDestination({ from: '/movies' }, routes.home)).toBe(routes.home);
  });

  // The same dead end by a longer route.
  it('never sends them back to the login form', () => {
    expect(postSignInDestination(routes.login, routes.home)).toBe(routes.home);
  });
});
