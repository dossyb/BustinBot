const { log } = require('console');
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const emoteUtils = require('./utils/emote');

// File paths
const pathTasks = './data/task/tasks.json';
const pathTaskMonthlyUsers = './data/task/taskMonthlyUsers.json';
const pathTaskAllUsers = './data/task/taskAllUsers.json';
const pathPollData = './data/task/pollData.json';
const activeTaskPath = './data/task/activeTask.json';
const keywordsPath = './data/task/keywords.json';
const recentKeywordsPath = './data/task/recentKeywords.json';
const pollLogPath = './logs/polls.log';

// Durations
const POLL_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const TASK_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
const POLL_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days

// Testing durations
// const POLL_DURATION = 60 * 1000; // 1 minute
// const TASK_DURATION = 5 * 60 * 1000; // 2 minutes
// const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

let activePoll = null;
let pollSchedule = null;
let taskAnnouncementSchedule = null;
let nextPollTime = null;
let nextTaskTime = null;
let nextWinnerTime = null;
let winnerPending = false;

const instructionMap = {
    1: "Provide a screenshot of the obtained items in your inventory (with loot tracker open if applicable). Screenshots must have the **keyword** displayed in the in-game chat.",
    2: "Provide a before and after screenshot of the amount/KC showing this has been obtained within the 7 day task period. Both screenshots must have the **keyword** displayed in the in-game chat.",
    3: "Provide evidence of the XP being obtained within the 7 day task period. The preferred submission method is a before and after screenshot with the XP totals displayed, both screenshots must have the **keyword** displayed in the in-game chat."
};

function taskLog(...args) {
    console.log(`[TASK]`, ...args);
}

function logPollResults(tasks, voteCounts, winningTask) {
    const pollLogEntry = {
        timestamp: new Date().toISOString(),
        tasks: tasks.map((task, index) => ({ taskName: task.taskName, votes: voteCounts[index] })),
        winningTask: { taskName: winningTask.taskName, selectedAmount: winningTask.selectedAmount }
    };

    const logEntryString = JSON.stringify(pollLogEntry, null, 4) + ',\n';

    // Append to polls.log, create file if it doesn't exist
    try {
        fs.appendFileSync(pollLogPath, logEntryString, 'utf8');
        taskLog('Poll results logged successfully.');
    } catch (error) {
        console.error('Error logging poll results:', error);
    }
}

function testPollLaunch(client) {
    postTaskPoll(client);
    schedulePoll(client);

    setTimeout(() => {
        postTaskAnnouncement(client);
        scheduleTaskAnnouncement(client);
    }, POLL_DURATION);
}

function getChannelByName(client, channelName) {
    return client.channels.cache.find(channel => channel.name === channelName);
}

function getRoleByName(guild, roleName) {
    return guild.roles.cache.find(role => role.name === roleName);
}

function reportError(client, message, errorMsg) {
    const botAdminChannel = getChannelByName(client, 'botadmin');

    const errorMessage = `An error occurred: ${errorMsg}`;

    if (botAdminChannel) {
        botAdminChannel.send(errorMessage).catch((err) => {
            console.error('Error sending error message to botadmin: ', err);
        });
    } else {
        console.error(errorMessage);
    }
}

function readJSON(filePath) {
    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        try {
            return JSON.parse(data);
        } catch (error) {
            console.error(`Error parsing JSON from ${filePath}:`, error);
            return null;
        }
    }
    return null;
}

function writeJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
}

function startPeriodicStatusUpdates() {
    const logNextSchedules = () => {
        const now = Date.now();

        const pollTimeMessage = nextPollTime ? `Next poll in ${((nextPollTime - now) / 3600000).toFixed(2)} hours (at ${new Date(nextPollTime).toISOString()}).` : 'No poll scheduled.';
        const taskTimeMessage = nextTaskTime ? `Next task announcement in ${((nextTaskTime - now) / 3600000).toFixed(2)} hours (at ${new Date(nextTaskTime).toISOString()}).` : 'No task scheduled.';
        const winnerTimeMessage = nextWinnerTime ? `Next winner announcement in ${((nextWinnerTime - now) / 3600000).toFixed(2)} hours (at ${new Date(nextWinnerTime).toISOString()}).` : 'No winner scheduled.';

        taskLog(`Status update: \n${pollTimeMessage}\n${taskTimeMessage}\n${winnerTimeMessage}`);
    };

    logNextSchedules();
    setInterval(logNextSchedules, 24 * 60 * 60 * 1000);
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
    const data = readJSON(filePath);
    return data ? data.users : [];
}

