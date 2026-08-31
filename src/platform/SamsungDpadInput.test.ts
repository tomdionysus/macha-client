import { describe, expect, it, vi } from 'vitest';
import { SamsungDpadInput, samsungDpadCommand } from './SamsungDpadInput';

describe('SamsungDpadInput key mapping', () => {
  it('maps mandatory D-pad, select and Return keys', () => {
    expect(samsungDpadCommand('ArrowLeft', 37)).toBe('left');
    expect(samsungDpadCommand('Enter', 13)).toBe('activate');
    expect(samsungDpadCommand('Back', 10009)).toBe('back');
    expect(samsungDpadCommand('', 10009)).toBe('back');
    expect(samsungDpadCommand('XF86Back', 0)).toBe('back');
  });

  it('does not suppress repeated keys left to a native editor', () => {
    const listener = vi.fn();
    const target = {
      addEventListener: (_name: string, callback: EventListener) => listener.mockImplementation(callback),
      removeEventListener: vi.fn(),
    } as unknown as Document;
    const handler = vi.fn(() => false);
    const input = new SamsungDpadInput(handler);
    input.attach(target);
    const first = { key: 'ArrowLeft', keyCode: 37, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent;
    const second = { key: 'ArrowLeft', keyCode: 37, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent;

    listener(first);
    listener(second);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(first.preventDefault).not.toHaveBeenCalled();
    expect(second.preventDefault).not.toHaveBeenCalled();
  });
});
