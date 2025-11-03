import { db } from "./firestore.js";
import { FieldValue } from "firebase-admin/firestore";
import type { IGuildRepository } from "./interfaces/IGuildRepo.js";
import type { Guild } from "../../models/Guild.js";

const DEV_FALLBACK_GUILD_ID = "1289517693313220699";

function isDevMode(): boolean {
    return process.env.BOT_MODE === "dev";
}

function getDevGuildId(): string {
    return (
        process.env.DISCORD_GUILD_ID_DEV ??
        process.env.DISCORD_GUILD_ID ??
        DEV_FALLBACK_GUILD_ID
    );
}

function isAllowedGuild(guildId: string): boolean {
    return !isDevMode() || guildId === getDevGuildId();
}

export class GuildRepository implements IGuildRepository {
    private readonly collection = db.collection('guilds');

    async getGuild(guildId: string): Promise<Guild | null> {
        if (!isAllowedGuild(guildId)) {
            return null;
        }

        const doc = await this.collection.doc(guildId).get();
        return doc.exists ? ({ id: doc.id, ...doc.data() } as Guild) : null;
    }

    async initGuild(guildId: string, defaults: Guild): Promise<void> {
        if (!isAllowedGuild(guildId)) {
            console.warn(`[GuildRepository] Skipping init for guild ${guildId} in dev mode.`);
            return;
        }

        const existing = await this.collection.doc(guildId).get();
        if (!existing.exists) {
            await this.collection.doc(guildId).set(defaults);
            console.log(`[GuildRepository] Initialized guild config for ${guildId}`);
        }
    }

    async updateGuild(guildId: string, data: Partial<Guild>): Promise<void> {
        if (!isAllowedGuild(guildId)) {
            console.warn(`[GuildRepository] Skipping update for guild ${guildId} in dev mode.`);
            return;
        }

        await this.collection.doc(guildId).set(
            {
                ...data,
                updatedAt: new Date(),
            },
            { merge: true }
        );
    }

    async updateToggle(guildId: string, key: string, enabled: boolean, userId: string): Promise<void> {
        if (!isAllowedGuild(guildId)) {
            console.warn(`[GuildRepository] Skipping toggle update for guild ${guildId} in dev mode.`);
            return;
        }

        await this.collection.doc(guildId).update({
            [key]: enabled,
            updatedBy: userId,
            updatedAt: FieldValue.serverTimestamp(),
        });
    }

    async getAllGuilds(): Promise<Guild[]> {
        const snapshot = await this.collection.get();
        const guilds = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Guild));

        if (isDevMode()) {
            const devGuildId = getDevGuildId();
            return guilds.filter((guild) => guild.id === devGuildId);
        }

        return guilds;
    }
}
