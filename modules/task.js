const { time } = require('console');
const { channel } = require('diagnostics_channel');
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const { report } = require('process');
const pathTasks = './data/task/tasks.json';
const pathTaskMonthlyUsers = './data/task/taskMonthlyUsers.json';
const pathTaskAllUsers = './data/task/taskAllUsers.json';
const pathPollVotes = './data/task/pollVotes.json';
const activeTaskPath = './data/task/activeTask.json';

let pollSchedule = null;
let activePoll = null;

const instructionMap = {
    1: "Provide a screenshot of the obtained items in your inventory (with loot tracker open if applicable). Screenshots should be taken using RuneLite's built-in screenshot feature that includes the date in the photo.",
    2: "Provide a screenshot of your current amount/kc and a second screenshot of the amount/kc after completing the task. Screenshots should be taken using RuneLite's built-in screenshot feature that includes the date in the photo.",
    3: "Provide evidence of the XP being obtained within the week, such as via an XP tracker or a before and after screenshot."
};

function reportError(client, message, error) {
    const botAdminChannel = message.guild.channels.cache.find(channel => channel.name === 'botadmin');

    const errorMessage = `An error occurred: ${error.message || error}`;

    if (botAdminChannel) {
        botAdminChannel.send(errorMessage).catch((err) => {
            console.error('Error sending error message to botadmin: ', err);
        });
    } else {
        console.error(errorMessage);
    }
}

// Ensure task user files exist
function initialiseTaskUserFiles() {
    if (!fs.existsSync(pathTaskMonthlyUsers)) {
        fs.writeFileSync(pathTaskMonthlyUsers, JSON.stringify({ users: [] }, null, 4), 'utf8');
    }
    if (!fs.existsSync(pathTaskAllUsers)) {
        fs.writeFileSync(pathTaskAllUsers, JSON.stringify({ users: [] }, null, 4), 'utf8');
    }
}

function loadUsers(filePath) {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data).users;
}

function saveUsers(filePath, users) {
    fs.writeFileSync(filePath, JSON.stringify({ users }, null, 4), 'utf8');
}

function savePollData() {
    const pollData = {
        activePoll,
    };
    fs.writeFileSync('./pollData.json', JSON.stringify(pollData, null, 4), 'utf8');
}

function loadPollData() {
    if (fs.existsSync('./pollData.json')) {
        const data = fs.readFileSync('./pollData.json', 'utf8');
        const parsedData = JSON.parse(data);
        activePoll = parsedData.activePoll;
    }
}

function savePollVotes(voteCounts) {
    fs.writeFileSync(pathPollVotes, JSON.stringify({ votes: voteCounts }, null, 4), 'utf8');
}

function loadPollVotes() {
    if (fs.existsSync(pathPollVotes)) {
        const data = fs.readFileSync(pathPollVotes, 'utf8');
        const parsedData = JSON.parse(data);
        return parsedData.votes;
    }
    return [0, 0, 0];
}

function saveActiveTask(task) {
    fs.writeFileSync(activeTaskPath, JSON.stringify(task, null, 4), 'utf8');
}

