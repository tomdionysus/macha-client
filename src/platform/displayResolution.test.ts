import { describe, expect, it } from 'vitest';
import { browserDisplayResolution, samsungDisplayResolution } from './displayResolution';

const view = (width: number, height: number, devicePixelRatio: number) => ({ screen: { width, height } as Screen, devicePixelRatio });

describe('the screen automatic play is capped at', () => {
  it('counts physical pixels, not CSS ones', () => {
    expect(browserDisplayResolution(view(1920, 1080, 2))).toEqual({ width: 3840, height: 2160 });
    expect(browserDisplayResolution(view(1440, 900, 2))).toEqual({ width: 2880, height: 1800 });
  });

  it('reads a phone held upright as the screen it is on its side', () => {
    expect(browserDisplayResolution(view(390, 844, 3))).toEqual({ width: 2532, height: 1170 });
  });

  it('says nothing, rather than guess low, when the browser reports no screen', () => {
    expect(browserDisplayResolution(view(0, 0, 1))).toBeUndefined();
    expect(browserDisplayResolution(view(1920, 1080, 0))).toEqual({ width: 1920, height: 1080 });
  });

  it('leaves a Samsung set uncapped until its panel can be read', () => {
    expect(samsungDisplayResolution()).toBeUndefined();
  });
});
