const PREFIX = 'macha-client-progress:';
export const CONTINUE_WATCHING_LIMIT = 3;
const FINISHED_THRESHOLD = 0.92;
const MINIMUM_PROGRESS_MS = 30_000;
export class ContinueWatchingStore {
    clientId;
    storage;
    constructor(clientId, storage = localStorage) {
        this.clientId = clientId;
        this.storage = storage;
    }
    list() {
        return this.read()
            .filter((entry) => !isFinished(entry))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, CONTINUE_WATCHING_LIMIT);
    }
    update(progress) {
        const entries = this.read().filter((entry) => entry.mediaId !== progress.mediaId);
        if (!isFinished(progress) && progress.positionMs >= MINIMUM_PROGRESS_MS) {
            entries.unshift(progress);
        }
        const limited = entries
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, CONTINUE_WATCHING_LIMIT);
        this.write(limited);
        return limited;
    }
    clear(mediaId) {
        this.write(this.read().filter((entry) => entry.mediaId !== mediaId));
        return this.list();
    }
    key() {
        return `${PREFIX}${this.clientId}`;
    }
    read() {
        try {
            const value = this.storage.getItem(this.key());
            if (!value)
                return [];
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    write(entries) {
        this.storage.setItem(this.key(), JSON.stringify(entries));
    }
}
export function isFinished(progress) {
    if (progress.durationMs <= 0)
        return false;
    return progress.positionMs / progress.durationMs >= FINISHED_THRESHOLD;
}
