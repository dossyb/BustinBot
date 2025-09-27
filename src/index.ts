import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from 'dotenv';
import path from 'path';
import { handleMessage } from './core/events/onMessage';
import { loadCommands } from './core/services/CommandService';
import { fileURLToPath } from 'url';

// Recreate __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
config();

// Create Discord client with required intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel]
});

// Load commands from /modules/commands recursively
console.log('Loading commands...');
(async () => {
    const commands = await loadCommands(path.join(__dirname, 'modules', 'commands'));
    console.log(`Loaded ${commands.size} commands.`);
    
    // Register message handler
    client.on('messageCreate', async (message) => {
        try {
            await handleMessage(message, commands);
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });

    // Ready event
    client.once('clientReady', () => {
        console.log(`Logged in as ${client.user?.tag}!`);
    });

    // Login to Discord with bot token
    client.login(process.env.DISCORD_TOKEN_DEV);
})();

