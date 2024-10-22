const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const pathTasks = './tasks.json';
const pathTaskMonthlyUsers = './taskMonthlyUsers.json';
const pathTaskAllUsers = './taskAllUsers.json';

let pollSchedule = null;
let activePoll = null;

// Ensure task user files exist
function initialiseTaskUserFiles() {
    if (!fs.existsSync(pathTaskMonthlyUsers)) {
        fs.writeFileSync(pathTaskMonthlyUsers, JSON.stringify({ users: []}, null, 4), 'utf8');
    }
    if (!fs.existsSync(pathTaskAllUsers)) {
        fs.writeFileSync(pathTaskAllUsers, JSON.stringify({ users: []}, null, 4), 'utf8');
    }
}

function loadUsers(filePath) {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data).users;
}

function saveUsers(filePath, users) {
    fs.writeFileSync(filePath, JSON.stringify({ users }, null, 4), 'utf8');
}

function updateSubmissionCount(users, userId) {
    const user = users.find(user => user.id === userId);
    if (user) {
        user.submissions++;
    } else {
        users.push({ id: userId, submissions: 1 });
    }

    return users;
}

// Handle task submissions
async function handleTaskSubmissions(message, client) {
    if (message.channel.name === 'task-submissions') {
        const filter = (reaction, user) => reaction.emoji.name === '✅' && message.guild.members.cache.get(user.id).roles.cache.find(role => role.name === 'BustinBot Admin');
        const collector = message.createReactionCollector({ filter, max: 1, time: 168 * 60 * 60 * 1000 });

        collector.on('collect', async (reaction, user) => {
            const userId = message.author.id;

            // Add user to both user lists
            let monthlyUsers = loadUsers(pathTaskMonthlyUsers);
            let allUsers = loadUsers(pathTaskAllUsers);
            
            monthlyUsers = updateSubmissionCount(monthlyUsers, userId);
            allUsers = updateSubmissionCount(allUsers, userId);

            saveUsers(pathTaskMonthlyUsers, monthlyUsers);
            saveUsers(pathTaskAllUsers, allUsers);

            // React to the message to confirm submission
            const bustinEmote = client.emojis.cache.find(emoji => emoji.name === 'Bustin');
            if (bustinEmote) {
                await message.react(bustinEmote);
            } else {
                console.log('Bustin emote not found, BustinBot is very concerned.');
            }

            console.log('Task submission confirmed for user ' + userId);
        });

        collector.on('end', collected => {
            if (collected.size === 0) {
                console.log('No approval within the alotted time for ' + message.author.id + '\'s task submission.');
            }
        });
    }
}

// Load tasks from tasks.json
function loadTasks() {
    if (!fs.existsSync(pathTasks)) {
        const initialData = { tasks: [] };
        fs.writeFileSync(pathTasks, JSON.stringify(initialData, null, 4), 'utf8');
    }
    const data = fs.readFileSync(pathTasks, 'utf8');
    const parsedData = JSON.parse(data);

    return Array.isArray(parsedData) ? parsedData : [];
}

// Function to randomly select tasks for the poll
function getRandomTasks(amount) {
    const allTasks = loadTasks();
    const shuffled = allTasks.sort(() => 0.5 - Math.random());
    const selectedTasks = shuffled.slice(0, amount);
    return selectedTasks;
}

// Schedule poll every Sunday at 12AM UTC
function schedulePoll(client) {
    const now = new Date();

    let nextSunday = new Date(now);
    nextSunday.setUTCDate(now.getUTCDate() + (7 - now.getUTCDay()));
    nextSunday.setUTCHours(0, 0, 0, 0);

    if (nextSunday.getTime() <= now.getTime()) {
        nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
    }

    const timeUntilNextSunday = nextSunday.getTime() - now.getTime();

    console.log(`Next poll scheduled in ${(timeUntilNextSunday / 1000 / 60 / 60).toFixed(2)} hours.`);

    pollSchedule = setTimeout(() => {
        postTaskPoll(client);
        schedulePoll(client);
    }, timeUntilNextSunday);
}

