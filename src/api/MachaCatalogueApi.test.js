import { afterEach, describe, expect, it, vi } from 'vitest';
import { MachaCatalogueApi } from './MachaCatalogueApi';
function jsonResponse(value, init = {}) {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
    });
}
const item = {
    id: 'show:black-books',
    kind: 'show',
    title: 'Black Books',
    sort_title: 'Black Books',
    synopsis: '',
    parent_id: null,
    year: 2000,
    season_number: null,
    episode_number: null,
    disc_number: null,
    track_number: null,
    aliases: [],
    external_ids: {},
    media_ids: [],
    artwork: [],
    revision: 1,
    updated_ns: 0,
};
describe('MachaCatalogueApi', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('uses the Macha catalogue list endpoint and query names', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [item] }));
        vi.stubGlobal('fetch', fetchMock);
        const api = new MachaCatalogueApi('http://node.test/');
        const result = await api.list('season', 'show:black-books');
        expect(result).toEqual([item]);
        expect(fetchMock).toHaveBeenCalledWith('http://node.test/api/v1/catalogue/items?type=season&parent=show%3Ablack-books', expect.objectContaining({ method: 'GET' }));
    });
    it('uses the catalogue search envelope and configured bearer token', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [item] }));
        vi.stubGlobal('fetch', fetchMock);
        const api = new MachaCatalogueApi('http://node.test', 'secret');
        await api.search('black books', 25);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://node.test/api/v1/catalogue/search?q=black+books&limit=25');
        expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');
    });
    it('fetches content-addressed artwork with authentication', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['image']), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
        vi.stubGlobal('fetch', fetchMock);
        const api = new MachaCatalogueApi('http://node.test', 'secret');
        await api.artwork('abcd');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://node.test/api/v1/catalogue/artwork/abcd');
        expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');
    });
    it('surfaces Macha JSON errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'catalogue_unavailable', message: 'catalogue root object unavailable' }, { status: 503 })));
        const api = new MachaCatalogueApi('');
        await expect(api.status()).rejects.toThrow('catalogue root object unavailable');
    });
});
