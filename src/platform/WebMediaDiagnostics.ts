import type { ClientLogger } from '@macha/core';
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

  constructor(private readonly log: ClientLogger) {}

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
      const now = performance.now();
      if (now - this.lastTimeLogMs < 2_000) return;
      this.lastTimeLogMs = now;
      this.log.debug('media-time', videoState(video));
    });
  }
}
