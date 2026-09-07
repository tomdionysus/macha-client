import {
  buildPlatformTraits as resolveBuildTraits,
  platformTraits as resolvePlatformTraits,
  type Platform,
  type PlatformTarget,
  type PlatformTraits,
} from '@macha/core';

/**
 * Which build this is, and the web binding of the core's trait resolution.
 *
 * The traits themselves are platform-independent; deciding *which* target we
 * are is a Vite concern, so `import.meta.env.MODE` stops here rather than
 * going into the package. Everything above imports the same two names as
 * before, with the target already applied.
 */
const target: PlatformTarget = ((): PlatformTarget => {
  const mode = import.meta.env.MODE;
  if (mode === 'samsung') return 'samsung';
  if (mode === 'android') return 'android';
  return 'web';
})();

/**
 * A living-room build — Samsung Tizen or Android/Google TV.
 *
 * Distinct from `usesDpadNavigation`, which describes input rather than
 * audience: this is for deciding what belongs on a ten-foot interface at all.
 */
export const isTvBuild = target === 'samsung' || target === 'android';

/** Traits knowable from the build alone, before any Platform exists. */
export const buildPlatformTraits = resolveBuildTraits(target);

/** Full traits, once the platform instance can be consulted. */
export function platformTraits(platform: Platform): PlatformTraits {
  return resolvePlatformTraits(target, platform);
}
