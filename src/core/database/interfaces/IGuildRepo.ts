import type { Guild } from "models/Guild";

export interface IGuildRepository {
    getGuild(guildId: string): Promise<Guild | null>;
    initGuild(guildId: string, defaults: Guild): Promise<void>;
    updateGuild(guildId: string, data: Partial<Guild>): Promise<void>;
    updateToggle(guildId: string, key: string, enabled: boolean, userId: string): Promise<void>;
    getAllGuilds(): Promise<Guild[]>;
}