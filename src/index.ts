import { REST, Routes, Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from 'dotenv';
import path from 'path';
import { handleMessage } from './core/events/onMessage';
import { handleInteraction } from './core/events/onInteraction';
import { handleDirectMessage } from './modules/tasks/TaskInteractions';
import { handleTaskInteraction } from './modules/tasks/TaskInteractionHandler';
import { loadCommands } from './core/services/CommandService';
import type { Command } from './models/Command';
import { fileURLToPath } from 'url';
import { scheduleActivePollClosure } from './modules/movies/MoviePollScheduler';
import { createServiceContainer } from './core/services/ServiceFactory';
import { GuildRepository } from './core/database/GuildRepo';
import { initTaskScheduler } from './modules/tasks/TaskScheduler';
import { handleMovieInteraction } from './modules/movies/MovieInteractionHandler';
import { initMovieScheduler } from 'modules/movies/MovieScheduler';
import { SchedulerStatusReporter } from 'core/services/SchedulerStatusReporter';

// Recreate __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

async function registerSlashCommands(commands: Map<string, Command>, guildId: string) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN_DEV || '');
    const clientId = process.env.DISCORD_CLIENT_ID!;

    const slashCommands = [...commands.values()]
        .filter(cmd => cmd.slashData)
        .map(cmd => cmd.slashData!.toJSON());

    console.log(`Registering ${slashCommands.length} slash command(s)...`);

    await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: slashCommands }
    );

    if (process.env.BOT_MODE !== 'dev') {
        await rest.put(
            Routes.applicationCommands(clientId),
            { body: slashCommands }
        );
        console.log(`🌍 Registered ${slashCommands.length} commands globally, waiting 1 hour until cleanup...`);

        setTimeout(async () => {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(clientId, guildId),
                    { body: [] }
                );
                console.log(`🧹 Cleared guild-specific commands for ${guildId}`);
            } catch (err) {
                console.error('Failed to clean up guild commands:', err);
            }
        }, 60 * 60 * 1000);
    }

    console.log('Slash commands registered successfully.');
}

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
    await registerSlashCommands(commands, primaryGuildId);

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
