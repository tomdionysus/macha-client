import { useEffect } from 'react';

export class PollingTask<T> {
  private active = true;
  private running = 0;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly onValue: (value: T) => void,
    private readonly onError: (error: unknown) => void,
    private readonly allowOverlap = false,
  ) {}

  async run(): Promise<void> {
    if (!this.active || (!this.allowOverlap && this.running > 0)) return;
    this.running += 1;
    try {
      const value = await this.load();
      if (this.active) this.onValue(value);
    } catch (error) {
      if (this.active) this.onError(error);
    } finally {
      this.running -= 1;
    }
  }

  stop(): void {
    this.active = false;
  }
}

export function usePollingTask<T>(options: {
  load: () => Promise<T>;
  onValue: (value: T) => void;
  onError: (error: unknown) => void;
  intervalMs: number;
  dependencies: readonly unknown[];
  allowOverlap?: boolean;
  enabled?: boolean;
}): void {
  useEffect(() => {
    if (options.enabled === false) return undefined;
    const task = new PollingTask(options.load, options.onValue, options.onError, options.allowOverlap);
    void task.run();
    const timer = window.setInterval(() => { void task.run(); }, options.intervalMs);
    return () => {
      task.stop();
      window.clearInterval(timer);
    };
    // Callers explicitly define when the polling task must be recreated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...options.dependencies, options.enabled]);
}
