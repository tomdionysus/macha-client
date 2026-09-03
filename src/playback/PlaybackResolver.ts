import type { MediaSummary, PlaybackCapabilities, PlaybackMode, PlaybackSource } from '../types';

export type PlaybackStreamType = 'video' | 'audio' | 'subtitle' | 'other';
export type PlaybackTransform = 'copy' | 'transcode' | 'omit';

export interface PlaybackStreamInfo {
  index: number;
  type: PlaybackStreamType;
  codec: string;
  profile: string;
  language: string;
  default: boolean;
  forced: boolean;
  width?: number;
  height?: number;
  channels?: number;
  sampleRate?: number;
  bitDepth?: number;
  bitrate?: number;
}

export interface PlaybackSourceInfo {
  path: string;
  format: string;
  size: number;
  bitrate: number;
  streams: PlaybackStreamInfo[];
}

export interface PlaybackOutputVideoInfo {
  sourceStream: number;
  transform: PlaybackTransform;
  codec?: string;
  profile?: string;
  width?: number;
  height?: number;
  bitrate?: number;
}

export interface PlaybackOutputAudioInfo {
  sourceStream: number;
  transform: PlaybackTransform;
  codec?: string;
  profile?: string;
  channels?: number;
  sampleRate?: number;
  bitDepth?: number;
  bitrate?: number;
}

export interface PlaybackOutputInfo {
  format?: string;
  bitrate?: number;
  video?: PlaybackOutputVideoInfo;
  audio?: PlaybackOutputAudioInfo;
}

export interface PlaybackSelection {
  videoStream: number;
  audioStream: number;
  subtitleStream: number;
}

export interface PlaybackOptions {
  modes: PlaybackMode[];
  qualityHeights: number[];
  mediaIds: string[];
  audioStreams: PlaybackStreamInfo[];
  subtitleStreams: PlaybackStreamInfo[];
  canSeek: boolean;
  canChangeQuality: boolean;
  canSwitchMedia: boolean;
}

export interface PlaybackPreferences {
  mode: PlaybackMode | 'auto';
  maxHeight: number | null;
  maxBitrate: number | null;
  audioStream: number | null;
  subtitleStream: number | null;
  audioLanguage: string;
  subtitleLanguage: string;
}

export interface PlaybackSession {
  sessionId: string;
  /** Node/API provenance for this disposable playback generation. */
  endpoint?: { id: string; baseUrl: string };
  itemId?: string;
  mediaId: string;
  mode: PlaybackMode;
  mimeType: string;
  source: PlaybackSource;
  durationMs: number;
  seekMs: number;
  preferences: PlaybackPreferences;
  sourceInfo: PlaybackSourceInfo;
  output: PlaybackOutputInfo;
  selected: PlaybackSelection;
  transform: {
    video: PlaybackTransform;
    audio: PlaybackTransform;
  };
  options: PlaybackOptions;
}

export interface PlaybackPreferencesUpdate {
  mode?: PlaybackMode | 'auto';
  maxHeight?: number | null;
  maxBitrate?: number | null;
  audioStream?: number | null;
  subtitleStream?: number | null;
  audioLanguage?: string;
  subtitleLanguage?: string;
}

export interface PlaybackUpdate {
  preferences?: PlaybackPreferencesUpdate;
  seekMs?: number;
  mediaId?: string;
}

export interface PlaybackStopOptions {
  /** Keep the teardown request alive while the browser is navigating away. */
  keepalive?: boolean;
}

/** Stable identity for every server lease owned by one persistent player. */
export interface PlaybackAdmissionContext {
  viewerSessionId: string;
}

/** Server-side playback negotiation and session-control seam. */
export interface PlaybackResolver {
  readonly available: boolean;
  resolve(
    media: MediaSummary,
    capabilities: PlaybackCapabilities,
    seekMs?: number,
    preferences?: PlaybackPreferencesUpdate,
    context?: PlaybackAdmissionContext,
  ): Promise<PlaybackSession>;
  update(sessionId: string, update: PlaybackUpdate, signal?: AbortSignal): Promise<PlaybackSession>;
  stop(sessionId: string, options?: PlaybackStopOptions): Promise<void>;
  /** Recreate client-owned playback intent on another node after source failure. */
  failover?(
    failedSession: PlaybackSession,
    media: MediaSummary,
    capabilities: PlaybackCapabilities,
    seekMs: number,
    preferences: PlaybackPreferencesUpdate,
    preparedAlternate?: PlaybackSession,
    context?: PlaybackAdmissionContext,
  ): Promise<PlaybackSession>;
  /** Prepare one bounded standby generation without delaying active playback. */
  prepareAlternate?(
    activeSession: PlaybackSession,
    media: MediaSummary,
    capabilities: PlaybackCapabilities,
    seekMs: number,
    preferences: PlaybackPreferencesUpdate,
    context?: PlaybackAdmissionContext,
  ): Promise<PlaybackSession | undefined>;
}
