require('dotenv').config();

const botMode = process.env.BOT_MODE || 'dev';
const token = botMode === 'dev' ? process.env.DISCORD_TOKEN_DEV : process.env.DISCORD_TOKEN_LIVE;

if (!token) {
    console.error('Bot token is missing. Please check your environment variables.');
    process.exit(1); // Exit if the token is missing
}

const movieModule = require('./modules/movie');
const taskModule = require('./modules/task');
const fs = require('fs');
const pathCounter = './counters.json';
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions] });

function loadCounter() {
    if (!fs.existsSync(pathCounter)) {
        const initialData = { bustinCount: 0 };
        fs.writeFileSync(pathCounter, JSON.stringify(initialData, null, 4), 'utf8');
    }
    const data = fs.readFileSync(pathCounter, 'utf8');
    return JSON.parse(data).bustinCount;
}

function saveCounter() {
    fs.writeFileSync(pathCounter, JSON.stringify({ bustinCount }, null, 4), 'utf8');
}

client.once('ready', () => {
    console.log(`BustinBot is online in ${botMode} mode!`);
    movieModule.loadMovies();
    movieModule.loadUserMovieCount();
    taskModule.schedulePoll(client);
    taskModule.scheduleTaskAnnouncement(client);
    taskModule.scheduleWinnerAnnouncement(client);
});

let bustinCount = loadCounter();

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!')) {
        taskModule.handleTaskSubmissions(message, client);
        return;
    } 

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'bustin') {
        bustinCount++;
        saveCounter();

        message.channel.send('Bustin\' makes me feel good! <a:Bustin:1290456273522921606>');
        return;
    }

    if (command === 'bustincount') {
        loadCounter();
        message.channel.send('`!bustin` has been used ' + `${bustinCount}` + ' time(s)! <a:Bustin:1290456273522921606>');
        return;
    }

    if (command === 'bustinhelp') {
        message.channel.send('Check out the movie commands with `!moviehelp`! <a:Bustin:1290456273522921606>');
    }

    movieModule.handleMovieCommands(message, client);
    await taskModule.handleTaskCommands(message, client);
});

client.login(token);
