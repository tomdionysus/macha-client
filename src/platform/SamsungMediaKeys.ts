export type SamsungMediaCommand = 'play' | 'pause' | 'toggle' | 'previous' | 'next' | 'stop' | 'rewind' | 'fast-forward';

const KEY_COMMANDS: Record<string, SamsungMediaCommand> = {
  MediaPlay: 'play',
  MediaPause: 'pause',
  MediaPlayPause: 'toggle',
  MediaStop: 'stop',
  MediaTrackPrevious: 'previous',
  MediaPreviousTrack: 'previous',
  MediaTrackNext: 'next',
  MediaNextTrack: 'next',
  MediaRewind: 'rewind',
  MediaFastForward: 'fast-forward',
};

const KEYCODE_COMMANDS: Record<number, SamsungMediaCommand> = {
  19: 'pause',
  413: 'stop',
  415: 'play',
  417: 'fast-forward',
  412: 'rewind',
  10232: 'previous',
  10233: 'next',
  10252: 'toggle',
};

export const SAMSUNG_MEDIA_KEYS = [
  'MediaPlay',
  'MediaPause',
  'MediaPlayPause',
  'MediaStop',
  'MediaTrackPrevious',
  'MediaTrackNext',
  'MediaRewind',
  'MediaFastForward',
] as const;

export function samsungMediaCommand(key: string, keyCode: number): SamsungMediaCommand | undefined {
  return KEY_COMMANDS[key] ?? KEYCODE_COMMANDS[keyCode];
}

export function registerSamsungMediaKeys(target: unknown = globalThis): void {
  const tizen = (target as {
    tizen?: { tvinputdevice?: { registerKey?: (key: string) => void } };
  }).tizen;
  const registerKey = tizen?.tvinputdevice?.registerKey;
  if (!registerKey) return;
  for (const key of SAMSUNG_MEDIA_KEYS) {
    try {
      registerKey.call(tizen.tvinputdevice, key);
    } catch {
      // Older sets omit some key names. Register every supported key without
      // allowing one optional key to disable the rest of the transport row.
    }
  }
}
