import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from 'dotenv';
import path from 'path';
import { handleMessage } from './core/events/onMessage';
import { handleInteraction } from './core/events/onInteraction';
import { handleDirectMessage } from './modules/tasks/TaskInteractions';
import { handleTaskInteraction } from './modules/tasks/TaskInteractionHandler';
import { loadCommands } from './core/services/CommandService';
import { registerGuildCommands } from './utils/registerCommands';
import { scheduleActivePollClosure } from './modules/movies/MoviePollScheduler';
import { createServiceContainer } from './core/services/ServiceFactory';
import { GuildRepository } from './core/database/GuildRepo';
import { initTaskScheduler } from './modules/tasks/TaskScheduler';
import { handleMovieInteraction } from './modules/movies/MovieInteractionHandler';
import { initMovieScheduler } from 'modules/movies/MovieScheduler';
import { SchedulerStatusReporter } from 'core/services/SchedulerStatusReporter';
import { getDirname } from 'utils/PathUtils';
const __dirname = getDirname(import.meta.url);

// Load environment variables (only for global secrets)
config();

// Create Discord client with required intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel]
});

// Load commands from /modules/commands recursively
(async () => {
    console.log('Loading commands...');
    const commands = await loadCommands(path.join(__dirname, 'modules', 'commands'));
    console.log(`Loaded ${commands.size} commands.`);

    const guildRepo = new GuildRepository();
    const guildConfigs = await guildRepo.getAllGuilds();
    console.log(`Found ${guildConfigs.length} guild(s) in Firestore.`);

    const servicesByGuild = new Map<string, Awaited<ReturnType<typeof createServiceContainer>>>();
    const getServices = async (guildId: string) => {
        if (!servicesByGuild.has(guildId)) {
            const services = await createServiceContainer(guildId);
            servicesByGuild.set(guildId, services);
        }
        return servicesByGuild.get(guildId)!;
    };

    const primaryGuildId = guildConfigs[0]?.id ?? process.env.DISCORD_GUILD_ID!;
    const isDevMode = process.env.BOT_MODE === 'dev';
    const enableSync = process.env.ENABLE_GUILD_COMMAND_SYNC === 'true' || isDevMode;

    const syncToken = isDevMode
        ? process.env.DISCORD_TOKEN_DEV ?? null
        : process.env.DISCORD_TOKEN_LIVE ?? process.env.DISCORD_TOKEN_DEV ?? null;

    const syncClientId = isDevMode
        ? process.env.DISCORD_CLIENT_ID_DEV ?? null
        : process.env.DISCORD_CLIENT_ID ?? process.env.DISCORD_CLIENT_ID_DEV ?? null;

    const shouldSyncGuildCommands = enableSync && !!syncToken && !!syncClientId && !!primaryGuildId;

    if (shouldSyncGuildCommands && primaryGuildId && syncToken && syncClientId) {
        try {
            await registerGuildCommands({
                modulesDir: path.join(__dirname, 'modules', 'commands'),
                guildId: primaryGuildId,
                token: syncToken,
                clientId: syncClientId,
            });
        } catch (err) {
            console.error('Failed to sync guild slash commands:', err);
        }
    } else if (enableSync) {
        console.warn('[SlashCommands] Skipping guild sync; missing token or client ID env vars.');
    }
    // Register message handler
    client.on('messageCreate', async (message) => {
        try {
            if (message.channel.type === 1) {
                const services = await getServices(message.guildId ?? primaryGuildId);
                await handleDirectMessage(message, client, services);
            } else if (message.guildId) {
                const services = await getServices(message.guildId);
                await handleMessage(message, commands, services);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });

    // Register interaction handler
    client.on('interactionCreate', async (interaction) => {
        try {
            const guildId = interaction.guildId ?? primaryGuildId;
            const guildServices = await getServices(guildId);

            await handleInteraction(interaction, commands, guildServices);
            await handleMovieInteraction(interaction, guildServices);
            await handleTaskInteraction(interaction, client, guildServices);
        } catch (error) {
            console.error('Error handling interaction:', error);
        }
    });

    // Ready event
    client.once('clientReady', async () => {
        console.log(`Logged in as ${client.user?.tag}!`);
        const primaryServices = await createServiceContainer(primaryGuildId);
        await scheduleActivePollClosure(primaryServices, client);

        for (const guild of guildConfigs) {
            if (guild.toggles?.taskScheduler) {
                console.log(`[Startup] Starting Task Scheduler for ${guild.id}`);
                const guildServices = await getServices(guild.id);
                initTaskScheduler(client, guildServices);
            }
        }

        initMovieScheduler(client);
        console.log("[MovieModule] Scheduler and attendance tracking initialised.");

        await SchedulerStatusReporter.logAllUpcoming(primaryServices);
        SchedulerStatusReporter.scheduleDailyLog(primaryServices);

        console.log('All guilds initialised.');
    });

    // Login to Discord with bot token
    client.login(process.env.DISCORD_TOKEN_DEV);
})();
