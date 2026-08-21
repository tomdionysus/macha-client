function validTrack(value) {
    if (!value || typeof value !== 'object')
        return false;
    const item = value;
    return item.kind === 'track' && typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.mediaIds);
}
function validEntry(value) {
    if (!value || typeof value !== 'object')
        return false;
    const entry = value;
    return typeof entry.entryId === 'string' && entry.entryId.length > 0 && validTrack(entry.track);
}
function newEntryId(index) {
    return `${Date.now().toString(36)}-${index.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
export class MusicPlaylistStore {
    storage;
    key;
    constructor(clientId, storage = window.localStorage) {
        this.storage = storage;
        this.key = `macha.musicPlaylist.v1.${clientId}`;
    }
    load() {
        const raw = this.storage.getItem(this.key);
        if (!raw)
            return [];
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed) || !parsed.every(validEntry)) {
                this.storage.removeItem(this.key);
                return [];
            }
            return parsed;
        }
        catch {
            this.storage.removeItem(this.key);
            return [];
        }
    }
    add(tracks) {
        const additions = this.entriesFor(tracks);
        if (additions.length === 0)
            return this.load();
        return this.save([...this.load(), ...additions]);
    }
    replace(tracks) {
        return this.save(this.entriesFor(tracks));
    }
    remove(entryId) {
        return this.save(this.load().filter((entry) => entry.entryId !== entryId));
    }
    move(entryId, toIndex) {
        const entries = this.load();
        const fromIndex = entries.findIndex((entry) => entry.entryId === entryId);
        if (fromIndex < 0 || entries.length < 2)
            return entries;
        const bounded = Math.max(0, Math.min(entries.length - 1, toIndex));
        if (fromIndex === bounded)
            return entries;
        const [entry] = entries.splice(fromIndex, 1);
        if (!entry)
            return entries;
        entries.splice(bounded, 0, entry);
        return this.save(entries);
    }
    clear() {
        this.storage.removeItem(this.key);
        return [];
    }
    entriesFor(tracks) {
        return tracks.filter((track) => track.kind === 'track').map((track, index) => ({
            entryId: newEntryId(index),
            track,
        }));
    }
    save(entries) {
        if (entries.length === 0) {
            this.storage.removeItem(this.key);
            return [];
        }
        this.storage.setItem(this.key, JSON.stringify(entries));
        return entries;
    }
}