function saveUsers(filePath, users) {
    writeJSON(filePath, { users });
}

async function loadPollData(client) {
    const pollData = readJSON(pathPollData);
    if (pollData && pollData.activePoll) {
        // Check if poll has expired
        const pollCreationTime = pollData.activePoll.creationTime;
        const now = Date.now();

        if (now - pollCreationTime > POLL_DURATION) {
            taskLog('Active poll has expired.');
            activePoll = null;
        } else {
            activePoll = pollData.activePoll;
            taskLog('Resuming active poll: ' + activePoll.messageId);

            try {
                const channel = client.channels.cache.get(activePoll.channelId);
                const message = await channel.messages.fetch(activePoll.messageId);

                // Update votes from existing reactions
                await updateVotesFromReacts(message, activePoll.votes);

                const interval = setInterval(async () => {
                    if (!activePoll) {
                        clearInterval(interval);
                        return;
                    }

                    const fetchedMessage = await channel.messages.fetch(activePoll.messageId);
                    await updateVotesFromReacts(fetchedMessage, activePoll.votes);
                    savePollData();
                }, 10000);
            } catch (error) {
                console.error('Error fetching message or updating votes:', error);
                reportError(client, null, 'Error fetching message or updating votes.');
            }
        }
    }
}

function savePollData() {
    const pollData = readJSON(pathPollData) || {};
    if (activePoll) {
        pollData.activePoll = activePoll;
    } else {
        delete pollData.activePoll;
    }

    writeJSON(pathPollData, pollData);
}

function loadActiveTask() {
    return readJSON(activeTaskPath);
}

function saveActiveTask(task) {
    writeJSON(activeTaskPath, task);
}

function loadRecentKeywords() {
    if (!fs.existsSync(recentKeywordsPath)) {
        fs.writeFileSync(recentKeywordsPath, JSON.stringify([], null, 4), 'utf8');
        return [];
    }
    const data = readJSON(recentKeywordsPath);
    return data ? data : [];
}

function saveRecentKeywords(keywords) {
    writeJSON(recentKeywordsPath, keywords);
}

function getUniqueKeyword() {
    const keywords = readJSON(keywordsPath);
    const recentKeywords = loadRecentKeywords();

    const availableKeywords = keywords.filter(keyword => !recentKeywords.includes(keyword));

    if (availableKeywords.length === 0) {
        console.error('No available keywords found.');
        return null;
    }

    const selectedKeyword = availableKeywords[Math.floor(Math.random() * availableKeywords.length)];

    recentKeywords.push(selectedKeyword);
    if (recentKeywords.length > 20) {
        recentKeywords.shift();
    }
    saveRecentKeywords(recentKeywords);

    return selectedKeyword;
}

// Load tasks from tasks.json
function loadTasks() {
    let data = readJSON(pathTasks);

    return Array.isArray(data) ? data : [];
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
        const filter = (reaction, user) => reaction.emoji.name === '✅' && message.guild.members.cache.get(user.id).roles.cache.some(role => role.name === 'BustinBot Admin' || role.name === 'Task Admin');

        const processApproval = async (reaction, user) => {
            if (winnerPending) {
                const botAdminChannel = getChannelByName(client, 'botadmin');
                const taskAdmin = `<@${user.id}>`;

                if (botAdminChannel) {
                    await botAdminChannel.send(`${taskAdmin}, a winner is currently pending confirmation. Please wait for the winner to be confirmed before approving any task submissions.`);
                };

                reaction.users.remove(user.id);
                taskLog(`Task approval attempt by ${user.username} denied due to pending winner confirmation.`);
                return;
            }

            const userId = message.author.id;

            // Add user to user lists
            let monthlyUsers = loadUsers(pathTaskMonthlyUsers);
            let allUsers = loadUsers(pathTaskAllUsers);

            monthlyUsers = updateSubmissionCount(monthlyUsers, userId);
            allUsers = updateSubmissionCount(allUsers, userId);

            saveUsers(pathTaskMonthlyUsers, monthlyUsers);
            saveUsers(pathTaskAllUsers, allUsers);

            // React to message to confirm submission
            const bustinEmote = client.emojis.cache.find(emoji => emoji.name === 'Bustin');
            if (bustinEmote) {
                await message.react(bustinEmote);
            } else {
                taskLog('Bustin emote not found, BustinBot is very concerned.');
            }

            taskLog('Task submission approved for user ' + userId);

            collector.stop('approved');
        };

        const collector = message.createReactionCollector({ filter, dispose: true });

        collector.on('collect', async (reaction, user) => {
            try {
                await processApproval(reaction, user);
            } catch (error) {
                console.error(`Error processing approval for submission ${message.id}:`, error);
                reportError(client, message, `Error processing approval for submission ${message.id}: ${error}`);
            }
        });

        collector.on('remove', async (reaction, user) => {
            if (reaction.emoji.name === '✅' && !reaction.users.cache.has(client.user.id)) {
                taskLog(`Approval on submission ${message.id} removed for ${user.username}`);
            }
        });

        collector.on('end', (collected, reason) => {
            if (reason !== 'approved') {
                taskLog(`Listener on submission ${message.id} ended without approval.`);
            }
        });
    }
}

