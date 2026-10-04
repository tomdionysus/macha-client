import { describe, expect, it } from 'vitest';
import readme from '../README.md?raw';
import { version } from '../package.json';

/** Fails a version bump that leaves the README behind. */
describe('the version the README states', () => {
  it('is the package version, in italics, directly under the title', () => {
    const lines = readme.split('\n');
    expect(lines[0]).toBe('# Macha Client');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe(`_v${version}_`);
  });
});
