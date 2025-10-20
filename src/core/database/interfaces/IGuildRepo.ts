import type { Guild } from "models/Guild";

export interface IGuildRepository {
    getGuild(guildId: string): Promise<Guild | null>;
    initGuild(guildId: string, defaults: Guild): Promise<void>;
    updateGuild(guildId: string, data: Partial<Guild>): Promise<void>;
    toggleScheduler(guildId: string, enabled: boolean, userId: string): Promise<void>;
    getAllGuilds(): Promise<Guild[]>;
}