// Function to randomly select tasks for the poll
function getRandomTasks(amount) {
    const allTasks = loadTasks();
    const shuffled = allTasks.sort(() => 0.5 - Math.random());

    // Select random tasks
    const selectedTasks = shuffled.slice(0, amount).map(task => {
        let taskName = task.taskName;
        let selectedAmount = null;

        if (task.amounts && Array.isArray(task.amounts) && task.amounts.length > 0) {
            selectedAmount = task.amounts[Math.floor(Math.random() * task.amounts.length)];

            if (Array.isArray(selectedAmount)) {
                taskName = task.taskName.replace('{amount}', `${selectedAmount[0]}/${selectedAmount[1]}`);
            } else {
                taskName = task.taskName.replace('{amount}', selectedAmount);
            }
        }

        return {
            ...task,
            selectedAmount: selectedAmount,
            taskName: taskName
        };
    });
    return selectedTasks;
}

function getNextDayOfWeek(dayOfWeek, hour = 0, minute = 0) {
    const now = new Date();
    let nextDay = new Date(now);

    // Calculate the days to add to reach the next desired day
    const daysUntilNext = (7 - now.getUTCDay() + dayOfWeek) % 7 || 7;
    nextDay.setUTCDate(now.getUTCDate() + daysUntilNext);
    nextDay.setUTCHours(hour, minute, 0, 0);

    return nextDay;
}

function createPollEmbed(tasks) {
    return new EmbedBuilder()
        .setTitle("Vote for next task")
        .setDescription(`Voting ends <t:${Math.floor((Date.now() + POLL_DURATION) / 1000)}:R>. \n\n1️⃣ ${tasks[0].taskName}\n2️⃣ ${tasks[1].taskName}\n3️⃣ ${tasks[2].taskName}`)
        .setColor("#00FF00");
}

// Schedule poll every Sunday at 12AM UTC
function schedulePoll(client) {
    // Testing code
    // const timeUntilNextPoll = POLL_INTERVAL;

    // Production code

    const nextSunday = getNextDayOfWeek(0); // 0 = Sunday
    const timeUntilNextPoll = nextSunday.getTime() - Date.now();

    nextPollTime = nextSunday.getTime();

    if (pollSchedule) {
        clearTimeout(pollSchedule);
    }

    taskLog(`Next poll scheduled for ${new Date(nextPollTime).toISOString()} (${(timeUntilNextPoll / 1000 / 60 / 60).toFixed(2)} hours from now).`);

    pollSchedule = setTimeout(() => {
        postTaskPoll(client);
        schedulePoll(client);
    }, timeUntilNextPoll);
}

