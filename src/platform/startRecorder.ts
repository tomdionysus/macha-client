/**
 * Records what a start did before its first frame, for an element that accepts
 * a source and never leaves HAVE_NOTHING. Armed before the source is set; reports once.
 * Pure: the clock and the request list are handed in.
 */

export type StartRole = 'primary' | 'handover' | 'relocation';
export type StartOutcome = 'first-frame' | 'failed' | 'abandoned' | 'no-first-frame';

export interface StartSample {
  readyState: number;
  networkState: number;
  bufferedEndS?: number;
  hidden: boolean;
}

/** The Resource Timing fields read; cross-origin entries keep them. */
export interface StartRequestEntry {
  name: string;
  startTime: number;
  responseEnd: number;
}

export interface StartRecord {
  role: StartRole;
  url: string;
  outcome: StartOutcome;
  elapsedMs: number;
  timeline: string[];
  hls: string[];
  /** Requests under this session's path begun after arming. Absent means unobservable, not none. */
  requests?: { count: number; firstAtMs?: number; lastEndMs?: number };
  /** Timeline lines not kept because the record hit its bound. */
  dropped: number;
}

/** Enough for two minutes of a state that keeps changing. */
const TIMELINE_LIMIT = 80;
const HLS_LIMIT = 20;
/** Below this a first frame is ordinary and not worth a line. */
export const SLOW_START_MS = 3_000;
/** A start replaced sooner than this is a seek or a stop, not a stall. */
const ABANDONED_REPORT_MS = 2_000;

export function shouldReportStart(record: Pick<StartRecord, 'outcome' | 'elapsedMs'>): boolean {
  if (record.outcome === 'first-frame') return record.elapsedMs >= SLOW_START_MS;
  if (record.outcome === 'abandoned') return record.elapsedMs >= ABANDONED_REPORT_MS;
  return true;
}

function describeState(sample: StartSample): string {
  const buffered = sample.bufferedEndS === undefined ? '' : ` buf${Math.round(sample.bufferedEndS * 10) / 10}`;
  return `rs${sample.readyState}/ns${sample.networkState}${buffered}${sample.hidden ? ' hidden' : ''}`;
}

/** The session's own path, which every manifest, playlist and fragment of it sits under. */
function sessionPrefix(url: string): string {
  const match = /^(.*\/playback\/sessions\/[^/]+\/)/.exec(url);
  return match ? match[1] : url;
}

/** Enough of a fragment URL to tell which one, without the session id twice over. */
function urlTail(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0) return '';
  const parts = url.split('?')[0].split('/').filter(Boolean);
  return ` .../${parts.slice(-2).join('/')}`;
}

export class StartRecorder {
  private readonly armedAt: number;
  private readonly timeline: string[] = [];
  private readonly hls: string[] = [];
  private dropped = 0;
  private lastSample?: string;
  private done = false;

  constructor(
    readonly role: StartRole,
    readonly url: string,
    private readonly now: () => number,
  ) {
    this.armedAt = now();
  }

  get finished(): boolean {
    return this.done;
  }

  private offset(): number {
    return Math.round(this.now() - this.armedAt);
  }

  private push(line: string): void {
    if (this.done) return;
    if (this.timeline.length >= TIMELINE_LIMIT) {
      this.dropped += 1;
      return;
    }
    this.timeline.push(line);
  }

  event(name: string, sample: StartSample): void {
    const state = describeState(sample);
    this.lastSample = state;
    this.push(`+${this.offset()} ${name} ${state}`);
  }

  /** Called on a timer. Kept only when the state moved, so a minute of nothing is one line. */
  sample(sample: StartSample): void {
    const state = describeState(sample);
    if (state === this.lastSample) return;
    this.lastSample = state;
    this.push(`+${this.offset()} sample ${state}`);
  }

  /** hls.js fragment start and finish. Resource Timing lists a request only once its response ends, so an `asked` with no `got` is in flight. */
  fragment(phase: 'asked' | 'got', sn: unknown): void {
    this.push(`+${this.offset()} frag-${phase} sn${String(sn)}`);
  }

  hlsError(data: { details?: unknown; fatal?: unknown; response?: { code?: unknown }; url?: unknown }): void {
    if (this.done || this.hls.length >= HLS_LIMIT) return;
    const code = data.response?.code === undefined ? '' : ` ${String(data.response.code)}`;
    const fatal = data.fatal === true ? ' fatal' : '';
    this.hls.push(`+${this.offset()} ${String(data.details ?? 'unknown')}${fatal}${code}${urlTail(data.url)}`);
  }

  /** The record, once; later calls answer `undefined`. `entries` is `undefined` when requests could not be observed. */
  finish(outcome: StartOutcome, entries: readonly StartRequestEntry[] | undefined): StartRecord | undefined {
    if (this.done) return undefined;
    this.done = true;
    const prefix = sessionPrefix(this.url);
    const ours = (entries ?? []).filter((entry) => entry.startTime >= this.armedAt && entry.name.startsWith(prefix));
    return {
      role: this.role,
      url: this.url,
      outcome,
      elapsedMs: this.offset(),
      timeline: [...this.timeline],
      hls: [...this.hls],
      requests: entries === undefined
        ? undefined
        : ours.length === 0
        ? { count: 0 }
        : {
            count: ours.length,
            firstAtMs: Math.round(Math.min(...ours.map((entry) => entry.startTime)) - this.armedAt),
            lastEndMs: Math.round(Math.max(...ours.map((entry) => entry.responseEnd)) - this.armedAt),
          },
      dropped: this.dropped,
    };
  }
}
