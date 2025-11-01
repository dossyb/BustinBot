import { Timestamp } from "firebase-admin/firestore";
import { GuildScopedRepository } from "./CoreRepo.js";
import { db } from "./firestore.js";
import type { Keyword } from "../../models/Keyword.js";
import type { IKeywordRepository } from "./interfaces/IKeywordRepo.js";

export class KeywordRepository extends GuildScopedRepository<Keyword> implements IKeywordRepository {
    constructor(guildId: string) {
        super(guildId, 'keywords');
    }

    async getAllKeywords(): Promise<Keyword[]> {
        const snapshot = await this.collection.get();
        return snapshot.docs.map((doc) => doc.data() as Keyword);
    }

    async getKeywordById(id: string): Promise<Keyword | null> {
        const doc = await this.collection.doc(id).get();
        return doc.exists ? (doc.data() as Keyword) : null;
    }

    async addKeyword(word: string): Promise<void> {
        const id = word.toLowerCase().replace(/\s+/g, "_").replace(/[^\w_]/g, "");
        const newKeyword: Keyword = {
            id,
            word,
            lastUsedAt: Timestamp.fromMillis(0),
            timesUsed: 0,
            usageHistory: [],
        };

        await this.collection.doc(id).set(newKeyword);
    }

    async deleteKeyword(id: string): Promise<void> {
        await this.collection.doc(id).delete();
    }

    async getRandomKeyword(excludeRecentCount = 20): Promise<Keyword | null> {
        const allKeywords = await this.getAllKeywords();

        const sorted = allKeywords.sort(
            (a, b) => b.lastUsedAt.toMillis() - a.lastUsedAt.toMillis()
        );

        const eligible = sorted.slice(excludeRecentCount);

        if (eligible.length === 0) return null;

        const random = eligible[Math.floor(Math.random() * eligible.length)];
        return random ?? null;
    }

    async markKeywordUsed(keywordId: string, eventId: string): Promise<void> {
        const docRef = this.collection.doc(keywordId);
        const doc = await docRef.get();

        if (!doc.exists) {
            console.warn(`[KeywordRepo] Keyword ${keywordId} not found`);
            return;
        }

        const data = doc.data() as Keyword;
        const updated: Partial<Keyword> = {
            lastUsedEventId: eventId,
            lastUsedAt: Timestamp.now(),
            timesUsed: (data.timesUsed ?? 0) + 1,
            usageHistory: [eventId, ...(data.usageHistory ?? [])].slice(0, 20),
        };

        await docRef.update(updated);
    }

    async resetAllUsage(): Promise<void> {
        const snapshot = await this.collection.get();
        const batch = db.batch();

        snapshot.docs.forEach((doc) => {
            const data = doc.data() as Keyword;
            batch.update(doc.ref, {
                timesUsed: 0,
                lastUsedAt: Timestamp.fromMillis(0),
                lastUsedEventId: "",
                usageHistory: [],
            });
        });

        await batch.commit();
        console.log(`[KeywordRepo] Reset usage for ${snapshot.size} keywords`);
    }
}