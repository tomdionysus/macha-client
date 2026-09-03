export type ArtworkRequestPriority = 'foreground' | 'background';

interface QueuedArtworkRequest<T> {
  priority: ArtworkRequestPriority;
  load: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/**
 * Keeps poster hydration from occupying every browser connection. Foreground
 * detail/player artwork may pass queued grid work, while already-started work
 * is never interrupted.
 */
export class ArtworkRequestScheduler {
  private readonly foreground: QueuedArtworkRequest<unknown>[] = [];
  private readonly background: QueuedArtworkRequest<unknown>[] = [];
  private active = 0;

  constructor(private readonly concurrency = 4) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('Artwork request concurrency must be a positive integer.');
    }
  }

  schedule<T>(load: () => Promise<T>, priority: ArtworkRequestPriority): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request: QueuedArtworkRequest<T> = { priority, load, resolve, reject };
      const queue = priority === 'foreground' ? this.foreground : this.background;
      queue.push(request as QueuedArtworkRequest<unknown>);
      this.drain();
    });
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.foreground.length + this.background.length;
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      const request = this.foreground.shift() ?? this.background.shift();
      if (!request) return;
      this.active += 1;
      let result: Promise<unknown>;
      try {
        result = request.load();
      } catch (error) {
        result = Promise.reject(error);
      }
      void result.then(request.resolve, request.reject).finally(() => {
        this.active -= 1;
        this.drain();
      });
    }
  }
}