async function updateVotesFromReacts(message, votes) {
    try {
        const reactions = message.reactions.cache;

        // Reset vote counts before recalculating
        votes[0] = 0;
        votes[1] = 0;
        votes[2] = 0;

        // Iterate over the reactions and count valid votes
        if (reactions.get('1️⃣')) {
            const reaction1 = await reactions.get('1️⃣').users.fetch();
            votes[0] = reaction1.filter(user => !user.bot).size;
        }
        if (reactions.get('2️⃣')) {
            const reaction2 = await reactions.get('2️⃣').users.fetch();
            votes[1] = reaction2.filter(user => !user.bot).size;
        }
        if (reactions.get('3️⃣')) {
            const reaction3 = await reactions.get('3️⃣').users.fetch();
            votes[2] = reaction3.filter(user => !user.bot).size;
        }

        savePollData();
    } catch (error) {
        console.error('Error updating votes from reactions:', error);
    }
}

// Post task poll
async function postTaskPoll(client) {
    const tasks = getRandomTasks(3);
    if (tasks.length < 3) {
        reportError(client, null, 'Not enough tasks to post poll.');
        return;
    }

    // Find the appropriate channel (weekly-task)
    const channel = getChannelByName(client, '📆weekly-task');
    if (!channel) {
        reportError(client, null, 'Weekly task channel not found.');
        return;
    }

    const role = getRoleByName(channel.guild, 'Community event/competition');
    if (!role) {
        reportError(client, null, 'Community event/competition role not found.');
        return;
    }

    const pollData = readJSON(pathPollData) || {};
    if (pollData.lastPollId) {
        try {
            const lastPollMessage = await channel.messages.fetch(pollData.lastPollId);
            await lastPollMessage.delete();
            taskLog(`Deleted previous poll message: ${pollData.lastPollId}`);
        } catch (error) {
            console.error(`Error deleting previous poll message: ${pollData.lastPollId}`, error);
        }
    }

    const taskPollEmbed = createPollEmbed(tasks);

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
        channelId: channel.id,
        creationTime: Date.now(),
        votes: [0, 0, 0]
    }

    try {
        const updatedPollData = { activePoll, lastPollId: message.id };
        writeJSON(pathPollData, updatedPollData);
    } catch (error) {
        console.error('Error saving poll data:', error);
        reportError(client, null, 'Error saving poll data.');
    }

    const interval = setInterval(async () => {
        try {
            // Only update votes if there is an active poll.
            if (!activePoll) {
                clearInterval(interval);
                return;
            }

            const fetchedMessage = await channel.messages.fetch(activePoll.messageId);
            await updateVotesFromReacts(fetchedMessage, activePoll.votes);
        } catch (error) {
            console.error('Error fetching message or updating votes:', error);
            reportError(client, null, 'Error updating votes from reactions.');
        }
    }, 10000);

    const filter = (reaction, user) => ['1️⃣', '2️⃣', '3️⃣'].includes(reaction.emoji.name);
    const collector = message.createReactionCollector({ filter, time: POLL_DURATION });

    collector.on('end', () => {
        clearInterval(interval);
        closeTaskPoll(client, message, tasks);
    });
}

async function closeTaskPoll(client) {
    const pollData = readJSON(pathPollData);
    if (!pollData || !pollData.activePoll) {
        taskLog('No active poll to close.');
        return null;
    }
    activePoll = pollData.activePoll;

    const channel = getChannelByName(client, '📆weekly-task');
    const message = await channel.messages.fetch(activePoll.messageId);
    const tasks = activePoll.tasks;
    const voteCounts = activePoll.votes;

    const maxVotes = Math.max(...voteCounts);

    const tiedIndices = voteCounts.reduce((acc, count, index) => {
        if (count === maxVotes) {
            acc.push(index);
        }
        return acc;
    }, []);

    let winningIndex;
    if (tiedIndices.length > 1) {
        winningIndex = tiedIndices[Math.floor(Math.random() * tiedIndices.length)];
        taskLog('Tied votes, randomly selecting winner from tied options.');
    } else {
        winningIndex = voteCounts.indexOf(maxVotes);
    }

    const winningTask = tasks[winningIndex];

    if (!winningTask) {
        reportError(client, null, 'No winning task found.');
        return null;
    }

    logPollResults(tasks, voteCounts, winningTask);

    activePoll = null;

    try {
        savePollData();
    } catch (error) {
        console.error('Error saving poll data:', error);
        reportError(client, null, 'Error saving poll data.');
    }

    return winningTask;
}

