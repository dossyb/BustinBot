import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeywordSelector } from '../KeywordSelector.js';

const repo = {
    getAllKeywords: vi.fn(),
    markKeywordUsed: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('KeywordSelector', () => {
    it('returns fallback keyword when none exist', async () => {
        repo.getAllKeywords.mockResolvedValue([]);
        const selector = new KeywordSelector(repo as any);

        const word = await selector.selectKeyword('event-1');
        expect(word).toBe('keyword');
        expect(repo.markKeywordUsed).not.toHaveBeenCalled();
    });

    it('selects keyword excluding recent history and marks usage', async () => {
        const keywords = Array.from({ length: 30 }, (_, i) => ({
            id: `kw-${i}`,
            word: `Word ${i}`,
            lastUsedAt: { toMillis: () => Date.now() - i * 1000 },
        }));

        repo.getAllKeywords.mockResolvedValue(keywords as any);

        const selector = new KeywordSelector(repo as any);
        vi.spyOn(Math, 'random').mockReturnValue(0);

        const selected = await selector.selectKeyword('event-1');
        expect(selected).toBe('Word 26');
        expect(repo.markKeywordUsed).toHaveBeenCalledWith('kw-26', 'event-1');

        (Math.random as any).mockRestore();
    });
});
