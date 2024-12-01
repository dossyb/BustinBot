const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// File paths
const pathTasks = './data/task/tasks.json';
const pathTaskMonthlyUsers = './data/task/taskMonthlyUsers.json';
const pathTaskAllUsers = './data/task/taskAllUsers.json';
const pathPollVotes = './data/task/pollVotes.json';
const activeTaskPath = './data/task/activeTask.json';
const keywordsPath = './data/task/keywords.json';
const recentKeywordsPath = './data/task/recentKeywords.json';

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

const instructionMap = {
    1: "Provide a screenshot of the obtained items in your inventory (with loot tracker open if applicable). Screenshots must have the **keyword** displayed in the in-game chat.",
    2: "Provide a before and after screenshot of the amount/KC showing this has been obtained within the 7 day task period. Both screenshots must have the **keyword** displayed in the in-game chat.",
    3: "Provide evidence of the XP being obtained within the 7 day task period. The preferred submission method is a before and after screenshot with the XP totals displayed, both screenshots must have the **keyword** displayed in the in-game chat."
};

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
    const pollData = readJSON('./data/task/pollData.json');
    if (pollData && pollData.activePoll) {
        // Check if poll has expired
        const pollCreationTime = pollData.activePoll.creationTime;
        const now = Date.now();

        if (now - pollCreationTime > POLL_DURATION) {
            console.log('Active poll has expired.');
            activePoll = null;
        } else {
            activePoll = pollData.activePoll;
            console.log('Resuming active poll: ' + activePoll.messageId);

            try {
                const channel = client.channels.cache.get(activePoll.channelId);
                const message = await channel.messages.fetch(activePoll.messageId);

                // Update votes from existing reactions
                let voteCounts = loadPollVotes();
                await updateVotesFromReacts(message, voteCounts);
                savePollVotes(voteCounts);

                const interval = setInterval(async () => {
                    if (!activePoll) {
                        clearInterval(interval);
                        return;
                    }

                    const fetchedMessage = await channel.messages.fetch(activePoll.messageId);
                    await updateVotesFromReacts(fetchedMessage, voteCounts);
                    savePollVotes(voteCounts);
                }, 30000);
            } catch (error) {
                console.error('Error fetching message or updating votes:', error);
                reportError(client, null, 'Error fetching message or updating votes.');
            }
        }
    }
}

function savePollData() {
    if (activePoll) {
        writeJSON('./data/task/pollData.json', { activePoll });
    } else {
        writeJSON('./data/task/pollData.json', {});
    }
}

function loadPollVotes() {
    const pollVotes = readJSON(pathPollVotes);
    return pollVotes ? pollVotes.votes : [0, 0, 0];
}

function savePollVotes(voteCounts) {
    writeJSON(pathPollVotes, { votes: voteCounts });
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
        const collector = message.createReactionCollector({ filter, max: 1, time: TASK_DURATION });

        const messageDeleteListener = (deletedMessage) => {
            if (deletedMessage.id === message.id) {
                console.log('Message deleted before approval.');
                client.off('messageDelete', messageDeleteListener);
                collector.stop();
            }
        };

        client.on('messageDelete', messageDeleteListener);

        collector.on('end', (collected, reason) => {
            if (reason === 'messageDelete') {
                return;
            }

            client.off('messageDelete', messageDeleteListener);
            if (collected.size === 0) {
                reportError(client, message, 'No approval within the allotted time for ' + message.author.id + '\'s task submission.');
            }
        });

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

    if (pollSchedule) {
        clearTimeout(pollSchedule);
    }

    console.log(`Next poll scheduled in ${(timeUntilNextPoll / 1000 / 60 / 60).toFixed(2)} hours.`);

    pollSchedule = setTimeout(() => {
        postTaskPoll(client);
        schedulePoll(client);
    }, timeUntilNextPoll);
}

async function updateVotesFromReacts(message, voteCounts) {
    try {
        const reactions = message.reactions.cache;

        // Reset vote counts before recalculating
        voteCounts[0] = 0;
        voteCounts[1] = 0;
        voteCounts[2] = 0;

        // Iterate over the reactions and count valid votes
        if (reactions.get('1️⃣')) {
            const reaction1 = await reactions.get('1️⃣').users.fetch();
            voteCounts[0] = reaction1.filter(user => !user.bot).size;
        }
        if (reactions.get('2️⃣')) {
            const reaction2 = await reactions.get('2️⃣').users.fetch();
            voteCounts[1] = reaction2.filter(user => !user.bot).size;
        }
        if (reactions.get('3️⃣')) {
            const reaction3 = await reactions.get('3️⃣').users.fetch();
            voteCounts[2] = reaction3.filter(user => !user.bot).size;
        }
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
        creationTime: Date.now()
    }

    let voteCounts = [0, 0, 0];
    savePollVotes(voteCounts);

    const interval = setInterval(async () => {
        try {
            // Only update votes if there is an active poll.
            if (!activePoll) {
                clearInterval(interval); 
                return;
            }
    
            const fetchedMessage = await channel.messages.fetch(activePoll.messageId);
            await updateVotesFromReacts(fetchedMessage, voteCounts);
            savePollVotes(voteCounts);
        } catch (error) {
            console.error('Error fetching message or updating votes:', error);
            reportError(client, null, 'Error updating votes from reactions.');
        }
    }, 30000);

    const filter = (reaction, user) => ['1️⃣', '2️⃣', '3️⃣'].includes(reaction.emoji.name);
    const collector = message.createReactionCollector({ filter, time: POLL_DURATION });

    collector.on('end', () => {
        clearInterval(interval);
        closeTaskPoll(client, message, tasks);
    });

    savePollData();
}

