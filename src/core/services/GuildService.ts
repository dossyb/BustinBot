import type { Guild } from "../../models/Guild.js";
import type { IGuildRepository } from "../database/interfaces/IGuildRepo.js";
import { ChatInputCommandInteraction, Message, type RepliableInteraction } from "discord.js";

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
        const existing = this.cache.get(guildId);

        const defaultRoles = {
            admin: process.env.ADMIN_ROLE_NAME || "BustinBot Admin",
            movieAdmin: "",
            movieUser: "",
            taskAdmin: "",
            taskUser: "",
        };
        const defaultChannels = {
            announcements: "",
            botArchive: "",
            botLog: "",
            taskChannel: "",
            taskVerification: "",
            movieNight: "",
            movieVC: "",
        };
        const defaultSetup = { core: false, movie: false, task: false };

        // Build merged base from existing (or defaults), then overlay *incoming* data.*
        const mergedBase: Omit<Guild, "updatedBy" | "updatedAt"> = {
            id: guildId,
            toggles: {
                taskScheduler: existing?.toggles?.taskScheduler ?? false,
                leaguesEnabled: existing?.toggles?.leaguesEnabled ?? false,
                ...(data.toggles ?? {}),
            },
            roles: {
                ...(existing?.roles ?? defaultRoles),
                ...(data.roles ?? {}),
            },
            channels: {
                ...(existing?.channels ?? defaultChannels),
                ...(data.channels ?? {}),
            },
            setupComplete: {
                ...(existing?.setupComplete ?? defaultSetup),
                ...(data.setupComplete ?? {}),
            },
            timezone: data.timezone ?? existing?.timezone ?? "UTC",
        };

        const meta: Partial<Pick<Guild, "updatedBy" | "updatedAt">> = {};
        const updatedBy = data.updatedBy ?? existing?.updatedBy;
        const updatedAt = data.updatedAt ?? existing?.updatedAt;
        if (updatedBy !== undefined) meta.updatedBy = updatedBy;
        if (updatedAt !== undefined) meta.updatedAt = updatedAt;

        const merged: Guild = { ...mergedBase, ...meta };

        // Write the fully-merged payload
        await this.repo.updateGuild(guildId, merged);

        // Update cache
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
                admin: process.env.ADMIN_ROLE_NAME || "BustinBot Admin",
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
            setupComplete: existing?.setupComplete ?? { core: false, movie: false, task: false },
            updatedBy: userId,
            updatedAt: new Date() as any,
        };

        this.cache.set(guildId, merged);

        console.log(`[GuildService] Toggled ${key} ${enabled ? "on" : "off"} for ${guildId}`);
    }

    async toggleScheduler(guildId: string, enabled: boolean, userId: string): Promise<void> {
        await this.updateToggle(guildId, "toggles.taskScheduler", enabled, userId);
    }

    async getAll(): Promise<Guild[]> {
        const guilds = await this.repo.getAllGuilds();
        for (const g of guilds) this.cache.set(g.id, g);
        return guilds;
    }

    async refresh(guildId: string): Promise<Guild | null> {
        this.cache.delete(guildId);
        return this.get(guildId);
    }

    async requireConfig(source: ChatInputCommandInteraction | Message | RepliableInteraction): Promise<Guild | null> {
        const guildId = source.guildId;
        if (!guildId) {
            if (source instanceof Message) {
                await source.reply('This command can only be used inside a server.');
            } else {
                await source.reply({ content: 'This command can only be used inside a server.', flags: 1 << 6 });
            }
            return null;
        }

        const guildConfig = await this.get(guildId);

        if (!guildConfig) {
            const replyContent = 'Guild configuration not found. Please run `/setup` first.';

            if (source instanceof Message) {
                await source.reply(replyContent);
            } else {
                await source.reply({ content: replyContent, flags: 1 << 6 });
            }

            return null;
        }

        return guildConfig;
    }

    async ensureExists(guildId: string, userId: string) {
        let guild = await this.get(guildId);
        if (!guild) {
            await this.update(guildId, { updatedBy: userId, updatedAt: new Date() as any });
            guild = await this.get(guildId);
        }
        return guild;
    }

}
