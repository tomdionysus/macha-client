function clampVolume(value) {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}
export class VolumeStore {
    storage;
    key;
    constructor(clientId, storage = window.localStorage) {
        this.storage = storage;
        this.key = `macha.volume.v1.${clientId}`;
    }
    load() {
        const raw = this.storage.getItem(this.key);
        if (raw === null)
            return 1;
        const value = Number(raw);
        return Number.isFinite(value) ? clampVolume(value) : 1;
    }
    save(volume) {
        const value = clampVolume(volume);
        this.storage.setItem(this.key, String(value));
        return value;
    }
}