function loadActiveTask() {
    if (fs.existsSync(activeTaskPath)) {
        const data = fs.readFileSync(activeTaskPath, 'utf8');
        const parsedData = JSON.parse(data);
        return parsedData;
    }
    return null;
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
    if (message.channel.name === '📥task-submissions') {
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
                const errorMsg = 'No approval within the alotted time for ' + message.author.id + '\'s task submission.';
                reportError(client, message, errorMsg);
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

    let taskName = '';
    // Select random tasks
    const selectedTasks = shuffled.slice(0, amount).map(task => {
        if (!task.amounts || task.amounts.length === 0) {
            taskName = task.taskName;
            amount = null;
        } else {
            const amount = task.amounts[Math.floor(Math.random() * task.amounts.length)];

            taskName = task.taskName.replace('{amount}', amount);
        }

        return {
            ...task,
            selectedAmount: amount,
            taskName: taskName
        };
    });
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
        const errorMsg = 'Not enough tasks to post poll.';
        reportError(client, null, errorMsg);
        return;
    }

    // Find the appropriate channel (weekly-task)
    const channel = client.channels.cache.find(channel => channel.name === '📆weekly-task');
    if (!channel) {
        const errorMsg = 'Weekly task channel not found.';
        reportError(client, null, errorMsg);
        return;
    }

    const role = channel.guild.roles.cache.find(role => role.name === 'Community event/competition');
    if (!role) {
        const errorMsg = 'Community event/competition role not found.';
        reportError(client, null, errorMsg);
        return;
    }

    const taskPollEmbed = new EmbedBuilder()
        .setTitle("Vote for next task")
        .setDescription(`Voting ends <t:${Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000)}:R>. \n\n1️⃣ ${tasks[0].taskName}\n2️⃣ ${tasks[1].taskName}\n3️⃣ ${tasks[2].taskName}`)
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

    let voteCounts = loadPollVotes();

    const filter = (reaction, user) => ['1️⃣', '2️⃣', '3️⃣'].includes(reaction.emoji.name);
    const collector = message.createReactionCollector({ filter, time: 24 * 60 * 60 * 1000 });

    collector.on('collect', (reaction) => {
        if (reaction.emoji.name === '1️⃣') voteCounts[0]++;
        if (reaction.emoji.name === '2️⃣') voteCounts[1]++;
        if (reaction.emoji.name === '3️⃣') voteCounts[2]++;

        savePollVotes(voteCounts);
    });

    // Set timeout to close poll after 24 hours
    setTimeout(() => {
        closeTaskPoll(client, message, tasks);
    }, 24 * 60 * 60 * 1000);

    savePollData();
}

async function closeTaskPoll(client) {
    if (!activePoll) {
        const errorMsg = 'No active poll to close.';
        reportError(client, null, errorMsg);
        return;
    }

    const channel = client.channels.cache.find(channel => channel.name === '📆weekly-task');
    const message = await channel.messages.fetch(activePoll.messageId);
    const reactions = message.reactions.cache;
    const tasks = activePoll.tasks;
    const voteCounts = loadPollVotes();

    const maxVotes = Math.max(...voteCounts);
    const winningIndex = voteCounts.indexOf(maxVotes);
    const winningTask = tasks[winningIndex];

    if (!winningTask) {
        const errorMsg = 'No winning task found.';
        reportError(client, null, errorMsg);
        return null;
    }

    activePoll = null;
    fs.unlinkSync(pathPollVotes);
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
        const errorMsg = 'No active poll to announce.';
        reportError(client, null, errorMsg);
        return;
    }

    const channel = client.channels.cache.find(channel => channel.name === '📆weekly-task');
    if (!channel) {
        const errorMsg = 'Weekly task channel not found.';
        reportError(client, null, errorMsg);
        return;
    }

    // Close the poll
    const selectedTask = await closeTaskPoll(client);

    if (!selectedTask) {
        const errorMsg = 'No winning task found.';
        reportError(client, null, errorMsg);
        return;
    }

    const instructionText = instructionMap[selectedTask.instruction];
    const submissionChannel = client.channels.cache.find(channel => channel.name === '📥task-submissions');

    const now = new Date();
    const nextSunday = new Date(now.setUTCDate(now.getUTCDate() + (7 - now.getUTCDay()))); // Get the next Sunday
    nextSunday.setUTCHours(23, 59, 0, 0); // Set time to 11:59 PM UTC
    const unixTimestamp = Math.floor(nextSunday.getTime() / 1000);

    const taskAnnouncementEmbed = new EmbedBuilder()
        .setTitle("This Week's Task")
        .setDescription(`**${selectedTask.taskName}**
            \n**Submission instructions**: 
            ${instructionText}
            \nPost all screenshots as **one message** in ${submissionChannel}
            \nTask ends <t:${unixTimestamp}:F>.`)
        .setColor("#FF0000");

    const role = channel.guild.roles.cache.find(role => role.name === 'Community event/competition');
    await channel.send({
        content: `<@&${role.id}>`,
        embeds: [taskAnnouncementEmbed]
    });

    activePoll = null;

    saveActiveTask(selectedTask);

    console.log('Task of the week: ' + selectedTask.taskName + ' announced.');
}

