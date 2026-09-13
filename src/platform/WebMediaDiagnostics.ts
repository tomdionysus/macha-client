import type { ClientLogger } from '@machafoundation/core';
import { directPlayReadAheadMetrics, setDirectPlayReadAheadMode } from '../playback/directPlayReadAhead';

function ranges(value: TimeRanges): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < value.length; index += 1) {
    out.push({
      start: Math.round(value.start(index) * 1000) / 1000,
      end: Math.round(value.end(index) * 1000) / 1000,
    });
  }
  return out;
}

function stateName(value: number, names: readonly string[]): string {
  return names[value] ?? String(value);
}

/**
 * How many bytes each decoder has actually consumed.
 *
 * Non-standard and Chromium-only, and the only thing an HTML media element
 * will tell you about its two pipelines *separately*. Everything else —
 * `currentTime`, `buffered`, `readyState` — is a property of the element as a
 * whole, so a source whose sound has stopped while the picture continues
 * looks completely healthy through all of it.
 *
 * Absent on an engine that does not expose them, and absent stays absent:
 * reporting zero would read as "the decoder has consumed nothing", which is a
 * different and much more alarming claim than "this browser does not say".
 */
/** Long enough that a codec's own quiet passage is never mistaken for a fault. */
const AUDIO_SILENCE_EVIDENCE_MS = 5_000;

function decodedBytes(video: HTMLVideoElement): { audio?: number; video?: number } {
  const counters = video as HTMLVideoElement & {
    webkitAudioDecodedByteCount?: unknown;
    webkitVideoDecodedByteCount?: unknown;
  };
  const audio = counters.webkitAudioDecodedByteCount;
  const picture = counters.webkitVideoDecodedByteCount;
  return {
    audio: typeof audio === 'number' && Number.isFinite(audio) ? audio : undefined,
    video: typeof picture === 'number' && Number.isFinite(picture) ? picture : undefined,
  };
}

export function videoState(video: HTMLVideoElement): Record<string, unknown> {
  const error = video.error ? { code: video.error.code, message: video.error.message } : undefined;
  return {
    currentTime: Math.round(video.currentTime * 1000) / 1000,
    duration: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) / 1000 : video.duration,
    paused: video.paused,
    ended: video.ended,
    seeking: video.seeking,
    readyState: stateName(video.readyState, ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA']),
    networkState: stateName(video.networkState, ['NETWORK_EMPTY', 'NETWORK_IDLE', 'NETWORK_LOADING', 'NETWORK_NO_SOURCE']),
    buffered: ranges(video.buffered),
    seekable: ranges(video.seekable),
    playbackRate: video.playbackRate,
    currentSrc: video.currentSrc,
    decodedBytes: decodedBytes(video),
    error,
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function errorSummary(value: unknown): Record<string, unknown> | string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Error) return { name: value.name, message: value.message };
  const object = objectValue(value);
  if (Object.keys(object).length > 0) return { name: object.name, message: object.message, code: object.code };
  return String(value);
}

export function hlsEventSummary(value: unknown): Record<string, unknown> {
  const data = objectValue(value);
  const frag = objectValue(data.frag);
  const response = objectValue(data.response);
  const stats = objectValue(data.stats ?? frag.stats);
  return {
    type: data.type,
    details: data.details,
    fatal: data.fatal,
    reason: data.reason,
    sourceBufferName: data.sourceBufferName,
    mimeType: data.mimeType,
    parent: data.parent,
    error: errorSummary(data.error),
    level: data.level ?? frag.level,
    sn: frag.sn,
    start: frag.start,
    duration: frag.duration,
    url: data.url ?? frag.url,
    response: Object.keys(response).length > 0 ? { code: response.code, text: response.text, url: response.url } : undefined,
    stats: Object.keys(stats).length > 0 ? {
      loaded: stats.loaded,
      total: stats.total,
      aborted: stats.aborted,
      loading: stats.loading,
      parsing: stats.parsing,
      buffering: stats.buffering,
    } : undefined,
  };
}

export class WebMediaDiagnostics {
  private lastTimeLogMs = 0;
  private lastProgressLogMs = 0;
  private lastDecoded: { audio?: number; video?: number } = {};
  private audioStoppedAtMs?: number;
  private audioLossReported = false;

