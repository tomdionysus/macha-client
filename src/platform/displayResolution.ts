/**
 * The resolution this device's screen actually shows, in physical pixels, for
 * core to cap automatic play at (Tom, 2026-09-25: "cap at the screen
 * resolution for automatic play"). A viewer's own setting overrides it.
 *
 * Undefined means unknown, and unknown must mean no cap: a guess that is too
 * low would quietly deny a viewer the file their screen can show.
 */
export interface DisplayResolution {
  width: number;
  height: number;
}

/**
 * A browser's screen: CSS size times device pixel ratio, taken landscape so a
 * phone held upright is not read as a tall, narrow screen. A browser on a
 * desktop reports the monitor the window is on, which is the one that matters.
 */
export function browserDisplayResolution(view: Pick<Window, 'screen' | 'devicePixelRatio'> = window): DisplayResolution | undefined {
  const ratio = view.devicePixelRatio > 0 ? view.devicePixelRatio : 1;
  const width = Math.round(view.screen.width * ratio);
  const height = Math.round(view.screen.height * ratio);
  if (!(width > 0 && height > 0)) return undefined;
  return { width: Math.max(width, height), height: Math.min(width, height) };
}

/**
 * A Samsung set reports its application surface (1920x1080 on a 4K panel), not
 * its panel, so its screen size would cap every 4K set at 1080p. The panel is
 * known only through webapis.productinfo, which this build does not load yet;
 * until that is added and tried on a set, the display is unknown and uncapped.
 */
export function samsungDisplayResolution(): DisplayResolution | undefined {
  return undefined;
}
