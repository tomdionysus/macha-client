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

/** Long enough that a codec's own quiet passage is never mistaken for a fault. */
const AUDIO_SILENCE_EVIDENCE_MS = 5_000;
/** A still scene still yields frames, so this need only exceed the gap between two `timeupdate` samples. */
const PICTURE_FREEZE_EVIDENCE_MS = 1_500;

/** The source buffers behind an element, by track, as the player created them. */
export type TrackBuffers = () => Partial<Record<string, { buffered: TimeRanges }>> | undefined;

/** One element's decoder counters. Two elements are live across a handover. */
interface DecoderProgress {
  decoded: { audio?: number; video?: number };
  audioStoppedAtMs?: number;
  audioLossReported: boolean;
  frames?: number;
  clockS?: number;
  pictureStoppedAtMs?: number;
  pictureStoppedClockS?: number;
  pictureFreezeReported: boolean;
}

function freshProgress(): DecoderProgress {
  return { decoded: {}, audioLossReported: false, pictureFreezeReported: false };
}

/**
 * Bytes each decoder has consumed: Chromium-only, and the element's only per-pipeline signal.
 * Absent stays absent, since zero would claim the decoder consumed nothing.
 */
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

/** Counts a frame whether it was shown or dropped. */
function frameCounts(video: HTMLVideoElement): { total: number; dropped: number } | undefined {
  if (typeof video.getVideoPlaybackQuality !== 'function') return undefined;
  const quality = video.getVideoPlaybackQuality();
  return { total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames };
}

/** Each track's ranges separately; the element's `buffered` is their intersection and hides which track is short. */
function trackRanges(tracks: TrackBuffers): Record<string, Array<{ start: number; end: number }> | 'removed'> | undefined {
  const sources = tracks();
  if (!sources) return undefined;
  const out: Record<string, Array<{ start: number; end: number }> | 'removed'> = {};
  for (const [name, track] of Object.entries(sources)) {
    if (!track) continue;
    // A source buffer removed from its MediaSource throws on `buffered`.
    try {
      out[name] = ranges(track.buffered);
    } catch {
      out[name] = 'removed';
    }
  }
  return out;
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
    // A hidden tab has its timers throttled, so the player looks hung with nothing buffered and no error.
    hidden: typeof document === 'undefined' ? undefined : document.hidden,
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
  private readonly progress = new WeakMap<HTMLVideoElement, DecoderProgress>();

  constructor(private readonly log: ClientLogger) {}

  private progressOf(video: HTMLVideoElement): DecoderProgress {
    let state = this.progress.get(video);
    if (!state) {
      state = freshProgress();
      this.progress.set(video, state);
    }
    return state;
  }

  /**
   * Reports the audio decoder stopping while the picture carries on (audio bytes frozen, video bytes
   * climbing), for which the element emits no event. Both climbing with no sound is the output path,
   * not the page's fault. Reports only; never acts.
   */
  private noteDecoderProgress(video: HTMLVideoElement, state: DecoderProgress): void {
    const decoded = decodedBytes(video);
    if (decoded.audio === undefined || decoded.video === undefined) return;
    const previous = state.decoded;
    state.decoded = decoded;
    if (previous.audio === undefined || previous.video === undefined) return;
    if (video.paused || video.seeking) {
      state.audioStoppedAtMs = undefined;
      return;
    }
    if (decoded.audio > previous.audio) {
      state.audioStoppedAtMs = undefined;
      state.audioLossReported = false;
      return;
    }
    if (decoded.video <= previous.video) return;
    const now = performance.now();
    if (state.audioStoppedAtMs === undefined) {
      state.audioStoppedAtMs = now;
      return;
    }
    if (state.audioLossReported || now - state.audioStoppedAtMs < AUDIO_SILENCE_EVIDENCE_MS) return;
    state.audioLossReported = true;
    this.log.warn('media-audio-decode-stopped', {
      ...videoState(video),
      silentForMs: Math.round(now - state.audioStoppedAtMs),
    });
  }

  /**
   * Reports the picture holding while the clock runs on. The report carries each track's ranges and
   * the frame counters, which separate a node still producing (nothing buffered at the playhead) from
   * a stopped decoder. A hidden page is never judged: a browser may stop decoding a picture nobody sees.
   */
  private notePictureProgress(video: HTMLVideoElement, state: DecoderProgress, tracks: TrackBuffers): void {
    const frames = frameCounts(video);
    if (!frames) return;
    const previousFrames = state.frames;
    const previousClockS = state.clockS;
    state.frames = frames.total;
    state.clockS = video.currentTime;
    if (previousFrames === undefined || previousClockS === undefined) return;
    const now = performance.now();
    if (frames.total > previousFrames) {
      if (state.pictureFreezeReported && state.pictureStoppedAtMs !== undefined) {
        this.log.warn('media-picture-resumed', {
          ...videoState(video),
          frozenForMs: Math.round(now - state.pictureStoppedAtMs),
          frames,
          trackBuffered: trackRanges(tracks),
        });
      }
      state.pictureStoppedAtMs = undefined;
      state.pictureFreezeReported = false;
      return;
    }
    const hidden = typeof document !== 'undefined' && document.hidden;
    // A clock that did not move is a stall, which the watchdog reports.
    if (video.paused || video.seeking || hidden || video.currentTime <= previousClockS) {
      if (!state.pictureFreezeReported) state.pictureStoppedAtMs = undefined;
      return;
    }
    if (state.pictureStoppedAtMs === undefined) {
      state.pictureStoppedAtMs = now;
      state.pictureStoppedClockS = previousClockS;
      return;
    }
    if (state.pictureFreezeReported || now - state.pictureStoppedAtMs < PICTURE_FREEZE_EVIDENCE_MS) return;
    state.pictureFreezeReported = true;
    this.log.warn('media-picture-stopped', {
      ...videoState(video),
      frozenForMs: Math.round(now - state.pictureStoppedAtMs),
      clockAdvancedMs: Math.round((video.currentTime - (state.pictureStoppedClockS ?? previousClockS)) * 1000),
      frames,
      trackBuffered: trackRanges(tracks),
    });
  }

  attach(video: HTMLVideoElement, readAheadSourceUrl: () => string | undefined, tracks: TrackBuffers = () => undefined): void {
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
        if (name === 'emptied' || name === 'loadstart') this.progress.set(video, freshProgress());
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
      const state = this.progressOf(video);
      this.noteDecoderProgress(video, state);
      this.notePictureProgress(video, state, tracks);
      const now = performance.now();
      if (now - this.lastTimeLogMs < 2_000) return;
      this.lastTimeLogMs = now;
      this.log.debug('media-time', videoState(video));
    });
  }
}
