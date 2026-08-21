function playable(item) {
    return item.kind === 'movie' || item.kind === 'episode' || item.kind === 'track';
}
function validState(value) {
    if (!value || typeof value !== 'object')
        return false;
    const candidate = value;
    if (!Array.isArray(candidate.items) || candidate.items.length === 0)
        return false;
    if (!candidate.items.every((item) => item && typeof item === 'object' && typeof item.id === 'string' && playable(item)))
        return false;
    return Number.isInteger(candidate.currentIndex)
        && Number(candidate.currentIndex) >= 0
        && Number(candidate.currentIndex) < candidate.items.length
        && typeof candidate.positionMs === 'number'
        && Number.isFinite(candidate.positionMs)
        && typeof candidate.updatedAt === 'number'
        && Number.isFinite(candidate.updatedAt);
}
export class PlaybackQueueStore {
    storage;
    key;
    constructor(clientId, storage = window.localStorage) {
        this.storage = storage;
        this.key = `macha.playbackQueue.v1.${clientId}`;
    }
    load() {
        const raw = this.storage.getItem(this.key);
        if (!raw)
            return undefined;
        try {
            const parsed = JSON.parse(raw);
            if (!validState(parsed)) {
                this.storage.removeItem(this.key);
                return undefined;
            }
            return parsed;
        }
        catch {
            this.storage.removeItem(this.key);
            return undefined;
        }
    }
    replace(items, currentIndex = 0) {
        const playableItems = items.filter(playable);
        if (playableItems.length === 0)
            throw new Error('Playback queue cannot be empty.');
        const boundedIndex = Math.max(0, Math.min(playableItems.length - 1, currentIndex));
        const next = {
            items: playableItems,
            currentIndex: boundedIndex,
            positionMs: 0,
            updatedAt: Date.now(),
        };
        this.storage.setItem(this.key, JSON.stringify(next));
        return next;
    }
    select(currentIndex) {
        const current = this.load();
        if (!current || currentIndex < 0 || currentIndex >= current.items.length)
            return current;
        const next = { ...current, currentIndex, positionMs: 0, updatedAt: Date.now() };
        this.storage.setItem(this.key, JSON.stringify(next));
        return next;
    }
    updatePosition(positionMs) {
        const current = this.load();
        if (!current)
            return undefined;
        const next = { ...current, positionMs: Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0, updatedAt: Date.now() };
        this.storage.setItem(this.key, JSON.stringify(next));
        return next;
    }
    insertNext(items) {
        const additions = items.filter(playable);
        if (additions.length === 0)
            return this.load();
        const current = this.load();
        if (!current)
            return this.replace(additions, 0);
        const insertAt = current.currentIndex + 1;
        const next = {
            ...current,
            items: [...current.items.slice(0, insertAt), ...additions, ...current.items.slice(insertAt)],
            updatedAt: Date.now(),
        };
        this.storage.setItem(this.key, JSON.stringify(next));
        return next;
    }
    append(items) {
        const additions = items.filter(playable);
        if (additions.length === 0)
            return this.load();
        const current = this.load();
        if (!current)
            return this.replace(additions, 0);
        const next = {
            ...current,
            items: [...current.items, ...additions],
            updatedAt: Date.now(),
        };
        this.storage.setItem(this.key, JSON.stringify(next));
        return next;
    }
    clear() {
        this.storage.removeItem(this.key);
    }
}