// Get weighted user list for monthly roll
function getWeightedUserList(users) {
    let weightedList = [];
    users.forEach(user => {
        for (let i = 0; i < user.submissions; i++) {
            weightedList.push(user.id);
        }
    });
    return weightedList;
}

function pickMonthlyWinner() {
    let monthlyUsers = loadUsers(pathTaskMonthlyUsers);
    let weightedList = getWeightedUserList(monthlyUsers);

    if (weightedList.length === 0) {
        console.log('No submissions to pick from.');
        return null;
    }

    const randomIndex = Math.floor(Math.random() * weightedList.length);
    return weightedList[randomIndex];
}

function scheduleWinnerAnnouncement(client) {
    const now = new Date();
    const fourthTuesday = getNextFourthTuesday(now);

    const timeUntilFourthTuesday = fourthTuesday.getTime() - now.getTime();

    if (timeUntilFourthTuesday > 2147483647) {
        console.log('Time until fourth Tuesday is too long to schedule right now, will try again 18 days from now.');

        // Schedule for 18 days from now and check again
        setTimeout(() => {
            scheduleWinnerAnnouncement(client);
        }, 18 * 24 * 60 * 60 * 1000);
    } else {
        console.log(`Next winner announcement scheduled in ${(timeUntilFourthTuesday / 1000 / 60 / 60).toFixed(2)} hours.`);

        setTimeout(() => {
            postWinnerAnnouncement(client);
            scheduleWinnerAnnouncement(client);
        }, timeUntilFourthTuesday);
    }
}

// Get the next fourth Tuesday of the month
function getNextFourthTuesday(now) {
    let fourthTuesday = new Date(now);
    fourthTuesday.setUTCDate(1);
    let dayCount = 0;

    while (dayCount < 4) {
        if (fourthTuesday.getUTCDay() === 2) {
            dayCount++;
        }
        if (dayCount < 4) {
            fourthTuesday.setUTCDate(fourthTuesday.getUTCDate() + 1);
        }
    }

    fourthTuesday.setUTCHours(0, 0, 0, 0);
    if (fourthTuesday < now) {
        fourthTuesday.setUTCMonth(fourthTuesday.getUTCMonth() + 1);
        return getNextFourthTuesday(fourthTuesday);
    }

    return fourthTuesday;
}

async function postWinnerAnnouncement(client) {
    const channel = client.channels.cache.find(channel => channel.name === '📆weekly-task');
    if (!channel) {
        const errorMsg = 'Weekly task channel not found.';
        reportError(client, null, errorMsg);
        return;
    }

    let monthlyUsers = loadUsers(pathTaskMonthlyUsers);

    if (monthlyUsers.length === 0) {
        await channel.send('No submissions this month, therefore no winner.');
        return;
    }

    // Calculate total submissions and participants
    const totalSubmissions = monthlyUsers.reduce((total, user) => total + user.submissions, 0);
    const totalParticipants = monthlyUsers.length;

    // Pick a winner
    const winnerId = pickMonthlyWinner();
    if (!winnerId) {
        const errorMsg = 'No winner could be determined.';
        reportError(client, null, errorMsg);
        return;
    }

    // Announce the winner
    const announcementEmbed = new EmbedBuilder()
        .setTitle('And the winner is...')
        .setDescription('In the last month, there were...\n\n **' + totalSubmissions + '** submissions from **' + totalParticipants + '** participants!\n\n**The winner is <@' + winnerId + '>!**\n\n Congratulations! Please message an admin to claim your prize.')
        .setColor("#0000FF");

    const role = channel.guild.roles.cache.find(role => role.name === 'Community event/competition');
    await channel.send({
        content: `<@&${role.id}>`,
        embeds: [announcementEmbed]
    });

    // Reset monthly user submissions
    saveUsers(pathTaskMonthlyUsers, []);

    console.log('Monthly winner announced and taskMonthlyUsers.json reset.');
}

initialiseTaskUserFiles();
loadPollData();
if (activePoll) {
    console.log('Resuming active poll: ', activePoll.messageId);
}

