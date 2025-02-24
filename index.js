require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const botMode = process.env.BOT_MODE || 'dev';
const token = botMode === 'dev' ? process.env.DISCORD_TOKEN_DEV : process.env.DISCORD_TOKEN_LIVE;

if (!token) {
    console.error('Bot token is missing. Please check your environment variables.');
    process.exit(1); // Exit if the token is missing
}

const emoteUtils = require('./modules/utils/emote');
const movieModule = require('./modules/movie');
const taskModule = require('./modules/task');

const pathCounter = './data/counters.json';
const versionFilePath = path.join(__dirname, 'data/version.json');
const changelogFilePath = path.join(__dirname, 'CHANGELOG.md');

const logDir = path.join(__dirname, 'logs');
const logFileName = `bustinbot-${new Date().toISOString().replace(/:/g, '-')}.log`;
const logFilePath = path.join(logDir, logFileName);

if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

let logBuffer = [];

// Override console methods
['log', 'warn', 'error', 'info'].forEach((method) => {
    const originalMethod = console[method];
    console[method] = (...args) => {
        const message = `[${new Date().toISOString()}] [${method.toUpperCase()}] ${args.join(' ')}`;
        logBuffer.push(message);

        // Write to log stream and call original method
        originalMethod.apply(console, args);
    };
});

// Periodically write log buffer to file
setInterval(() => {
    if (logBuffer.length > 0) {
        logStream.write(logBuffer.join('\n') + '\n');
        logBuffer = [];
    }
}, 5000);

// Ensure logs are flushed before exiting
function flushLogsOnExit() {
    if (logBuffer.length > 0) {
        logStream.write(logBuffer.join('\n') + '\n');
        logBuffer = [];
    }

    logStream.end();
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions] });

function loadCounter() {
    if (!fs.existsSync(pathCounter)) {
        const initialData = { bustinCount: 0, goodbotCount: 0, badbotCount: 0 };
        fs.writeFileSync(pathCounter, JSON.stringify(initialData, null, 4), 'utf8');
    }
    const data = fs.readFileSync(pathCounter, 'utf8');
    return JSON.parse(data);
}

// Save the counter data independent of the command used
function saveCounter(count) {
    const data = { bustinCount: bustinCount, goodbotCount: goodbotCount, badbotCount: badbotCount };
    fs.writeFileSync(pathCounter, JSON.stringify(data, null, 4), 'utf8');
}

const versionData = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
const currentVersion = versionData.version;

client.once('ready', () => {
    console.log(`BustinBot is online in ${botMode} mode!`);
    console.log('Active');

    emoteUtils.initialise(client);

    // Movie module
    movieModule.loadMovies();
    movieModule.loadUserMovieCount();

    // Testing task module
    // taskModule.testPollLaunch(client);

    // Task module production
    taskModule.initialiseTaskUserFiles();
    taskModule.loadPollData(client);
    taskModule.schedulePoll(client);
    taskModule.scheduleTaskAnnouncement(client);
    taskModule.scheduleWinnerAnnouncement(client);
    taskModule.startPeriodicStatusUpdates(client);

    const envFilePath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envFilePath, 'utf8');

    let instanceVersion = process.env.CURRENT_VERSION || '1.0.0';
    if (!envContent.includes('CURRENT_VERSION')) {
        // Add CURRENT_VERSION to .env file if it doesn't exist
        envContent += `\nCURRENT_VERSION=1.0.0`;
        fs.writeFileSync(envFilePath, envContent, 'utf8');
        console.log('Added CURRENT_VERSION to .env file.');
    }

    if (instanceVersion !== currentVersion) {
        // Read changelog
        const changelog = fs.readFileSync(changelogFilePath, 'utf8');
        const versionChanges = extractChangesForVersion(changelog, currentVersion);

        // Announce update
        const botsChannel = client.channels.cache.find(channel => channel.name === 'bots');
        const announcement = `
        BustinBot v${currentVersion} is now live! ${emoteUtils.getBustinEmote()}\n\n${versionChanges}`;

        if (botsChannel) {
            botsChannel.send(announcement);
        }

        console.log(announcement);

        // Update version file
        envContent = envContent.replace(/CURRENT_VERSION=.*/, `CURRENT_VERSION=${currentVersion}`);
        fs.writeFileSync(envFilePath, envContent, 'utf8');
    }
});

