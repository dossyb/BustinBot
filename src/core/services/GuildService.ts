import type { Guild } from "models/Guild";
import type { IGuildRepository } from "core/database/interfaces/IGuildRepo";

export class GuildService {
    private cache = new Map<string, Guild>();

    constructor(private readonly repo: IGuildRepository) { }

    async get(guildId: string): Promise<Guild | null> {
        if (this.cache.has(guildId)) {
            return this.cache.get(guildId)!;
        }

        const guild = await this.repo.getGuild(guildId);
        if (guild) this.cache.set(guildId, guild);
        return guild;
    }

    async update(guildId: string, data: Partial<Guild>): Promise<void> {
        await this.repo.updateGuild(guildId, data);

        const existing = this.cache.get(guildId);

        // base structure (everything that's always required)
        const mergedBase: Omit<Guild, "updatedBy" | "updatedAt"> = {
            id: guildId,
            toggles: {
                taskScheduler: existing?.toggles?.taskScheduler ?? false,
                leaguesEnabled: existing?.toggles?.leaguesEnabled ?? false,
                ...(data.toggles ?? {}),
            },
            roles: existing?.roles ?? {
                admin: "",
                movieAdmin: "",
                movieUser: "",
                taskAdmin: "",
                taskUser: "",
            },
            channels: existing?.channels ?? {
                announcements: "",
                botArchive: "",
                botLog: "",
                taskChannel: "",
                taskVerification: "",
                movieNight: "",
                movieVC: "",
            },
            setupComplete: data.setupComplete ?? existing?.setupComplete ?? false,
        };

        // optional fields must be *conditionally* added
        const meta: Partial<Pick<Guild, "updatedBy" | "updatedAt">> = {};
        const updatedBy = data.updatedBy ?? existing?.updatedBy;
        const updatedAt = data.updatedAt ?? existing?.updatedAt;

        if (updatedBy !== undefined) meta.updatedBy = updatedBy;
        if (updatedAt !== undefined) meta.updatedAt = updatedAt;

        const merged: Guild = { ...mergedBase, ...meta };

        this.cache.set(guildId, merged);
    }

    async updateToggle(guildId: string, key: string, enabled: boolean, userId: string): Promise<void> {
        await this.repo.updateToggle(guildId, key, enabled, userId);

        const existing = this.cache.get(guildId);

        const toggles = {
            ...(existing?.toggles ?? {}),
            // Extract last part of key if nested (e.g. "toggles.leaguesEnabled")
            [key.split(".").pop()!]: enabled,
        };

        const merged: Guild = {
            id: guildId,
            toggles: {
                taskScheduler: existing?.toggles?.taskScheduler ?? false,
                leaguesEnabled: existing?.toggles?.leaguesEnabled ?? false,
                [key.split(".").pop()!]: enabled,
            },
            roles: existing?.roles ?? {
                admin: "",
                movieAdmin: "",
                movieUser: "",
                taskAdmin: "",
                taskUser: "",
            },
            channels: existing?.channels ?? {
                announcements: "",
                botArchive: "",
                botLog: "",
                taskChannel: "",
                taskVerification: "",
                movieNight: "",
                movieVC: "",
            },
            setupComplete: existing?.setupComplete ?? false,
            updatedBy: userId,
            updatedAt: new Date() as any,
        };

        this.cache.set(guildId, merged);

        console.log(`[GuildService] Toggled ${key} ${enabled ? "on" : "off"} for ${guildId}`);
    }

    async getAll(): Promise<Guild[]> {
        const guilds = await this.repo.getAllGuilds();
        for (const g of guilds) this.cache.set(g.id, g);
        return guilds;
    }
}