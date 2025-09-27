import { REST, Routes, SlashCommandBuilder, Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from 'dotenv';
import path from 'path';
import { handleMessage } from './core/events/onMessage';
import { handleInteraction } from './core/events/onInteraction';
import { loadCommands } from './core/services/CommandService';
import { BotStatsService } from './core/services/BotStatsService';
import type { Command } from './models/Command';
import { fileURLToPath } from 'url';

// Recreate __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
config();

// Initialize bot statistics
BotStatsService.init();

// Create Discord client with required intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
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
        try {
            await handleMessage(message, commands);
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });

    // Register interaction handler
    client.on('interactionCreate', async (interaction) => {
        if (interaction.isChatInputCommand()) {
            try {
                await handleInteraction(interaction, commands);
            } catch (error) {
                console.error('Error handling interaction:', error);
            }
        }
    });

    // Ready event
    client.once('clientReady', () => {
        console.log(`Logged in as ${client.user?.tag}!`);
    });

    // Login to Discord with bot token
    client.login(process.env.DISCORD_TOKEN_DEV);
})();