  constructor(private readonly log: ClientLogger) {}

  private resetDecoderProgress(): void {
    this.lastDecoded = {};
    this.audioStoppedAtMs = undefined;
    this.audioLossReported = false;
  }

  /**
   * Notice sound stopping while the picture carries on.
   *
   * Nothing else in this client can see it. Every failure channel is driven by
   * something the element emits, and an element whose audio decoder has
   * stopped emits nothing at all: `currentTime` advances, the buffer fills,
   * `readyState` stays at HAVE_ENOUGH_DATA, no `error`, no `stalled`. The
   * stall watchdog is explicitly built not to fire while things are moving,
   * which is correct and also means it will never see this. Reported on the
   * Android TV build 2026-09-09 — sound gone about two minutes into every
   * title, picture unaffected — with no client-side evidence of any kind.
   *
   * This does not fix it and deliberately does not act on it: whether the
   * decoder stopped or the audio simply stopped being audible are different
   * faults with different owners, and the two decoder counters separate them.
   * Audio bytes frozen while video bytes climb is a decoder that has stopped.
   * Both climbing with no sound is the output path — a track, a route, a duck
   * — and nothing in the page is at fault at all.
   */
  private noteDecoderProgress(video: HTMLVideoElement): void {
    const decoded = decodedBytes(video);
    if (decoded.audio === undefined || decoded.video === undefined) return;
    const previous = this.lastDecoded;
    this.lastDecoded = decoded;
    if (previous.audio === undefined || previous.video === undefined) return;
    if (video.paused || video.seeking) {
      this.audioStoppedAtMs = undefined;
      return;
    }
    if (decoded.audio > previous.audio) {
      this.audioStoppedAtMs = undefined;
      this.audioLossReported = false;
      return;
    }
    if (decoded.video <= previous.video) return;
    const now = performance.now();
    if (this.audioStoppedAtMs === undefined) {
      this.audioStoppedAtMs = now;
      return;
    }
    if (this.audioLossReported || now - this.audioStoppedAtMs < AUDIO_SILENCE_EVIDENCE_MS) return;
    this.audioLossReported = true;
    this.log.warn('media-audio-decode-stopped', {
      ...videoState(video),
      silentForMs: Math.round(now - this.audioStoppedAtMs),
    });
  }

  attach(video: HTMLVideoElement, readAheadSourceUrl: () => string | undefined): void {
    const stateEvents = [
      'loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'play', 'pause',
      'waiting', 'stalled', 'suspend', 'seeking', 'seeked', 'ended', 'durationchange', 'ratechange', 'emptied',
      'abort', 'error',
    ] as const;
    for (const name of stateEvents) {
      video.addEventListener(name, () => {
        const sourceUrl = readAheadSourceUrl();
        if (name === 'playing') setDirectPlayReadAheadMode(sourceUrl, 'playing');
        else if (name === 'seeking') setDirectPlayReadAheadMode(sourceUrl, 'seeking');
        else if (name === 'seeked') setDirectPlayReadAheadMode(sourceUrl, video.paused ? 'paused' : 'playing');
        else if (name === 'pause' || name === 'ended') setDirectPlayReadAheadMode(sourceUrl, 'paused');
        const state = videoState(video);
        const readAhead = directPlayReadAheadMetrics(sourceUrl);
        const detail = readAhead ? { ...state, directReadAhead: readAhead } : state;
        if (name === 'emptied' || name === 'loadstart') this.resetDecoderProgress();
        if (name === 'waiting' || name === 'stalled' || name === 'error' || name === 'abort') this.log.warn(`media-${name}`, detail);
        else this.log.debug(`media-${name}`, detail);
      });
    }
    video.addEventListener('progress', () => {
      const now = performance.now();
      if (now - this.lastProgressLogMs < 1_000) return;
      this.lastProgressLogMs = now;
      this.log.debug('media-progress', videoState(video));
    });
    video.addEventListener('timeupdate', () => {
      this.noteDecoderProgress(video);
      const now = performance.now();
      if (now - this.lastTimeLogMs < 2_000) return;
      this.lastTimeLogMs = now;
      this.log.debug('media-time', videoState(video));
    });
  }
}
