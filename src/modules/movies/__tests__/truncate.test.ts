import { truncate } from "../MovieEmbeds";

describe('truncate', () => {
    it('should not modify short text', () => {
        const result = truncate('Hello world', 20);
        expect(result).toBe('Hello world');
    });

    it('should truncate and add ellipsis when text is too long', () => {
        const input = 'This is a very long sentence that needs to be cut short.';
        const result = truncate(input, 20);
        expect(result).toBe('This is a very lo...');
    });

    it('should handle exact length without truncation', () => {
        const input = '12345';
        const result = truncate(input, 5);
        expect(result).toBe('12345');
    });
})