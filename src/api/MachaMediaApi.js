function optionalNumber(value) {
    return value ?? undefined;
}
export class MachaMediaApi {
    catalogue;
    artworkCache = new Map();
    constructor(catalogue) {
        this.catalogue = catalogue;
    }
    status() {
        return this.catalogue.status();
    }
    async home() {
        const [movies, shows, albums] = await Promise.all([this.movies(), this.shows(), this.albums()]);
        return { movies, shows, albums };
    }
    async movies() {
        return (await this.catalogue.list('movie')).map((item) => this.media(item));
    }
    async shows() {
        return (await this.catalogue.list('show')).map((item) => this.media(item));
    }
    async artists() {
        return (await this.catalogue.list('artist')).map((item) => this.media(item));
    }
    async albums() {
        return (await this.catalogue.list('album')).map((item) => this.media(item));
    }
    async details(id) {
        const item = await this.catalogue.get(id);
        if (item.kind === 'show') {
            const seasonItems = await this.catalogue.list('season', item.id);
            const seasons = seasonItems
                .map((seasonItem) => this.seasonSummary(seasonItem, item.id))
                .sort((a, b) => a.seasonNumber - b.seasonNumber);
            return {
                ...this.media(item),
                kind: 'show',
                seasons,
            };
        }
        if (item.kind === 'season') {
            const episodeItems = await this.catalogue.list('episode', item.id);
            const seasonNumber = item.season_number ?? 0;
            const episodes = episodeItems
                .map((episode) => ({
                ...this.media(episode),
                kind: 'episode',
                seasonNumber: episode.season_number ?? seasonNumber,
                episodeNumber: episode.episode_number ?? 0,
            }))
                .sort((a, b) => a.episodeNumber - b.episodeNumber);
            return {
                ...this.seasonSummary(item, item.parent_id ?? ''),
                episodes,
            };
        }
        if (item.kind === 'artist') {
            const albums = (await this.catalogue.list('album', item.id))
                .map((album) => this.media(album))
                .sort((a, b) => (a.year ?? Number.MAX_SAFE_INTEGER) - (b.year ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title));
            return {
                ...this.media(item),
                kind: 'artist',
                albums,
            };
        }
        if (item.kind === 'album') {
            const tracks = (await this.catalogue.list('track', item.id))
                .map((track) => this.media(track))
                .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
            return {
                ...this.media(item),
                kind: 'album',
                tracks,
            };
        }
        return this.media(item);
    }
    async search(query) {
        return (await this.catalogue.search(query, 50)).map((item) => this.media(item));
    }
    artwork(ref) {
        let pending = this.artworkCache.get(ref.id);
        if (!pending) {
            pending = this.catalogue.artwork(ref.id);
            this.artworkCache.set(ref.id, pending);
            pending.catch(() => this.artworkCache.delete(ref.id));
        }
        return pending;
    }
    seasonSummary(item, showId) {
        const media = this.media(item);
        const seasonNumber = item.season_number ?? 0;
        return {
            ...media,
            kind: 'season',
            showId,
            seasonNumber,
            title: item.title || `Season ${seasonNumber}`,
        };
    }
    media(item) {
        return {
            id: item.id,
            kind: item.kind,
            title: item.title,
            subtitle: this.subtitle(item),
            year: optionalNumber(item.year),
            synopsis: item.synopsis || undefined,
            artwork: this.mapArtwork(item.artwork),
            parentId: item.parent_id ?? undefined,
            seasonNumber: optionalNumber(item.season_number),
            episodeNumber: optionalNumber(item.episode_number),
            discNumber: optionalNumber(item.disc_number),
            trackNumber: optionalNumber(item.track_number),
            mediaIds: [...item.media_ids],
            // Placeholder until Macha exposes a full date from the metadata provider.
            releaseDate: undefined,
        };
    }
    mapArtwork(items) {
        if (items.length === 0)
            return undefined;
        const byRole = (roles) => {
            const item = items.find((candidate) => roles.includes(candidate.role));
            return item ? { id: item.id, mimeType: item.mime_type } : undefined;
        };
        const result = {
            poster: byRole(['poster', 'cover']),
            backdrop: byRole(['backdrop', 'background', 'fanart']),
            thumbnail: byRole(['still', 'thumbnail', 'thumb']),
        };
        return result.poster || result.backdrop || result.thumbnail ? result : undefined;
    }
    subtitle(item) {
        if (item.kind === 'episode' && item.episode_number !== null) {
            const episode = String(item.episode_number).padStart(2, '0');
            if (item.season_number !== null)
                return `S${String(item.season_number).padStart(2, '0')}E${episode}`;
            return `Episode ${item.episode_number}`;
        }
        if (item.kind === 'season' && item.season_number !== null)
            return `Season ${item.season_number}`;
        if (item.kind === 'track' && item.track_number !== null) {
            return item.disc_number && item.disc_number > 1
                ? `Disc ${item.disc_number} · Track ${item.track_number}`
                : `Track ${item.track_number}`;
        }
        return undefined;
    }
}