function createTaskAnnouncementEmbed(task, submissionChannel, instructionText, uniqueKeyword) {
    return new EmbedBuilder()
        .setTitle("This Week's Task")
        .setDescription(`**${task.taskName}**
        \n**Submission instructions**: 
        ${instructionText}
        \n🔑 This week's keyword: **${uniqueKeyword}** 🔑
        \nPost all screenshots as **one message** in ${submissionChannel}
        \nTask ends <t:${Math.floor((Date.now() + TASK_DURATION) / 1000)}:R>.`)
        .setColor("#FF0000");
}

function scheduleTaskAnnouncement(client) {
    // Testing code
    // const timeUntilNextTask = TASK_DURATION;

    // Production code
    const nextMonday = getNextDayOfWeek(1); // 1 = Monday
    const timeUntilNextTask = nextMonday.getTime() - Date.now();

    nextTaskTime = nextMonday.getTime();

    if (taskAnnouncementSchedule) {
        clearTimeout(taskAnnouncementSchedule);
    }

    taskLog(`Next task announcement scheduled for ${new Date(nextTaskTime).toISOString()} (${(timeUntilNextTask / 1000 / 60 / 60).toFixed(2)} hours from now).`);

    taskAnnouncementSchedule = setTimeout(() => {
        postTaskAnnouncement(client);
        scheduleTaskAnnouncement(client);
    }, timeUntilNextTask);
}

async function postTaskAnnouncement(client) {
    if (!activePoll) {
        reportError(client, null, 'No active poll to announce.');
        return;
    }

    const channel = getChannelByName(client, '📆weekly-task');
    if (!channel) {
        reportError(client, null, 'Weekly task channel not found.');
        return;
    }

    // Close the poll
    const selectedTask = await closeTaskPoll(client);

    if (!selectedTask) {
        reportError(client, null, 'No winning task found.');
        return;
    }

    const uniqueKeyword = getUniqueKeyword();
    if (!uniqueKeyword) {
        reportError(client, null, 'No unique keyword found.');
        return;
    }

    const instructionText = instructionMap[selectedTask.instruction];
    const submissionChannel = getChannelByName(client, '📥task-submissions');

    const now = new Date();
    const nextSunday = new Date(now.setUTCDate(now.getUTCDate() + (7 - now.getUTCDay()))); // Get the next Sunday
    nextSunday.setUTCHours(23, 59, 0, 0); // Set time to 11:59 PM UTC

    const taskAnnouncementEmbed = createTaskAnnouncementEmbed(selectedTask, submissionChannel, instructionText, uniqueKeyword);

    const role = getRoleByName(channel.guild, 'Community event/competition');
    await channel.send({
        content: `<@&${role.id}>`,
        embeds: [taskAnnouncementEmbed]
    });

    activePoll = null;

    saveActiveTask(selectedTask);

    taskLog('Task of the week: ' + selectedTask.taskName + ' announced.');
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
        taskLog('No submissions to pick from.');
        return null;
    }

    const randomIndex = Math.floor(Math.random() * weightedList.length);
    return weightedList[randomIndex];
}