function extractChangesForVersion(changelog, version) {
    const versionHeader = `# v${version}`;
    const startIndex = changelog.indexOf(versionHeader);
    if (startIndex === -1) {
        return 'No changelog found for this version.';
    }

    const endIndex = changelog.indexOf('# v', startIndex + versionHeader.length);
    let versionChanges = changelog.substring(startIndex, endIndex === -1 ? changelog.length : endIndex).trim();

    // Remove version header
    versionChanges = versionChanges.replace(versionHeader, '**Changelog:**').trim();

    // Change markdown list formatting to bullet points
    versionChanges = versionChanges.replace(/^- /gm, '- ');

    // Italicise each module subheading
    versionChanges = versionChanges.replace(/^## (.+)$/gm, '*$1*');

    return versionChanges;
}

let bustinCount = loadCounter().bustinCount;
let goodbotCount = loadCounter().goodbotCount;
let badbotCount = loadCounter().badbotCount;

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const bustinEmote = emoteUtils.getBustinEmote();
    const sadEmote = emoteUtils.getSadEmote();
    const bedgeEmote = emoteUtils.getBedgeEmote();

    if (/\b(sleep)\b/i.test(message.content)) {
        const chance = Math.random();
        if (chance < 0.05) {
            message.channel.send(`I ain\'t afraid of no sleep! ${bedgeEmote}`);
            return;
        }
        if (chance > 0.05 && chance < 0.1) {
            message.channel.send(`I ain\'t afraid of no bed! ${bedgeEmote}`);
            return;
        }
        if (chance > 0.1 && chance < 0.15) {
            message.channel.send(`Sleepin\' makes me feel good! ${bedgeEmote}`);
            return;
        }
        return;
    }

    if (!message.content.startsWith('!')) {
        taskModule.handleTaskSubmissions(message, client);
        return;
    }

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'bustin') {
        bustinCount++;
        saveCounter(bustinCount);

        message.channel.send(`Bustin\' makes me feel good! ${bustinEmote}`);
        console.log(`${message.author.username} busted!`);
        return;
    }

    if (command === 'bustincount') {
        loadCounter();
        message.channel.send('`!bustin` has been used ' + `${bustinCount}` + ` time(s)! ${bustinEmote}`);
        return;
    }

    if (command === 'goodbot') {
        goodbotCount++;
        saveCounter(goodbotCount);
        message.reply(`${bustinEmote}`);
        message.channel.send(`*BustinBot has been called a good bot ${goodbotCount} time(s)!*`);

        console.log(`${message.author.username} made BustinBot feel good!`);
    }

    if (command === 'badbot') {
        badbotCount++;
        saveCounter(badbotCount);
        message.reply(`${sadEmote}`);
        message.channel.send(`*BustinBot has been called a bad bot ${badbotCount} time(s)!*`);

        console.log(`${message.author.username} feels something weird sleeping in their bed!`);
    }

    if (command === 'bustinhelp') {
        message.reply(`Check out the movie commands with \`!moviehelp\` ${bustinEmote}\nCheck out the task commands with \`!taskhelp\` (admins only) ${bustinEmote}`);
    }

    if (command === 'bustinversion') {
        message.reply(`BustinBot is currently running version ${currentVersion}. ${bustinEmote}`);
        return;
    }

    if (command === 'sendas') {
        // Check for BustinBot Admin role
        if (!message.member.roles.cache.some(role => role.name === 'BustinBot Admin')) {
            message.reply('You do not have the required role to use this command.');
            return;
        }

        const args = message.content.split(' ');
        const channelName = args[1];
        const msgContent = args.slice(2).join(' ');

        const channel = message.guild.channels.cache.find(channel => channel.name === channelName);

        if (channel) {
            channel.send(msgContent)
                .then(() => message.reply(`Message sent to ${channelName}!`))
                .catch(console.error);
        } else {
            message.reply(`Channel ${channelName} not found.`);
        }
    }

    movieModule.handleMovieCommands(message, client);
    await taskModule.handleTaskCommands(message, client);
});

client.login(token);

process.on('exist', flushLogsOnExit);
process.on('SIGINT', () => {
    console.log('Exiting...');
    flushLogsOnExit();
    process.exit(0);
});
