import { sample } from "es-toolkit";
import type { IKeywordRepository } from "../../core/database/interfaces/IKeywordRepo.js";
import type { Keyword } from "../../models/Keyword.js";

const HISTORY_LIMIT = 26;

export class KeywordSelector {
    constructor(private repo: IKeywordRepository) { }

    async selectKeyword(currentEventId: string): Promise<string> {
        const allKeywords: Keyword[] = await this.repo.getAllKeywords();

        // Sort by lastUsedAt descending to exclude recent keywords
        const sorted = allKeywords.toSorted((a, b) => {
            return b.lastUsedAt.getTime() - a.lastUsedAt.getTime();
        });

        const excludeCount = Math.min(HISTORY_LIMIT, sorted.length - 1);
        const recent = sorted.slice(0, excludeCount).map(k => k.id);
        const pool = allKeywords.filter(k => !recent.includes(k.id));
        if (!pool.length) {
            console.warn("[KeywordSelector] No keywords found in Firestore.");
            return "keyword";
        }
        const chosen = sample(pool);

        // Mark as used
        await this.repo.markKeywordUsed(chosen.id, currentEventId);

        console.log(`[KeywordSelector] Selected keyword: ${chosen.word}`);
        return chosen.word;
    }
}

