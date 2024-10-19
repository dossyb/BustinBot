require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const botMode = process.env.BOT_MODE || 'dev';
const token = botMode === 'dev' ? process.env.DISCORD_TOKEN_DEV : process.env.DISCORD_TOKEN_LIVE;

if (!token) {
    console.error('Bot token is missing. Please check your environment variables.');
    process.exit(1); // Exit if the token is missing
}

const movieModule = require('./modules/movie');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions] });

client.once('ready', () => {
    console.log(`BustinBot is online in ${botMode} mode!`);
    movieModule.loadMovies();
    movieModule.loadUserMovieCount();
});

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'bustin') {
        message.channel.send('Bustin\' makes me feel good! <a:Bustin:1290456273522921606>');
        return;
    }

    if (command === 'bustinhelp') {
        message.channel.send('Check out the movie commands with `!moviehelp`! <a:Bustin:1290456273522921606>');
    }

    movieModule.handleMovieCommands(message);
});

client.login(token);