async function handleTaskCommands(message, client) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Limit commands to admins
    if (!message.member.roles.cache.some(role => role.name === 'BustinBot Admin')) {
        message.channel.send('You do not have permission to use this command.');
        return;
    } else {
        if (command === 'taskhelp') {
            message.channel.send('Check out the task commands with `!taskhelp`!');
            return;
        }

        if (command === 'taskpoll') {
            await postTaskPoll(client);
        }

        if (command === 'closetaskpoll') {
            await closeTaskPoll(client);
        }

        if (command === 'announcetask') {
            await postTaskAnnouncement(client);
        }

        if (command === 'rollwinner') {
            await postWinnerAnnouncement(client);
        }

        if (command === 'listtasks') {
            const allTasks = loadTasks();
            let taskList = '';
            let taskCount = 0;

            allTasks.forEach(task => {
                if (!task.amounts || task.amounts.length === 0) {
                    taskList += `${task.id}: ${task.taskName}\n`;
                    taskCount++;
                    return;
                }
                const amountsString = task.amounts.join(', ');

                const taskWithAmounts = task.taskName.replace('{amount}', '{' + amountsString + '}');

                taskList += `${task.id}: ${taskWithAmounts}\n`;
                taskCount++;
                if (taskCount % 20 === 0) {
                    message.channel.send(taskList);
                    taskList = '';
                }
            });

            if (taskList) {
                message.channel.send(taskList);
            }
        }

        if (command === 'activetask') {
            const activeTask = loadActiveTask();

            if (!activeTask) {
                message.channel.send('No active task found.');
                return;
            }

            const instructionText = instructionMap[activeTask.instruction];
            const submissionChannel = client.channels.cache.find(channel => channel.name === '📥task-submissions');

            const now = new Date();
            const nextSunday = new Date(now.setUTCDate(now.getUTCDate() + (7 - now.getUTCDay()))); // Get the next Sunday
            nextSunday.setUTCHours(23, 59, 0, 0); // Set time to 11:59 PM UTC
            const unixTimestamp = Math.floor(nextSunday.getTime() / 1000);

            const taskEmbed = new EmbedBuilder()
                .setTitle("This Week's Task")
                .setDescription(`**${activeTask.taskName}**
                \n**Submission instructions**: 
                ${instructionText}
                \nPost all screenshots as **one message** in ${submissionChannel}
                \nTask ends <t:${unixTimestamp}:F>.`)
                .setColor("#FF0000");

            await message.channel.send({ embeds: [taskEmbed] });
        }

        if (command === 'completions') {
            const allUsers = loadUsers(pathTaskAllUsers);
            let userList = '';

            allUsers.forEach(async user => {
                try {
                    const discordUser = await client.users.fetch(user.id);
                    const username = discordUser.username;
                    userList += `${username}: ${user.submissions} task completions\n`;
                } catch (fetchError) {
                    reportError(client, message, fetchError);
                }
            });

            setTimeout(() => {
                if (userList) {
                    message.channel.send(userList);
                } else {
                    message.channel.send('No task completions found.');
                }
            }, 1000);
        }

        if (command === 'activepoll') {
            if (!activePoll) {
                message.channel.send('No active poll found.');
                return;
            }
        
            const tasks = activePoll.tasks;
            if (tasks.length < 3) {
                message.channel.send('Not enough tasks for a poll.');
                return;
            }
        
            const taskEmbed = new EmbedBuilder()
                .setTitle("Vote for next task")
                .setDescription(`Voting ends <t:${Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000)}:R>. \n\n1️⃣ ${tasks[0].taskName}\n2️⃣ ${tasks[1].taskName}\n3️⃣ ${tasks[2].taskName}`)
                .setColor("#00FF00");
        
            await message.channel.send({ embeds: [taskEmbed] });
        }

        if (command === 'settask') {
            const taskId = args[0];
            const task = loadTasks().find(task => task.id === taskId);

            if (!task) {
                message.channel.send('Task not found.');
                return;
            }

            saveActiveTask(task);
            message.channel.send('Active task set to: ' + task.taskName);
        }
    }
}

module.exports = {
    handleTaskCommands,
    schedulePoll,
    postTaskPoll,
    closeTaskPoll,
    scheduleTaskAnnouncement,
    postTaskAnnouncement,
    handleTaskSubmissions,
    scheduleWinnerAnnouncement
};