function scheduleWinnerAnnouncement(client) {
    const now = new Date();
    const fourthTuesday = getNextFourthTuesday(now);

    const timeUntilFourthTuesday = fourthTuesday.getTime() - now.getTime();

    nextWinnerTime = fourthTuesday.getTime();

    if (timeUntilFourthTuesday > 2147483647) {
        taskLog('Time until fourth Tuesday is too long to schedule right now, will try again on the 18th day of the month.');

        // Schedule for 18 days from now and check again
        setTimeout(() => {
            scheduleWinnerAnnouncement(client);
        }, 18 * 24 * 60 * 60 * 1000);
    } else {
        taskLog(`Next winner announcement scheduled for ${new Date(nextWinnerTime).toISOString()} (${(timeUntilFourthTuesday / 1000 / 60 / 60).toFixed(2)} hours from now).`);

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
    const channel = getChannelByName(client, '📆weekly-task');
    if (!channel) {
        reportError(client, null, 'Weekly task channel not found.');
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
        reportError(client, null, 'No winner could be determined.');
        return;
    }

    // Set flag to await confirmation and block further task submission approvals
    winnerPending = true;

    // Announce the winner
    const announcementEmbed = new EmbedBuilder()
        .setTitle('And the winner is...')
        .setDescription('In the last month, there were...\n\n **' + totalSubmissions + '** submissions from **' + totalParticipants + '** participants!\n\n**The winner is <@' + winnerId + '>!**\n\n Congratulations! Please message an admin to claim your prize.')
        .setColor("#0000FF");

    // Send message to botadmin channel prompting to confirm winner
    const botAdminChannel = getChannelByName(client, 'botadmin');
    if (botAdminChannel) {
        await botAdminChannel.send({
            content: 'Monthly winner has been selected. If the winner has chosen to claim the prize, please confirm using **!confirmwinner**.'
        });
    }

    const role = getRoleByName(channel.guild, 'Community event/competition');
    await channel.send({
        content: `<@&${role.id}>`,
        embeds: [announcementEmbed]
    });
}

async function handleTaskCommands(message, client) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'taskhelp') {
        let helpMessage = `
    📥 **BustinBot's Task Commands** 📥
    
**Commands for BustinBot Admins:**
- **!taskpoll**: Create a new task poll for the community to vote on.
- **!announcetask**: Close the active poll and announce the active task for the current week.
- **!settask <task ID> [amount]**: Set a specific task as the active one, with an optional amount.

**Commands for Task Admins and BustinBot Admins:**
- **!rollwinner**: Randomly select a winner from the task submissions.
- **!confirmwinner**: Confirm the selected winner and reset the monthly participants list.
- **!listtasks**: Display a list of all available tasks and their details.
- **!monthlycompletions**: List all users and the number of tasks they have completed for the month.
- **!allcompletions**: List all users and the number of tasks they have completed.

**Note**: The Task Admin role can also approve task submissions in the task-submissions channel.    
    `;

        message.reply(helpMessage);
        return;
    }

    // Check roles for permissions
    const isAdmin = message.member.roles.cache.some(role => role.name === 'BustinBot Admin');
    const isTaskAdmin = message.member.roles.cache.some(role => role.name === 'Task Admin');

    // Commands restricted to BustinBot Admins
    if (isAdmin) {
        if (command === 'taskpoll') {
            await postTaskPoll(client);
        }

        if (command === 'announcetask') {
            await postTaskAnnouncement(client);
        }

        if (command === 'settask') {
            const taskId = args[0];
            const specifiedAmount = args[1] ? parseInt(args[1], 10) : null;

            if (!taskId) {
                message.channel.send('Please provide a task ID.');
                return;
            }
            const task = loadTasks().find(task => task.id === parseInt(taskId), 10);

            if (!task) {
                message.channel.send(`Task with ID ${taskId} not found.`);
                return;
            }

            let selectedAmount = null;
            if (task.amounts && task.amounts.length > 0) {
                if (specifiedAmount) {
                    if (!task.amounts.includes(specifiedAmount)) {
                        message.channel.send(`Amount ${specifiedAmount} is not valid for this task.`);
                        return;
                    }
                    selectedAmount = specifiedAmount;
                } else {
                    selectedAmount = task.amounts[Math.floor(Math.random() * task.amounts.length)];
                }
            }

            saveActiveTask(task);
            message.channel.send(`Active task set to ${task.taskName.replace('{amount}', selectedAmount)}`);
        }

        if (command === 'closetaskpoll') {
            const task = await closeTaskPoll(client);
            if (task) {
                message.channel.send(`Task poll closed. The winning task is: ${task.taskName}`);
            } else {
                message.channel.send('No winning task found.');
            }
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

            const pollVotes = loadPollVotes();

            const votes = pollVotes || [0, 0, 0];
            if (votes.length < 3) {
                message.channel.send('Vote data is incomplete.');
                return;
            }

            const description = `Voting ends <t:${Math.floor((Date.now() + POLL_DURATION) / 1000)}:R>. \n\n` +
                `1️⃣ ${tasks[0].taskName} - ${votes[0]} vote(s)\n` +
                `2️⃣ ${tasks[1].taskName} - ${votes[1]} vote(s)\n` +
                `3️⃣ ${tasks[2].taskName} - ${votes[2]} vote(s)`;

            const taskEmbed = new EmbedBuilder()
                .setTitle("Vote for next task")
                .setDescription(description)
                .setColor("#00FF00");

            await message.channel.send({ embeds: [taskEmbed] });
        }

        if (command === 'activetask') {
            const activeTask = loadActiveTask();

            if (!activeTask) {
                message.channel.send('No active task found.');
                return;
            }

            const instructionText = instructionMap[activeTask.instruction];
            const submissionChannel = getChannelByName(client, '📥task-submissions');

            const now = new Date();
            const nextSunday = new Date(now.setUTCDate(now.getUTCDate() + (7 - now.getUTCDay()))); // Get the next Sunday
            nextSunday.setUTCHours(23, 59, 0, 0); // Set time to 11:59 PM UTC

            const taskEmbed = createTaskAnnouncementEmbed(activeTask, submissionChannel, instructionText);

            await message.channel.send({ embeds: [taskEmbed] });
        }
    } else if (
        command === 'taskpoll' ||
        command === 'announcetask' ||
        command === 'settask' ||
        command === 'activetask' ||
        command === 'activepoll' ||
        command === 'closetaskpoll'
    ) {
        message.reply('You do not have permission to use this command.');
        return;
    }

    // Commands restricted to Task Admins and BustinBot Admins
    if (isTaskAdmin || isAdmin) {
        if (command === 'rollwinner') {
            await postWinnerAnnouncement(client);
        }

        if (command === 'confirmwinner') {
            if (!winnerPending) {
                message.reply("There is no winner pending confirmation.");
                return;
            }

            saveUsers(pathTaskMonthlyUsers, []);
            winnerPending = false;

            message.reply("This month's winner has been confirmed and the monthly participants list has been reset.");
            taskLog('Monthly winner confirmed and taskMonthlyUsers.json reset.');
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

        if (command === 'monthlycompletions') {
            const bustinEmote = emoteUtils.getBustinEmote();
            message.channel.send(`Pulling user data, hold your ${bustinEmote}s...`);
            const monthlyUsers = loadUsers(pathTaskMonthlyUsers);

            if (!monthlyUsers || monthlyUsers.length === 0) {
                message.channel.send('No task completions found.');
                return;
            }

            const userPromises = monthlyUsers.map(async user => {
                try {
                    const discordUser = await client.users.fetch(user.id);
                    return `${discordUser.username}: ${user.submissions} task completions\n`;
                } catch (fetchError) {
                    reportError(client, message, fetchError);
                    return null;
                }
            });

            try {
                const userList = (await Promise.all(userPromises)).filter(entry => entry !== null).join('');
                if (userList) {
                    message.channel.send(userList);
                } else {
                    message.channel.send('No task completions found.');
                }
            } catch (error) {
                console.error('Error fetching user completions:', error);
                reportError(client, message, 'An error occurred while fetching task completions.');
            }
        }

        if (command === 'allcompletions') {
            const bustinEmote = emoteUtils.getBustinEmote();
            message.channel.send(`Pulling user data, hold your ${bustinEmote}s...`);
            const allUsers = loadUsers(pathTaskAllUsers);

            if (!allUsers || allUsers.length === 0) {
                message.channel.send('No task completions found.');
                return;
            }

            const userPromises = allUsers.map(async user => {
                try {
                    const discordUser = await client.users.fetch(user.id);
                    return `${discordUser.username}: ${user.submissions} task completions\n`;
                } catch (fetchError) {
                    reportError(client, message, fetchError);
                    return null;
                }
            });

            try {
                const userList = (await Promise.all(userPromises)).filter(entry => entry !== null).join('');
                if (userList) {
                    message.channel.send(userList);
                } else {
                    message.channel.send('No task completions found.');
                }
            } catch (error) {
                console.error('Error fetching user completions:', error);
                reportError(client, message, 'An error occurred while fetching task completions.');
            }
        }

    } else if (
        command === 'rollwinner' ||
        command === 'listtasks' ||
        command === 'confirmwinner' ||
        command === 'allcompletions' ||
        command === 'monthlycompletions'
    ) {
        message.reply('You do not have permission to use this command.');
        return;
    }
}

module.exports = {
    handleTaskCommands,
    initialiseTaskUserFiles,
    loadPollData,
    schedulePoll,
    postTaskPoll,
    closeTaskPoll,
    scheduleTaskAnnouncement,
    postTaskAnnouncement,
    handleTaskSubmissions,
    scheduleWinnerAnnouncement,
    testPollLaunch,
    startPeriodicStatusUpdates
};