import type { Firestore } from "firebase-admin/firestore";
import { GuildScopedRepository } from "./CoreRepo.js";
import type { IPrizeDrawRepository } from "./interfaces/IPrizeDrawRepo.js";
import type { PrizeDraw } from "../../models/PrizeDraw.js";
import { prizeDrawConverter } from "./converters.js";

export class PrizeDrawRepository extends GuildScopedRepository<PrizeDraw> implements IPrizeDrawRepository {
    constructor(db: Firestore, guildId: string) {
        super(db, guildId, "prizeDraws", prizeDrawConverter);
    }

    async createPrizeDraw(draw: PrizeDraw): Promise<void> {
        await this.collection.doc(draw.id).set(draw);
    }

    async getAllPrizeDraws(): Promise<PrizeDraw[]> {
        const snapshot = await this.collection.orderBy("start", "desc").get();
        return snapshot.docs.map((doc) => doc.data());
    }

    async getPrizeDrawById(id: string): Promise<PrizeDraw | null> {
        const doc = await this.collection.doc(id).get();
        return doc.data() ?? null;
    }

    async deletePrizeDraw(drawId: string): Promise<void> {
        await this.collection.doc(drawId).delete();
    }

    async clearPrizeDraws(): Promise<void> {
        const snapshot = await this.collection.get();
        const batch = this.db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }

    async updateParticipants(
        drawId: string,
        participants: Record<string, number>
    ): Promise<void> {
        const docRef = this.collection.doc(drawId);
        await docRef.update({
            participants,
            totalEntries: Object.values(participants).reduce((a, b) => a + b, 0),
        });
    }


    async addEntry(drawId: string, userId: string): Promise<void> {
        const docRef = this.collection.doc(drawId);
        const data = (await docRef.get()).data();

        if (!data) {
            console.warn(`[PrizeDrawRepository] Prize draw ${drawId} not found`);
            return;
        }

        const updatedEntries = Array.from(new Set([...(data.entries ?? []), userId]));

        await docRef.update({
            entries: updatedEntries,
            totalEntries: updatedEntries.length,
        });
    }

    async setWinner(drawId: string, winnerId: string): Promise<void> {
        await this.collection.doc(drawId).update({
            winnerId,
            rolledAt: new Date().toISOString(),
        });
    }
}