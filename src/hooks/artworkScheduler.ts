export type ArtworkRequestPriority = 'visible' | 'nearby';

interface PendingArtworkRequest<T> {
  key: string;
  load: () => Promise<T>;
  priority: ArtworkRequestPriority;
  sequence: number;
  subscribers: number;
  started: boolean;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export interface ArtworkRequestHandle<T> {
  promise: Promise<T>;
  cancel: () => void;
  promote: () => void;
}

function priorityValue(priority: ArtworkRequestPriority): number {
  return priority === 'visible' ? 0 : 1;
}

function abortError(): Error {
  const error = new Error('Artwork request cancelled before it started.');
  error.name = 'AbortError';
  return error;
}

export class ArtworkRequestScheduler<T> {
  private readonly requests = new Map<string, PendingArtworkRequest<T>>();
  private readonly pending: PendingArtworkRequest<T>[] = [];
  private active = 0;
  private sequence = 0;

  constructor(private readonly maxConcurrent = 6) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('Artwork request concurrency must be at least one.');
    }
  }

  request(key: string, load: () => Promise<T>, priority: ArtworkRequestPriority = 'nearby'): ArtworkRequestHandle<T> {
    let request = this.requests.get(key);
    if (request) {
      request.subscribers += 1;
      if (priorityValue(priority) < priorityValue(request.priority)) {
        request.priority = priority;
        this.sortPending();
      }
      return this.handle(request);
    }

    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    request = {
      key,
      load,
      priority,
      sequence: this.sequence++,
      subscribers: 1,
      started: false,
      promise,
      resolve,
      reject,
    };
    this.requests.set(key, request);
    this.pending.push(request);
    this.sortPending();
    this.pump();
    return this.handle(request);
  }

  private handle(request: PendingArtworkRequest<T>): ArtworkRequestHandle<T> {
    let cancelled = false;
    return {
      promise: request.promise,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        request.subscribers = Math.max(0, request.subscribers - 1);
        if (request.subscribers !== 0 || request.started) return;
        const index = this.pending.indexOf(request);
        if (index >= 0) this.pending.splice(index, 1);
        this.requests.delete(request.key);
        request.reject(abortError());
      },
      promote: () => {
        if (request.priority === 'visible') return;
        request.priority = 'visible';
        this.sortPending();
        this.pump();
      },
    };
  }

  private sortPending(): void {
    this.pending.sort((a, b) => priorityValue(a.priority) - priorityValue(b.priority) || a.sequence - b.sequence);
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.pending.length > 0) {
      const request = this.pending.shift()!;
      if (request.subscribers === 0) continue;
      request.started = true;
      this.active += 1;
      void Promise.resolve().then(request.load).then(request.resolve, request.reject).finally(() => {
        this.active -= 1;
        this.requests.delete(request.key);
        this.pump();
      });
    }
  }
}
