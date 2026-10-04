/**
 * The screen's resolution in physical pixels, which core caps automatic play at. Undefined means
 * unknown and must mean no cap: too low a guess denies a viewer a file their screen can show.
 */
export interface DisplayResolution {
  width: number;
  height: number;
}

/** CSS size times device pixel ratio, landscape so an upright phone is not read as tall and narrow. */
export function browserDisplayResolution(view: Pick<Window, 'screen' | 'devicePixelRatio'> = window): DisplayResolution | undefined {
  const ratio = view.devicePixelRatio > 0 ? view.devicePixelRatio : 1;
  const width = Math.round(view.screen.width * ratio);
  const height = Math.round(view.screen.height * ratio);
  if (!(width > 0 && height > 0)) return undefined;
  return { width: Math.max(width, height), height: Math.min(width, height) };
}

/**
 * Always unknown, so uncapped: a Samsung set reports its application surface (1920x1080 on a 4K
 * panel), and the panel size needs webapis.productinfo, which this build does not load.
 */
export function samsungDisplayResolution(): DisplayResolution | undefined {
  return undefined;
}
