import type { MediaSummary } from '../types';

export interface PlaybackQueueState {
  items: MediaSummary[];
  currentIndex: number;
  positionMs: number;
  updatedAt: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function playable(item: MediaSummary): boolean {
  return item.kind === 'movie' || item.kind === 'episode' || item.kind === 'track';
}

function validState(value: unknown): value is PlaybackQueueState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PlaybackQueueState>;
  if (!Array.isArray(candidate.items) || candidate.items.length === 0) return false;
  if (!candidate.items.every((item) => item && typeof item === 'object' && typeof item.id === 'string' && playable(item as MediaSummary))) return false;
  return Number.isInteger(candidate.currentIndex)
    && Number(candidate.currentIndex) >= 0
    && Number(candidate.currentIndex) < candidate.items.length
    && typeof candidate.positionMs === 'number'
    && Number.isFinite(candidate.positionMs)
    && typeof candidate.updatedAt === 'number'
    && Number.isFinite(candidate.updatedAt);
}

export class PlaybackQueueStore {
  private readonly key: string;

  constructor(clientId: string, private readonly storage: StorageLike = window.localStorage) {
    this.key = `macha.playbackQueue.v1.${clientId}`;
  }

  load(): PlaybackQueueState | undefined {
    const raw = this.storage.getItem(this.key);
    if (!raw) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!validState(parsed)) {
        this.storage.removeItem(this.key);
        return undefined;
      }
      return parsed;
    } catch {
      this.storage.removeItem(this.key);
      return undefined;
    }
  }

  replace(items: MediaSummary[], currentIndex = 0): PlaybackQueueState {
    const playableItems = items.filter(playable);
    if (playableItems.length === 0) throw new Error('Playback queue cannot be empty.');
    const boundedIndex = Math.max(0, Math.min(playableItems.length - 1, currentIndex));
    const next: PlaybackQueueState = {
      items: playableItems,
      currentIndex: boundedIndex,
      positionMs: 0,
      updatedAt: Date.now(),
    };
    this.storage.setItem(this.key, JSON.stringify(next));
    return next;
  }

  select(currentIndex: number): PlaybackQueueState | undefined {
    const current = this.load();
    if (!current || currentIndex < 0 || currentIndex >= current.items.length) return current;
    const next = { ...current, currentIndex, positionMs: 0, updatedAt: Date.now() };
    this.storage.setItem(this.key, JSON.stringify(next));
    return next;
  }

  updatePosition(positionMs: number): PlaybackQueueState | undefined {
    const current = this.load();
    if (!current) return undefined;
    const next = { ...current, positionMs: Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0, updatedAt: Date.now() };
    this.storage.setItem(this.key, JSON.stringify(next));
    return next;
  }

  insertNext(items: MediaSummary[]): PlaybackQueueState | undefined {
    const additions = items.filter(playable);
    if (additions.length === 0) return this.load();
    const current = this.load();
    if (!current) return this.replace(additions, 0);
    const insertAt = current.currentIndex + 1;
    const next: PlaybackQueueState = {
      ...current,
      items: [...current.items.slice(0, insertAt), ...additions, ...current.items.slice(insertAt)],
      updatedAt: Date.now(),
    };
    this.storage.setItem(this.key, JSON.stringify(next));
    return next;
  }

  append(items: MediaSummary[]): PlaybackQueueState | undefined {
    const additions = items.filter(playable);
    if (additions.length === 0) return this.load();
    const current = this.load();
    if (!current) return this.replace(additions, 0);
    const next: PlaybackQueueState = {
      ...current,
      items: [...current.items, ...additions],
      updatedAt: Date.now(),
    };
    this.storage.setItem(this.key, JSON.stringify(next));
    return next;
  }

  clear(): void {
    this.storage.removeItem(this.key);
  }
}
