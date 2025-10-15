import { db } from "./firestore";
import { GuildScopedRepository } from "./CoreRepo";
import type { IPrizeDrawRepository } from "./interfaces/IPrizeDrawRepo";
import type { PrizeDraw } from "../../models/PrizeDraw";
import { TaskCategory } from "../../models/Task";

export class PrizeDrawRepository extends GuildScopedRepository<PrizeDraw> implements IPrizeDrawRepository {
    constructor(guildId: string) {
        super(guildId, 'prizeDraws');
    }

    async createPrizeDraw(draw: PrizeDraw): Promise<void> {
        await this.collection.doc(draw.id).set(draw);
    }

    async getAllPrizeDraws(): Promise<PrizeDraw[]> {
        const snapshot = await this.collection.orderBy('start', 'desc').get();
        return snapshot.docs.map((doc) => doc.data() as PrizeDraw);
    }

    async getPrizeDrawById(id: string): Promise<PrizeDraw | null> {
        const doc = await this.collection.doc(id).get();
        return doc.exists ? (doc.data() as PrizeDraw) : null;
    }

    async deletePrizeDraw(drawId: string): Promise<void> {
        await this.collection.doc(drawId).delete();
    }

    async clearPrizeDraws(): Promise<void> {
        const snapshot = await this.collection.get();
        const batch = db.batch();
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
        const snap = await docRef.get();

        if (!snap.exists) {
            console.warn(`[PrizeDrawRepository] Prize draw ${drawId} not found`);
            return;
        }

        const data = snap.data() as PrizeDraw;
        const updatedEntries = Array.from(new Set([...(data.entries ?? []), userId]));

        await docRef.update({
            entries: updatedEntries,
            totalEntries: updatedEntries.length,
        });
    }

    async setWinners(
        drawId: string,
        winners: Record<TaskCategory, string[]>
    ): Promise<void> {
        const docRef = this.collection.doc(drawId);
        await docRef.update({
            winners,
            rolledAt: new Date().toISOString(),
        });
    }
}