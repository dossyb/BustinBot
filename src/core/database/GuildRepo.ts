import { db } from "./firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { IGuildRepository } from "./interfaces/IGuildRepo";
import type { Guild } from "models/Guild";

export class GuildRepository implements IGuildRepository {
    private readonly collection = db.collection('guilds');

    async getGuild(guildId: string): Promise<Guild | null> {
        const doc = await this.collection.doc(guildId).get();
        return doc.exists ? ({ id: doc.id, ...doc.data() } as Guild) : null;
    }

    async initGuild(guildId: string, defaults: Guild): Promise<void> {
        const existing = await this.collection.doc(guildId).get();
        if (!existing.exists) {
            await this.collection.doc(guildId).set(defaults);
            console.log(`[GuildRepository] Initialized guild config for ${guildId}`);
        }
    }

    async updateGuild(guildId: string, data: Partial<Guild>): Promise<void> {
        await this.collection.doc(guildId).set(
            {
                ...data,
                updatedAt: new Date(),
            },
            { merge: true }
        );
    }

    async updateToggle(guildId: string, key: string, enabled: boolean, userId: string): Promise<void> {
        await this.collection.doc(guildId).update({
            [key]: enabled,
            updatedBy: userId,
            updatedAt: FieldValue.serverTimestamp(),
        });
    }

    async getAllGuilds(): Promise<Guild[]> {
        const snapshot = await this.collection.get();
        return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Guild));
    }
}