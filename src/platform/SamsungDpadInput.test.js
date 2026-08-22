import { describe, expect, it } from 'vitest';
import { samsungDpadCommand } from './SamsungDpadInput';
describe('SamsungDpadInput key mapping', () => {
    it('maps mandatory D-pad, select and Return keys', () => {
        expect(samsungDpadCommand('ArrowLeft', 37)).toBe('left');
        expect(samsungDpadCommand('Enter', 13)).toBe('activate');
        expect(samsungDpadCommand('Back', 10009)).toBe('back');
        expect(samsungDpadCommand('', 10009)).toBe('back');
        expect(samsungDpadCommand('XF86Back', 0)).toBe('back');
    });
});
