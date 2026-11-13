import type { Keyword } from "../../../models/Keyword.js";

export interface IKeywordRepository {
    getAllKeywords(): Promise<Keyword[]>;
    getKeywordById(id: string): Promise<Keyword | null>;
    markKeywordUsed(keywordId: string, eventId: string): Promise<void>;
    addKeyword(word: string): Promise<void>;
    deleteKeyword(id: string): Promise<void>;
    resetAllUsage(): Promise<void>;
}