// Post task poll
async function postTaskPoll(client) {
    const tasks = getRandomTasks(3);
    if (tasks.length < 3) {
        console.log('Not enough tasks to post poll.');
        return;
    }

    // Find the appropriate channel (weekly-tasks)
    const channel = client.channels.cache.find(channel => channel.name === 'weekly-tasks');
    if (!channel) {
        console.log('Weekly task channel not found');
        return;
    }

    const role = channel.guild.roles.cache.find(role => role.name === 'Community event/competition');
    if (!role) {
        console.log('Community event/competition role not found');
        return;
    }

    const taskPollEmbed = new EmbedBuilder()
        .setTitle("Vote for next task")
        .setDescription(`Voting lasts 24 hours. \n\n1️⃣ **${tasks[0].taskName}**\n2️⃣ **${tasks[1].taskName}**\n3️⃣ **${tasks[2].taskName}**`)
        .setColor("#00FF00");

    const message = await channel.send({
        content: `<@&${role.id}>`,
        embeds: [taskPollEmbed]
    });

    // Add reactions to the poll
    await message.react('1️⃣');
    await message.react('2️⃣');
    await message.react('3️⃣');

    activePoll = {
        messageId: message.id,
        tasks: tasks,
        channelId: channel.id
    }

    // Set timeout to close poll after 24 hours
    setTimeout(() => {
        closeTaskPoll(client, message, tasks);
    }, 24 * 60 * 60 * 1000);
}

async function closeTaskPoll(client) {
    if (!activePoll) {
        console.log('No active poll to close');
        return;
    }

    const channel = client.channels.cache.find(channel => channel.name === 'weekly-tasks');
    const message = await channel.messages.fetch(activePoll.messageId);
    const reactions = message.reactions.cache;
    const tasks = activePoll.tasks;
    const voteCounts = [
        reactions.get('1️⃣')?.count - 1 || 0,
        reactions.get('2️⃣')?.count - 1 || 0,
        reactions.get('3️⃣')?.count - 1 || 0
    ];

    const maxVotes = Math.max(...voteCounts);
    const winningIndex = voteCounts.indexOf(maxVotes);
    const winningTask = tasks[winningIndex];

    if (!winningTask) {
        console.log('No winning task found');
        return null;
    }

    // await message.channel.send(`The winning task is **${winningTask.taskName}**!`);

    activePoll = null;
    return winningTask;
}

function scheduleTaskAnnouncement(client) {
    const now = new Date();

    let nextMonday = new Date(now);
    nextMonday.setUTCDate(now.getUTCDate() + ((8 - now.getUTCDay()) % 7));
    nextMonday.setUTCHours(0, 0, 0, 0);

    if (nextMonday.getTime() <= now.getTime()) {
        nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    }

    const timeUntilNextMonday = nextMonday.getTime() - now.getTime();

    console.log(`Next task announcement scheduled in ${(timeUntilNextMonday / 1000 / 60 / 60).toFixed(2)} hours.`);

    setTimeout(() => {
        postTaskAnnouncement(client);
        scheduleTaskAnnouncement(client);
    }, timeUntilNextMonday);
}

async function postTaskAnnouncement(client) {
    if (!activePoll) {
        console.log('No active poll to announce');
        return;
    }

    const channel = client.channels.cache.find(channel => channel.name === 'weekly-tasks');
    if (!channel) {
        console.log('Weekly task channel not found');
        return;
    }

    // Close the poll
    const selectedTask = await closeTaskPoll(client);

    if (!selectedTask) {
        console.log('No winning task found.');
        return;
    }

    const taskAnnouncementEmbed = new EmbedBuilder()
        .setTitle("This Week's Task")
        .setDescription(`**${selectedTask.taskName}**\nSubmission instructions: ${selectedTask.instructions}\n\nTask ends Sunday at 11:59 PM UTC.`)
        .setColor("#FF0000");

    const role = channel.guild.roles.cache.find(role => role.name === 'Community event/competition');
    await channel.send({
        content: `<@&${role.id}>`,
        embeds: [taskAnnouncementEmbed]
    });

    activePoll = null;

    console.log('Task of the week: ' + selectedTask.taskName + ' announced.');
}

initialiseTaskUserFiles();

async function handleTaskCommands(message, client) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'taskhelp') {
        message.channel.send('Check out the task commands with `!taskhelp`!');
        return;
    }

    if (command === 'starttaskpoll') {
        await postTaskPoll(client);
    }

    if (command === 'closetaskpoll') {
        await closeTaskPoll(client);
    }

    if (command === 'announcetask') {
        await postTaskAnnouncement(client);
    }
}

module.exports = {
    handleTaskCommands,
    schedulePoll,
    postTaskPoll,
    closeTaskPoll,
    scheduleTaskAnnouncement,
    postTaskAnnouncement,
    handleTaskSubmissions
};