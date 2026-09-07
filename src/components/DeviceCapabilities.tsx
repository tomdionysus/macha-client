import type { Platform } from '@macha/core';
import { useAsync } from '../hooks/useAsync';

/** Probe results read back on-screen, so "none detected" is distinguishable from "not checked yet". */
function codecList(values: readonly string[] | undefined): string {
  if (values === undefined) return '—';
  return values.length > 0 ? values.join(', ') : 'None detected';
}

/**
 * What this device tells the server it can decode.
 *
 * These are live `canPlayType` probe results, not a fixed profile, and they
 * decide what the server sends: a wrong answer here looks exactly like a
 * server fault from every other vantage point — a silent stream, or a picture
 * that will not decode. A TV that cannot be inspected has no other way to
 * show them, which is the whole reason this is on screen rather than in a log.
 */
export function DeviceCapabilities({ platform }: { platform: Platform }) {
  const capabilities = useAsync(() => platform.capabilities(), [platform]);

  return (
    <article className="settings-status-card">
      <span className="settings-status-label">Playback support</span>
      <strong>{capabilities.loading ? 'Checking…' : capabilities.error ? 'Unavailable' : platform.name}</strong>
      <dl>
        <div><dt>Video</dt><dd>{codecList(capabilities.value?.videoCodecs)}</dd></div>
        <div><dt>Audio</dt><dd>{codecList(capabilities.value?.audioCodecs)}</dd></div>
        {/* Only when they differ from the element's lists — otherwise the delivery
            probe found nothing to say and repeating the rows would imply it had. */}
        {capabilities.value?.hlsVideoCodecs && <div><dt>Video over HLS</dt><dd>{codecList(capabilities.value.hlsVideoCodecs)}</dd></div>}
        {capabilities.value?.hlsAudioCodecs && <div><dt>Audio over HLS</dt><dd>{codecList(capabilities.value.hlsAudioCodecs)}</dd></div>}
        <div><dt>Containers</dt><dd>{codecList(capabilities.value?.containers)}</dd></div>
        <div><dt>HLS fMP4</dt><dd>{capabilities.value ? (capabilities.value.hlsFmp4 ? 'Yes' : 'No') : '—'}</dd></div>
        <div><dt>Colour depth</dt><dd>{capabilities.value?.videoBitDepth ? `${capabilities.value.videoBitDepth}-bit` : '—'}</dd></div>
        <div><dt>HDR</dt><dd>{capabilities.value ? (capabilities.value.hdr.length > 0 ? capabilities.value.hdr.join(', ') : 'Not advertised') : '—'}</dd></div>
        <div><dt>Dolby Vision</dt><dd>{capabilities.value ? (capabilities.value.dolbyVision?.length ? `Profiles ${capabilities.value.dolbyVision.join(', ')}` : 'Not advertised') : '—'}</dd></div>
      </dl>
      {capabilities.error && <p className="settings-status-error">{capabilities.error.message}</p>}
    </article>
  );
}
