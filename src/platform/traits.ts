import {
  buildPlatformTraits as resolveBuildTraits,
  platformTraits as resolvePlatformTraits,
  type Platform,
  type PlatformTarget,
  type PlatformTraits,
} from '@machafoundation/core';

/** The build target. `import.meta.env.MODE` is a Vite concern, so it stops here rather than entering core. */
const target: PlatformTarget = ((): PlatformTarget => {
  const mode = import.meta.env.MODE;
  if (mode === 'samsung') return 'samsung';
  if (mode === 'android') return 'android';
  return 'web';
})();

/** A living-room build (Samsung Tizen or Android TV). About audience, where `usesDpadNavigation` is about input. */
export const isTvBuild = target === 'samsung' || target === 'android';

/** Traits knowable from the build alone, before any Platform exists. */
export const buildPlatformTraits = resolveBuildTraits(target);

/** Full traits, once the platform instance can be consulted. */
export function platformTraits(platform: Platform): PlatformTraits {
  return resolvePlatformTraits(target, platform);
}
