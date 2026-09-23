import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The README states the client's version under its title, and it must be the
 * version `package.json` says. A line nobody checks drifts on the first
 * release after it is written; this makes a bump without the README red.
 */
describe('the version the README states', () => {
  it('is the package version, in italics, directly under the title', () => {
    const root = resolve(__dirname, '..');
    const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };
    const lines = readFileSync(resolve(root, 'README.md'), 'utf8').split('\n');
    expect(lines[0]).toBe('# Macha Client');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe(`_v${version}_`);
  });
});
