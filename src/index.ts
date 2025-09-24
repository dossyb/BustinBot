import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('clientReady', () => {
    console.log(`Logged in as ${client.user?.tag}!`);
});

// Ping message
client.on('messageCreate', (message) => {
    if (message.content === '!bustin') {
        message.channel.send('Bustin makes me feel good!');
    }
});

client.login(process.env.DISCORD_TOKEN_DEV);