async function closeTaskPoll(client) {
    if (!activePoll) {
        return;
    }

    const channel = getChannelByName(client, '📆weekly-task');
    const message = await channel.messages.fetch(activePoll.messageId);
    const tasks = activePoll.tasks;
    const voteCounts = loadPollVotes();

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
        console.log('Tied votes, randomly selecting winner from tied options.');
    } else {
        winningIndex = voteCounts.indexOf(maxVotes);
    }

    const winningTask = tasks[winningIndex];

    if (!winningTask) {
        reportError(client, null, 'No winning task found.');
        return null;
    }

    activePoll = null;
    savePollData();
    voteCounts.fill(0);
    savePollVotes(voteCounts);
    return winningTask;
}

function createTaskAnnouncementEmbed(task, submissionChannel, instructionText, uniqueKeyword) {
    return new EmbedBuilder()
        .setTitle("This Week's Task")
        .setDescription(`**${task.taskName}**
        \n**Submission instructions**: 
        ${instructionText}
        \nFor tasks with two amounts, the left number is the amount required for main game players and the right number is the amount required for Leagues players. Leagues submissions must have the relic overlay turned on.
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

    if (taskAnnouncementSchedule) {
        clearTimeout(taskAnnouncementSchedule);
    }

    console.log(`Next task announcement scheduled in ${(timeUntilNextTask / 1000 / 60 / 60).toFixed(2)} hours.`);

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

    // Announce the winner
    const announcementEmbed = new EmbedBuilder()
        .setTitle('And the winner is...')
        .setDescription('In the last month, there were...\n\n **' + totalSubmissions + '** submissions from **' + totalParticipants + '** participants!\n\n**The winner is <@' + winnerId + '>!**\n\n Congratulations! Please message an admin to claim your prize.')
        .setColor("#0000FF");

    const role = getRoleByName(channel.guild, 'Community event/competition');
    await channel.send({
        content: `<@&${role.id}>`,
        embeds: [announcementEmbed]
    });

    // Reset monthly user submissions
    saveUsers(pathTaskMonthlyUsers, []);

    console.log('Monthly winner announced and taskMonthlyUsers.json reset.');
}

async function handleTaskCommands(message, client) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'taskhelp') {
        let helpMessage = `
    📥 **BustinBot's Task Commands** 📥
    
**These commands require the BustinBot Admin role.**
- **!taskpoll**: Create a new task poll for the community to vote on.
- **!announcetask**: Close the active poll and announce the active task for the current week.
- **!rollwinner**: Randomly select a winner from the task submissions.
- **!listtasks**: Display a list of all available tasks and their details.
- **!activetask**: Show the details of the currently active task.
- **!monthlycompletions**: List all users and the number of tasks they have completed for the month.
- **!allcompletions**: List all users and the number of tasks they have completed.
- **!activepoll**: Display the active task poll and the current voting status.
- **!settask <task ID> [amount]**: Set a specific task as the active one, with an optional amount. Should only be used ahead of the scheduled task announcement if the poll breaks.
   
**Note**: Ensure that you have the required permissions before using these commands. The Task Admin role only has the ability to approve task submissions in the task-submissions channel.
    `;

        message.reply(helpMessage);
        return;
    }

    // Limit commands to BustinBot admins
    if (message.member.roles.cache.some(role => role.name === 'BustinBot Admin')) {
        if (command === 'taskpoll') {
            await postTaskPoll(client);
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
            const submissionChannel = getChannelByName(client, '📥task-submissions');

            const now = new Date();
            const nextSunday = new Date(now.setUTCDate(now.getUTCDate() + (7 - now.getUTCDay()))); // Get the next Sunday
            nextSunday.setUTCHours(23, 59, 0, 0); // Set time to 11:59 PM UTC

            const taskEmbed = createTaskAnnouncementEmbed(activeTask, submissionChannel, instructionText);

            await message.channel.send({ embeds: [taskEmbed] });
        }

        if (command === 'monthlycompletions') {
            const monthlyUsers = loadUsers(pathTaskMonthlyUsers);
            let userList = '';

            monthlyUsers.forEach(async user => {
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

        if (command === 'allcompletions') {
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
    } else if (
        command === 'taskpoll' ||
        command === 'announcetask' ||
        command === 'rollwinner' ||
        command === 'listtasks' ||
        command === 'activetask' ||
        command === 'allcompletions' ||
        command === 'monthlycompletions' ||
        command === 'activepoll' ||
        command === 'closetaskpoll' ||
        command === 'settask'
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
    testPollLaunch
};