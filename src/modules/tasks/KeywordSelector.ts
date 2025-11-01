import type { IKeywordRepository } from "../../core/database/interfaces/IKeywordRepo.js";
import type { Keyword } from "../../models/Keyword.js";

const HISTORY_LIMIT = 26;

export class KeywordSelector {
    constructor(private repo: IKeywordRepository) { }

    async selectKeyword(currentEventId: string): Promise<string> {
        const allKeywords: Keyword[] = await this.repo.getAllKeywords();
        if (allKeywords.length === 0) {
            console.warn("[KeywordSelector] No keywords found in Firestore.");
            return "keyword";
        }

        // Sort by lastUsedAt descending to exclude recent keywords
        const sorted = [...allKeywords].sort((a, b) => {
            const timeA = a.lastUsedAt?.toMillis?.() ?? 0;
            const timeB = b.lastUsedAt?.toMillis?.() ?? 0;
            return timeB - timeA;
        });

        const excludeCount = Math.min(HISTORY_LIMIT, sorted.length);
        const recent = sorted.slice(0, excludeCount).map(k => k.id);
        const available = allKeywords.filter(k => !recent.includes(k.id));

        // If all recently used, use full pool
        const pool = available.length > 0 ? available : allKeywords;
        const chosen = pool[Math.floor(Math.random() * pool.length)]!;

        // Mark as used
        await this.repo.markKeywordUsed(chosen.id, currentEventId);

        console.log(`[KeywordSelector] Selected keyword: ${chosen.word}`);
        return chosen.word;
    }
}

