import { describe, expect, it } from 'vitest';
import { matchRefusalText } from './ProviderRecord';

const notFound = Object.assign(new Error('log'), { status: 404, code: 'provider_not_found', detail: 'the provider has no such record, or no episode or track with those numbers' });
const series = { title: 'The Show', provider: 'tmdb' };

describe('a refused match, in this client\'s words', () => {
  it('names the episode asked for, and for an episode 0 says where specials are', () => {
    expect(matchRefusalText(notFound, series, { ref: 'tmdb:tv:42', season_number: 2, episode_number: 0 }))
      .toBe('TMDB has no season 2 episode 0 of The Show. TMDB lists specials under season 0: enter the special\'s season 0 episode number.');
    expect(matchRefusalText(notFound, series, { ref: 'tmdb:tv:42', season_number: 2, episode_number: 14 }))
      .toBe('TMDB has no season 2 episode 14 of The Show.');
  });

  it('names the track asked for', () => {
    expect(matchRefusalText(notFound, { title: 'A Record', provider: 'musicbrainz' }, { ref: 'musicbrainz:release:r1', track_number: 3, disc_number: 2 }))
      .toBe('MusicBrainz has no disc 2, track 3 on this release.');
  });

  it('leaves any other refusal to the general wording', () => {
    const unavailable = Object.assign(new Error('log'), { status: 503, code: 'provider_unavailable' });
    expect(matchRefusalText(unavailable, series, { ref: 'tmdb:tv:42', season_number: 1, episode_number: 1 }))
      .toBe('TMDB and MusicBrainz cannot be reached from the server right now. Try again in a minute.');
  });
});
