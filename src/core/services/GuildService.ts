import type { Guild } from "../../models/Guild.js";
import type { IGuildRepository } from "../database/interfaces/IGuildRepo.js";
import { ChatInputCommandInteraction, Message, type RepliableInteraction, MessageFlags } from "discord.js";

const DEFAULT_TASK_MILESTONE_ROLES = [
    { id: "task-participant", label: "Task Participant", roleId: "", requiredSubmissions: 5, enabled: true },
    { id: "task-enthusiast", label: "Task Enthusiast", roleId: "", requiredSubmissions: 25, enabled: true },
    { id: "task-expert", label: "Task Expert", roleId: "", requiredSubmissions: 50, enabled: true },
    { id: "task-master", label: "Task Master", roleId: "", requiredSubmissions: 100, enabled: true },
];

const DEFAULT_TASK_SETTINGS = {
    periodEvents: 4,
    milestoneRoles: DEFAULT_TASK_MILESTONE_ROLES,
    championRoles: {
        first: true,
        second: true,
        third: true,
    },
};

export class GuildService {
    private cache = new Map<string, Guild>();

    constructor(private readonly repo: IGuildRepository) { }

    async get(guildId: string): Promise<Guild | null> {
        const cached = this.cache.get(guildId);
        if (cached) return cached;

        const guild = await this.repo.getGuild(guildId);
        if (guild) this.cache.set(guildId, guild);
        return guild;
    }

    async update(guildId: string, data: Partial<Guild>): Promise<void> {
        const existing = await this.get(guildId);
        const mentionSuppressedUntilMs =
            data.mentionSuppressedUntilMs ??
            existing?.mentionSuppressedUntilMs;

        const defaultRoles = {
            admin: process.env.ADMIN_ROLE_NAME || "BustinBot Admin",
            movieAdmin: "",
            movieUser: "",
            taskAdmin: "",
            taskUser: "",
            taskChampionFirst: "",
            taskChampionSecond: "",
            taskChampionThird: "",
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
        const defaultTaskSettings = DEFAULT_TASK_SETTINGS;

        // Build merged base from existing (or defaults), then overlay *incoming* data.*
        const mergedBase: Omit<Guild, "updatedBy" | "updatedAt"> = {
            id: guildId,
            toggles: {
                taskScheduler: false,
                leaguesEnabled: false,
                ...(existing?.toggles ?? {}),
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
            taskSettings: {
                ...defaultTaskSettings,
                ...(existing?.taskSettings ?? {}),
                ...(data.taskSettings ?? {}),
                championRoles: {
                    ...defaultTaskSettings.championRoles,
                    ...(existing?.taskSettings?.championRoles ?? {}),
                    ...(data.taskSettings?.championRoles ?? {}),
                },
            },
            timezone: data.timezone ?? existing?.timezone ?? "UTC",
            ...(mentionSuppressedUntilMs !== undefined
                ? { mentionSuppressedUntilMs }
                : {}),
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

    async updateToggle(guildId: string, toggle: keyof Guild["toggles"], enabled: boolean, userId: string): Promise<void> {
        await this.repo.updateToggle(guildId, toggle, enabled, userId);

        const existing = this.cache.get(guildId);
        if (existing) {
            this.cache.set(guildId, {
                ...existing,
                toggles: { ...existing.toggles, [toggle]: enabled },
                updatedBy: userId,
            });
        }

        console.log(`[GuildService] Toggled ${toggle} ${enabled ? "on" : "off"} for ${guildId}`);
    }

    async toggleScheduler(guildId: string, enabled: boolean, userId: string): Promise<void> {
        await this.updateToggle(guildId, "taskScheduler", enabled, userId);
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
                await source.reply("This command can only be used inside a server.");
            } else {
                await source.reply({ content: "This command can only be used inside a server.", flags: MessageFlags.Ephemeral });
            }
            return null;
        }

        const guildConfig = await this.get(guildId);

        if (!guildConfig) {
            const replyContent = "Guild configuration not found. Please run `/setup` first.";

            if (source instanceof Message) {
                await source.reply(replyContent);
            } else {
                await source.reply({ content: replyContent, flags: MessageFlags.Ephemeral });
            }

            return null;
        }

        return guildConfig;
    }

    async ensureExists(guildId: string, userId: string) {
        let guild = await this.get(guildId);
        if (!guild) {
            await this.update(guildId, { updatedBy: userId, updatedAt: new Date() });
            guild = await this.get(guildId);
        }
        return guild;
    }

}
