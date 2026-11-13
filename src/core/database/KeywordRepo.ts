import type { Firestore } from "firebase-admin/firestore";
import { GuildScopedRepository } from "./CoreRepo.js";
import type { Keyword } from "../../models/Keyword.js";
import type { IKeywordRepository } from "./interfaces/IKeywordRepo.js";
import { keywordConverter } from "./converters.js";

export class KeywordRepository extends GuildScopedRepository<Keyword> implements IKeywordRepository {
    constructor(db: Firestore, guildId: string) {
        super(db, guildId, "keywords", keywordConverter);
    }

    async getAllKeywords(): Promise<Keyword[]> {
        const snapshot = await this.collection.get();
        return snapshot.docs.map((doc) => doc.data());
    }

    async getKeywordById(id: string): Promise<Keyword | null> {
        const doc = await this.collection.doc(id).get();
        return doc.data() ?? null;
    }

    async addKeyword(word: string): Promise<void> {
        const id = word.toLowerCase().replace(/\s+/g, "_").replace(/[^\w_]/g, "");
        const newKeyword: Keyword = {
            id,
            word,
            lastUsedAt: new Date(0),
            timesUsed: 0,
            usageHistory: [],
        };

        await this.collection.doc(id).set(newKeyword);
    }

    async deleteKeyword(id: string): Promise<void> {
        await this.collection.doc(id).delete();
    }

    async markKeywordUsed(keywordId: string, eventId: string): Promise<void> {
        const docRef = this.collection.doc(keywordId);
        const data = (await docRef.get()).data();

        if (!data) {
            console.warn(`[KeywordRepo] Keyword ${keywordId} not found`);
            return;
        }

        const updated: Partial<Keyword> = {
            lastUsedEventId: eventId,
            lastUsedAt: new Date(),
            timesUsed: (data.timesUsed ?? 0) + 1,
            usageHistory: [eventId, ...(data.usageHistory ?? [])].slice(0, 20),
        };

        await docRef.update(updated);
    }

    async resetAllUsage(): Promise<void> {
        const snapshot = await this.collection.get();
        const batch = this.db.batch();

        snapshot.docs.forEach((doc) => {
            batch.update(doc.ref, {
                timesUsed: 0,
                lastUsedAt: new Date(0),
                lastUsedEventId: "",
                usageHistory: [],
            });
        });

        await batch.commit();
        console.log(`[KeywordRepo] Reset usage for ${snapshot.size} keywords`);
    }
}