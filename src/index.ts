import { REST, Routes, SlashCommandBuilder, Client, GatewayIntentBits, Partials } from 'discord.js';
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

// Recreate __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
config();

// Initialise bot service
const guildId = process.env.DISCORD_GUILD_ID!;
const services = await createServiceContainer(guildId);

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

async function registerSlashCommands(commands: Map<string, Command>) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN_DEV || '');
    const slashCommands = [...commands.values()]
        .filter(cmd => cmd.slashData)
        .map(cmd => cmd.slashData!.toJSON());

    console.log(`Registering ${slashCommands.length} slash command(s)...`);

    await rest.put(
        Routes.applicationGuildCommands(
            process.env.DISCORD_CLIENT_ID!,
            process.env.DISCORD_GUILD_ID!
        ),
        { body: slashCommands }
    );

    console.log('Slash commands registered successfully.');
}

// Load commands from /modules/commands recursively
console.log('Loading commands...');
(async () => {
    const commands = await loadCommands(path.join(__dirname, 'modules', 'commands'));
    console.log(`Loaded ${commands.size} commands.`);
    await registerSlashCommands(commands);

    // Register message handler
    client.on('messageCreate', async (message) => {
        if (message.channel.type === 1) {
            await handleDirectMessage(message, client, services);
        }
        try {
            await handleMessage(message, commands, services);
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });

    // Register interaction handler
    client.on('interactionCreate', async (interaction) => {
        try {
            await handleInteraction(interaction, commands, services);
            await handleMovieInteraction(interaction, services);
            await handleTaskInteraction(interaction, client, services);
        } catch (error) {
            console.error('Error handling interaction:', error);
        }
    });

    // Ready event
    client.once('clientReady', async () => {
        console.log(`Logged in as ${client.user?.tag}!`);
        await scheduleActivePollClosure(services, client);

        const guildRepo = new GuildRepository();
        const guilds = await guildRepo.getAllGuilds();

        for (const guild of guilds) {
            if (guild.toggles?.taskScheduler) {
                console.log(`[Startup] Starting Task Scheduler for ${guild.id}`);

                const guildServices = await createServiceContainer(guild.id);
                initTaskScheduler(client, guildServices);
            }
        }
    });

    // Login to Discord with bot token
    client.login(process.env.DISCORD_TOKEN_DEV);
})();
