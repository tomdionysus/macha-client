import { describe, expect, it } from 'vitest';
import { isTextEditingElement } from './useTvNavigation';

function element(tagName: string, options: { contentEditable?: boolean; role?: string } = {}) {
  return {
    tagName,
    isContentEditable: options.contentEditable ?? false,
    getAttribute: (name: string) => name === 'role' ? options.role ?? null : null,
  };
}

describe('TV navigation editor policy', () => {
  it('leaves native editing controls in charge of keyboard input', () => {
    expect(isTextEditingElement(element('input'))).toBe(true);
    expect(isTextEditingElement(element('textarea'))).toBe(true);
    expect(isTextEditingElement(element('select'))).toBe(true);
    expect(isTextEditingElement(element('div', { contentEditable: true }))).toBe(true);
    expect(isTextEditingElement(element('div', { role: 'textbox' }))).toBe(true);
  });

  it('continues spatial navigation from ordinary controls', () => {
    expect(isTextEditingElement(element('button'))).toBe(false);
    expect(isTextEditingElement(element('a'))).toBe(false);
    expect(isTextEditingElement(undefined)).toBe(false);
  });
});
