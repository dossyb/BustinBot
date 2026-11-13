import { ChannelType, type Client, type Interaction, type Message, type VoiceState } from "discord.js";
import cron from "node-cron";
import type { Firestore } from "firebase-admin/firestore";
import { loadCommands } from "./core/services/CommandService.js";
import { handleMessage } from "./core/events/onMessage.js";
import { routeInteraction } from "./core/events/routeInteraction.js";
import { handleDirectMessage } from "./modules/tasks/TaskInteractions.js";
import { registerGuildCommands } from "./utils/registerCommands.js";
import { createServiceContainer } from "./core/services/ServiceFactory.js";
import type { ServiceContainer } from "./core/services/ServiceContainer.js";
import { BotStatsService } from "./core/services/BotStatsService.js";
import { BotRepository } from "./core/database/BotRepo.js";
import { GuildRepository } from "./core/database/GuildRepo.js";
import { initTaskScheduler } from "./modules/tasks/TaskScheduler.js";
import { startMovieScheduler } from "./modules/movies/MovieScheduler.js";
import { SchedulerStatusReporter } from "./core/services/SchedulerStatusReporter.js";

export interface BotOptions {
    db: Firestore;
    commandsDir: string;
    fallbackGuildId: string | null;
    commandSync: { token: string; clientId: string } | null;
}

export async function startBot(
    client: Client,
    { db, commandsDir, fallbackGuildId, commandSync }: BotOptions,
): Promise<() => Promise<void>> {
    // Load commands from /modules/commands recursively
    console.log("Loading commands...");
    const commands = await loadCommands(commandsDir);
    console.log(`Loaded ${commands.size} commands.`);

    const guildRepo = new GuildRepository(db);
    const guildConfigs = await guildRepo.getAllGuilds();
    console.log(`Found ${guildConfigs.length} guild(s) in Firestore.`);

    const botStats = new BotStatsService(new BotRepository(db));
    await botStats.init();

    const servicesByGuild = new Map<string, ServiceContainer>();
    const getServices = (guildId: string): ServiceContainer =>
        servicesByGuild.getOrInsertComputed(guildId, () => createServiceContainer(db, guildId, botStats));

    const primaryGuildId = guildConfigs[0]?.id ?? fallbackGuildId;
    if (!primaryGuildId) {
        throw new Error(
            "No guild ID available. Set DISCORD_GUILD_ID or ensure at least one guild exists in Firestore.",
        );
    }

    if (commandSync) {
        try {
            client.rest.setToken(commandSync.token);
            await registerGuildCommands(client.rest, commandSync.clientId, primaryGuildId, commands);
        } catch (err) {
            console.error("Failed to sync guild slash commands:", err);
        }
    }

    const inProgress = new Set<Promise<void>>();
    const track = (work: () => Promise<void>) => {
        const running = work();
        inProgress.add(running);
        void running.finally(() => inProgress.delete(running));
    };

    // Register message handler
    const onMessageCreate = (message: Message) =>
        track(async () => {
            try {
                if (message.channel.type === ChannelType.DM) {
                    let services: ServiceContainer | undefined;

                    for (const existingServices of servicesByGuild.values()) {
                        if (await existingServices.tasks.hasPendingTask(message.author.id)) {
                            services = existingServices;
                            break;
                        }
                    }

                    if (!services) {
                        // Fall back to the guild the DM originated from (if tracked) or the primary guild.
                        const fallbackGuild = message.guildId ?? primaryGuildId;
                        services = getServices(fallbackGuild);
                    }

                    await handleDirectMessage(message, client, services);
                } else if (message.guildId) {
                    const services = getServices(message.guildId);
                    await handleMessage(message, commands, services);
                }
            } catch (error) {
                console.error("Error handling message:", error);
            }
        });
    client.on("messageCreate", onMessageCreate);

    // Register interaction handler
    const onInteractionCreate = (interaction: Interaction) =>
        track(async () => {
            try {
                const guildId = interaction.guildId ?? primaryGuildId;
                await routeInteraction(interaction, commands, getServices(guildId));
            } catch (error) {
                console.error("Error handling interaction:", error);
            }
        });
    client.on("interactionCreate", onInteractionCreate);

    const onVoiceStateUpdate = (oldState: VoiceState, newState: VoiceState) => {
        getServices(newState.guild.id).movieAttendance.voiceStateChanged(oldState, newState);
    };
    client.on("voiceStateUpdate", onVoiceStateUpdate);

    // Ready event
    let initialised: Promise<void> | undefined;

    const initialiseGuilds = async (): Promise<void> => {
        console.log(`Logged in as ${client.user?.tag}!`);
        const primaryServices = getServices(primaryGuildId);

        for (const guild of guildConfigs) {
            if (guild.toggles?.taskScheduler) {
                console.log(`[Startup] Starting Task Scheduler for ${guild.id}`);
                const guildServices = getServices(guild.id);
                await initTaskScheduler(client, guildServices);
            }
        }

        startMovieScheduler(client, () => client.guilds.cache.map((guild) => getServices(guild.id)));
        console.log("[MovieModule] Movie night scheduler started.");

        await SchedulerStatusReporter.logAllUpcoming(primaryServices);
        SchedulerStatusReporter.scheduleDailyLog(primaryServices);

        console.log("All guilds initialised.");
    };

    client.once("clientReady", () => {
        initialised = initialiseGuilds().catch((err) => {
            console.error("[Startup] Failed to start the schedulers:", err);
        });
    });

    return async () => {
        client.off("messageCreate", onMessageCreate);
        client.off("interactionCreate", onInteractionCreate);
        client.off("voiceStateUpdate", onVoiceStateUpdate);
        await Promise.all(inProgress);
        await initialised;
        await cron.shutdown();
        await client.destroy();
    };
}
