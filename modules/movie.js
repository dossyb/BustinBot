require('dotenv').config();
const fs = require('fs');
const { EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');

const pathMovies = './data/movie/movies.json';
const pathUserMovieCount = './data/movie/userMovieCount.json';

//Cooldowns
const addMovieCooldown = new Map();
const removeMovieCooldown = new Map();
const COOLDOWN_TIME = 15 * 1000;

const MOVIES_PER_PAGE = 5;
const MAX_MOVIES_PER_USER = 3;

let selectedMovie = null;
let scheduledMovieTime = null;
let scheduledReminders = {};
let activePoll = null;

// Emoji reactions for the poll
const pollEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

function movieLog(...args) {
    console.log(`[MOVIE]`, ...args);
}

// Load movies from JSON file
function loadMovies() {
    if (!fs.existsSync(pathMovies)) {
        const initialData = [];
        fs.writeFileSync(pathMovies, JSON.stringify(initialData, null, 4), 'utf8');
    }
    const data = fs.readFileSync(pathMovies, 'utf8');
    return JSON.parse(data);
}

// Save movies to JSON file
function saveMovies() {
    fs.writeFileSync(pathMovies, JSON.stringify(movieList, null, 4), 'utf8');
}

// Load user movie count from JSON file
function loadUserMovieCount() {
    if (!fs.existsSync(pathUserMovieCount)) {
        const initialData = {};
        fs.writeFileSync(pathUserMovieCount, JSON.stringify(initialData, null, 4), 'utf8');
    }
    const data = fs.readFileSync(pathUserMovieCount, 'utf8');
    return JSON.parse(data);
}

// Save user movie count to JSON file
function saveUserMovieCount() {
    fs.writeFileSync(pathUserMovieCount, JSON.stringify(userMovieCount, null, 4), 'utf8');
}

// Randomly shuffle and pick movies
function getRandomMovies(amount) {
    const shuffledMovies = [...movieList].sort(() => 0.5 - Math.random());
    return shuffledMovies.slice(0, amount);
}

// Find appropriate channel for reminders
function findReminderChannel(guild) {
    let movieNightChannel = guild.channels.cache.find(c => c.name === '🎥movie-night');
    if (movieNightChannel && movieNightChannel.isTextBased()) {
        return movieNightChannel;
    } else {
        // Fallback to general channel
        return guild.channels.cache.find(c => c.name === '✨general' && c.isTextBased());
    }
}

function scheduleReminder(guild, role, messageText, delay, reminderKey) {
    const reminderChannel = findReminderChannel(guild);

    if (!reminderChannel) {
        console.error('No suitable channel found for sending reminders.');
        return;
    }

    const reminderTimeout = setTimeout(() => {
        const currentMovie = selectedMovie ? `We will be watching **${selectedMovie.name}**.` : 'No movie has been selected yet.';

        let pollStatus = '';
        if (activePoll) {
            const pollChannel = guild.channels.cache.get(activePoll.channelId);
            if (pollChannel) {
                pollStatus = `A poll is currently running in ${pollChannel.toString()} to decide the next movie.`;
            }
        }
        reminderChannel.send(`${role.toString()} ${messageText} ${currentMovie} ${pollStatus}`);
        delete scheduledReminders[reminderKey];
    }, delay);

    scheduledReminders[reminderKey] = reminderTimeout;
}

async function closePoll(guild, pollChannel) {
    if (!activePoll) {
        movieLog('No active poll to close.');
        return;
    }

    try {
        const pollMessage = await pollChannel.messages.fetch(activePoll.message);
        if (!pollMessage) {
            movieLog('Poll message not found.');
            activePoll = null;
            return;
        }

        const reactionCounts = [];
        for (const [emoji, reaction] of pollMessage.reactions.cache) {
            const emojiIndex = pollEmojis.indexOf(emoji);
            if (emojiIndex !== -1) {
                const usersReacted = await reaction.users.fetch();
                const voteCount = usersReacted.filter(user => !user.bot).size;

                reactionCounts.push({
                    emoji: emoji,
                    count: voteCount,
                    movieIndex: emojiIndex
                });
            }
        }

        if (reactionCounts.length === 0) {
            pollChannel.send('No votes were cast in the poll.');
            activePoll = null;
            return;
        }

        const maxVoteCount = Math.max(...reactionCounts.map(r => r.count));
        const tiedMovies = reactionCounts.filter(r => r.count === maxVoteCount);

        // Handle tied votes
        if (tiedMovies.length > 1) {
            const adminRole = guild.roles.cache.find(r => r.name === 'BustinBot Admin');
            let tiedMoviesList = 'There is a tie between the following movies:\n';
            tiedMovies.forEach(tied => {
                const tiedMovie = activePoll.movies[tied.movieIndex];
                tiedMoviesList += `${tied.emoji} **${tiedMovie.name}** - added by: *${tiedMovie.suggestedby}*\n`;
            });
            tiedMoviesList += `\n${adminRole} Please pick a movie using the reactions below or let BustinBot choose.`;
            // pollChannel.send(tiedMoviesList);
            const tieMessage = await pollChannel.send(`${tiedMoviesList}`);

            // Add reactions for tied movies and dice emoji for bot's choice
            for (const tied of tiedMovies) {
                await tieMessage.react(tied.emoji);
            }
            await tieMessage.react('🎲');

            const filter = async (reaction, user) => {
                const member = await reaction.message.guild.members.fetch(user.id);
                return (
                    tiedMovies.some(tied => tied.emoji === reaction.emoji.name) ||
                    reaction.emoji.name === '🎲'
                ) && member.roles.cache.has(adminRole.id);
            };

            const collector = tieMessage.createReactionCollector({ filter, max: 1, time: 24 * 60 * 60 * 1000 });

            collector.on('collect', (reaction, user) => {
                if (!activePoll) {
                    movieLog('Poll has already been resolved.');
                    return;
                }

                if (reaction.emoji.name === '🎲') {
                    // Roll between tied movies
                    const randomIndex = Math.floor(Math.random() * tiedMovies.length);
                    const winningReaction = tiedMovies[randomIndex];
                    const winningMovie = activePoll.movies[winningReaction.movieIndex];
                    selectedMovie = winningMovie;
                    pollChannel.send(`BustinBot has decided and the winning movie is **${winningMovie.name}**, added by *${winningMovie.suggestedby}*!`);
                } else {
                    // Admin selects a movie
                    const winningReaction = tiedMovies.find(tied => tied.emoji === reaction.emoji.name);
                    const winningMovie = activePoll.movies[winningReaction.movieIndex];
                    selectedMovie = winningMovie;
                    pollChannel.send(`The winning movie is **${winningMovie.name}**, added by *${winningMovie.suggestedby}*!`);
                }
                movieLog(`"${selectedMovie.name}" selected as the winning movie by ${reaction.emoji.name === '🎲' ? 'bot roll' : 'admin'}.`);
                activePoll = null;
            });

            collector.on('end', collected => {
                if (collected.size === 0) {
                    pollChannel.send('No movie was selected. Poll has been deleted.');
                    activePoll = null;
                }
            });
        } else {
            const winningReaction = tiedMovies[0];
            const winningMovie = activePoll.movies[winningReaction.movieIndex];
            selectedMovie = winningMovie;
            pollChannel.send(`The winning movie is **${winningMovie.name}**, added by *${winningMovie.suggestedby}*!`);
            movieLog(`"${selectedMovie.name}" selected as the winning movie by poll.`);
            activePoll = null;
        }
    } catch (error) {
        movieLog('Error closing poll:', error);
        pollChannel.send('An error occurred while closing the poll, poll has been deleted to avoid bot breakage.');
        activePoll = null;
    }
}

function schedulePollClose(guild) {
    if (!activePoll) {
        movieLog('No active poll to schedule closure for.');
        return;
    }

    const pollChannel = guild.channels.cache.get(activePoll.channelId);
    if (!pollChannel) {
        movieLog('Poll channel not found. Unable to schedule poll closure.');
        return;
    }

    // Determine closure time - either 24 hours after poll start or 30 mins before movie night
    const now = Date.now();
    const pollStartTime = now;
    const pollEndTime = pollStartTime + 24 * 60 * 60 * 1000;

    // If scheduled movie night, calc 30 mins before
    const movieNightCloseTime = scheduledMovieTime
        ? scheduledMovieTime * 1000 - 30 * 60 * 1000
        : null;

    const closeTime = movieNightCloseTime
        ? Math.min(pollEndTime, movieNightCloseTime)
        : pollEndTime;

    const delay = closeTime - now;

    if (delay <= 0) {
        closePoll(guild, pollChannel);
        return;
    }

    const closeTimeFormatted = new Date(closeTime).toLocaleString();
    movieLog(`Poll will automatically close at ${closeTimeFormatted}.`);
    setTimeout(() => closePoll(guild, pollChannel), delay);
}


function removeMovieFromList(movieName, client) {
    const movieIndex = movieList.findIndex(movie => movie.name.toLowerCase() === movieName.toLowerCase());
    if (movieIndex !== -1) {
        const removedMovie = movieList.splice(movieIndex, 1)[0];
        const userTag = removedMovie.suggestedby;

        // Check if the user exists in the cache
        const userId = Object.keys(userMovieCount).find(id => {
            const user = client.users.cache.get(id);
            return user && user.tag === userTag;
        });

        // Only update movie count if the user is found
        if (userId && userMovieCount[userId] > 0) {
            userMovieCount[userId]--;
            saveUserMovieCount();
        }

        saveMovies();
        return removedMovie;
    }
    return null;
}

// Cooldown helper function
function checkCooldown(cooldownMap, userId) {
    const currentTime = Date.now();
    const cooldownEnd = cooldownMap.get(userId);

    if (cooldownEnd && currentTime < cooldownEnd) {
        const timeLeft = ((cooldownEnd - currentTime) / 1000).toFixed(0);
        return `Please wait ${timeLeft} more seconds before using this command again.`;
    }

    return null;
}

// Set cooldown function
function setCooldown(cooldownMap, userId) {
    const currentTime = Date.now();
    cooldownMap.set(userId, currentTime + COOLDOWN_TIME);
}

let movieList = loadMovies();
let userMovieCount = loadUserMovieCount();

async function handleMovieCommands(message, client) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    const movieNightRole = message.guild.roles.cache.find(r => r.name === 'Movie Night');
    const adminRole = message.guild.roles.cache.find(r => r.name === 'BustinBot Admin');

    if (!movieNightRole || !adminRole) {
        console.error("Movie Night or BustinBot Admin role not found.");
        message.channel.send("An error occurred: Required roles not found on this server.");
        return;
    }

    const hasMovieNightOrAdminRole = message.member.roles.cache.some(role =>
        role.id === movieNightRole.id || role.id === adminRole.id
    );
    const hasAdminRole = message.member.roles.cache.some(role => role.id === adminRole.id);

    const movieCommands = ['addmovie', 'removemovie', 'removie', 'editmovie', 'movielist', 'listmovie',
        'movie', 'currentmovie', 'moviecount', 'countmovie', 'selectmovie', 'pickmovie', 'rollmovie',
        'randommovie', 'pollmovie', 'pollclose', 'closepoll', 'movienight', 'cancelmovie', 'endmovie', 'moviehelp'
    ];

    if (command === 'moviehelp') {
        let helpMessage = `
🎥 **BustinBot's Movie Commands** 🎥

**Use of these commands requires the "Movie Night" role.**
- **!addmovie <name>**: Add a movie to the list.
- **!removemovie <name|number>**/**!removie <name|number>**: Remove a movie from the list by its name or number. Standard users can only remove movies they have added.
- **!editmovie <number> <new name>**: Edit a movie's name. Standard users can only edit movies they have added.
- **!movielist**/**!listmovie**: Show a numbered list of all movies in the list.
- **!movie <name|number>**: Show details of a specific movie by its name or number.
- **!currentmovie**: Show the currently selected movie and the scheduled movie night time (if any).
- **!moviecount**/**!countmovie**: List the movies you have added and show how many you can still add.
`;

        if (hasAdminRole) {
            helpMessage += `
**Admins**:
- **!selectmovie <name|number>**/**!pickmovie <name|number>**: Select a movie from the list by its name or number for movie night. 
- **!rollmovie**/**!randommovie**: Randomly select a movie from the list. 
- **!pollmovie <amount>**: Randomly select <amount> of movies from the list and create a poll with them as options. 
- **!pollmovie <m1>, <m2>, <m3> ...**: Create a poll with the specified movies as options.
- **!pollclose**/**!closepoll**: Close the active poll, count the votes, and select the winning movie.
- **!movienight <YYYY-MM-DD HH:mm>**: Schedule a movie night at a specific time (within 3 weeks). 
- **!cancelmovie**: Cancel the scheduled movie night and all reminders. 
- **!endmovie**: End the current movie night, remove the selected movie from the list, and clear the schedule. 
- **!moviehelp**: Show this list of commands.
`;
        }

        helpMessage += `
For the **number-based commands**, you can reference a movie by its position in the list shown in **!movielist**. Example: "!movie 2" to view the second movie in the list.
        `;
        message.reply(helpMessage);
    }

    if (movieCommands.includes(command) && !hasMovieNightOrAdminRole && command !== 'moviehelp') {
        message.reply('You must have the "Movie Night" role to use movie commands. Use `!moviehelp` for more info.');
    }

    else if (movieCommands.includes(command) && !hasAdminRole && ['selectmovie', 'pickmovie', 'rollmovie', 'randommovie', 'pollmovie', 'pollclose', 'closepoll', 'movienight', 'cancelmovie', 'endmovie'].includes(command)) {
        message.reply('You do not have permission to use this command.');
    }

    if (hasMovieNightOrAdminRole) {
        if (command === 'addmovie') {
            const userId = message.author.id;

            if (!hasAdminRole) {
                const cooldownMessage = checkCooldown(addMovieCooldown, userId);
                if (cooldownMessage) {
                    message.reply(cooldownMessage);
                    return;
                }

                if (!userMovieCount[userId]) {
                    userMovieCount[userId] = 0;
                }

                if (userMovieCount[userId] >= MAX_MOVIES_PER_USER) {
                    message.reply(`You have reached the maximum limit of ${MAX_MOVIES_PER_USER} movies per user.`);
                    return;
                }
            }

            const movieName = args.join(' ');

            if (!movieName) {
                message.reply('Please provide a movie name.');
                return;
            }

            const movieObject = {
                name: movieName,
                suggestedby: message.author.tag,
                userId: userId
            };

            movieList.push(movieObject);
            saveMovies();

            const moviePosition = movieList.length;

            movieLog(`User ${message.author.tag} added movie "${movieName}" (${moviePosition}) to the list.`);

            if (!hasAdminRole) {
                userMovieCount[userId]++;
                saveUserMovieCount();

                const moviesLeft = MAX_MOVIES_PER_USER - userMovieCount[userId];
                message.reply(`Added **${movieName}** (${moviePosition}) to the movie list. You can add ${moviesLeft} more movie(s).`);
            } else {
                message.reply(`Added **${movieName}** (${moviePosition}) to the movie list.`);
            }

            if (!hasAdminRole) {
                setCooldown(addMovieCooldown, userId);
            }

            return;
        }

        if (command === 'editmovie') {
            const userId = message.author.id;

            // Check if user provided required arguments
            const movieNumber = args[0];
            const newMovieName = args.slice(1).join(' ');

            if (!movieNumber || !newMovieName) {
                message.reply('Please provide a movie number and a new movie name. Example: `!editmovie 2 New Movie Name`.');
                return;
            }

            let movieIndex;
            let movieToEdit;

            // Find movie in the list
            if (!isNaN(movieNumber)) {
                movieIndex = parseInt(movieNumber) - 1;

                if (movieIndex < 0 || movieIndex >= movieList.length) {
                    message.reply(`Invalid movie number. Please provide a valid number between 1 and ${movieList.length}.`);
                    return;
                }

                movieToEdit = movieList[movieIndex];
            } else {
                movieIndex = movieList.findIndex(m => m.name.toLowerCase() === movieNumber.toLowerCase());

                if (movieIndex === -1) {
                    message.reply(`Movie **${movieNumber}** not found in the list.`);
                    return;
                }

                movieToEdit = movieList[movieIndex];
            }

            // Check if user has permission to edit the movie
            const hasAdminRole = message.member.roles.cache.some(role => role.name === 'BustinBot Admin');

            if (movieToEdit.suggestedby !== message.author.tag && !hasAdminRole) {
                message.reply(`You can only edit movies that you have added. Movie #${movieIndex + 1} was added by *${movieToEdit.suggestedby}*.`);
                return;
            }

            // Edit the movie
            const oldMovieName = movieToEdit.name;
            movieToEdit.name = newMovieName;
            saveMovies();

            movieLog(`User ${message.author.tag} edited movie: "${oldMovieName}" to "${newMovieName}" (${movieIndex + 1}).`);

            message.reply(`Updated movie **${oldMovieName}** to **${newMovieName}**.`);
        }

        if (command === 'removemovie' || command === 'removie') {
            const userId = message.author.id;

            if (!hasAdminRole) {
                const cooldownMessage = checkCooldown(removeMovieCooldown, userId);
                if (cooldownMessage) {
                    message.reply(cooldownMessage);
                    return;
                }
            }

            const input = args.join(' ');

            if (!input) {
                message.reply('Please provide a movie name or its list number to remove.');
                return;
            }

            // Find movie in the list
            let movieIndex;
            let removedMovie;
            let movieOwnerId;

            // Refactor to a function later
            if (!isNaN(input)) {
                movieIndex = parseInt(input) - 1;

                if (movieIndex < 0 || movieIndex >= movieList.length) {
                    message.reply(`Invalid movie number. Please provide a valid number between 1 and ${movieList.length}.`);
                    return;
                }

                const movie = movieList[movieIndex];
                movieOwnerId = movie.userId;

                if (movieOwnerId !== userId && !hasAdminRole) {
                    message.reply(`You can only remove movies that you have added. Movie #${input} was added by *${movie.suggestedby}*.`);
                    return;
                }

                removedMovie = movieList.splice(movieIndex, 1)[0];
            } else {
                movieIndex = movieList.findIndex(m => m.name.toLowerCase() === input.toLowerCase());

                if (movieIndex === -1) {
                    message.reply(`Movie **${input}** not found in the list.`);
                    return;
                }

                const movie = movieList[movieIndex];
                movieOwnerId = movie.userId;

                if (movieOwnerId !== userId && !hasAdminRole) {
                    message.reply(`You can only remove movies that you have added. Movie **${input}** was added by *${movie.suggestedby}*.`);
                    return;
                }

                removedMovie = movieList.splice(movieIndex, 1)[0];
            }

            saveMovies();
            movieLog(`User ${message.author.tag} removed movie: "${removedMovie.name}" (${movieIndex + 1}).`);
            message.reply(`Removed **${removedMovie.name}** from the movie list.`);

            if (userMovieCount[movieOwnerId] > 0) {
                userMovieCount[movieOwnerId]--;
                saveUserMovieCount();

                if (movieOwnerId === userId) {
                    const moviesLeft = MAX_MOVIES_PER_USER - userMovieCount[movieOwnerId];
                    message.channel.send(`You can now add ${moviesLeft} more movie(s).`);
                }
            }

            if (!hasAdminRole) {
                setCooldown(removeMovieCooldown, userId);
            }
        }

        if (command === 'listmovie' || command === 'movielist') {
            if (movieList.length === 0) {
                message.channel.send('The movie list is empty.');
                return;
            }

            let currentPage = 1;
            const totalPages = Math.ceil(movieList.length / MOVIES_PER_PAGE);

            // Generate movie list embed for a specific page
            const generateEmbed = (page) => {
                const startIndex = (page - 1) * MOVIES_PER_PAGE;
                const endIndex = Math.min(startIndex + MOVIES_PER_PAGE, movieList.length);

                const embed = new EmbedBuilder()
                    .setTitle('🎥 Movie List 🎥')
                    .setDescription(`Page ${page} of ${totalPages}`)
                    .setColor('#0099ff');

                movieList.slice(startIndex, endIndex).forEach((movie, index) => {
                    embed.addFields({ name: `${startIndex + index + 1}. ${movie.name}`, value: `Added by: *${movie.suggestedby}*` });
                });

                return embed;
            };

            // Send the initial embed
            const embedMessage = await message.reply({ embeds: [generateEmbed(currentPage)] });

            // Add reactions for navigation
            if (totalPages > 1) {
                await embedMessage.react('⏪');
                await embedMessage.react('⏩');
            }

            // Create a reaction collector
            const filter = (reaction, user) => { return ['⏪', '⏩'].includes(reaction.emoji.name) && user.id === message.author.id && !user.bot; };
            const collector = embedMessage.createReactionCollector({ filter, time: 24 * 60 * 60 * 1000 });

            collector.on('collect', (reaction, user) => {
                reaction.users.remove(user);

                if (reaction.emoji.name === '⏩') {
                    if (currentPage < totalPages) {
                        currentPage++;
                        embedMessage.edit({ embeds: [generateEmbed(currentPage)] });
                    }
                } else if (reaction.emoji.name === '⏪') {
                    if (currentPage > 1) {
                        currentPage--;
                        embedMessage.edit({ embeds: [generateEmbed(currentPage)] });
                    }
                }
            });

            collector.on('end', () => {
                embedMessage.reactions.removeAll()
                    .then(() => embedMessage.delete())
                    .catch(console.error);
            });
        }

        if (command === 'movie') {
            const input = args.join(' ');

            if (!input) {
                message.reply('Please provide a movie name or its list number to view.');
                return;
            }

            let movieIndex;
            let movieToShow;

            // Check if input is a number
            if (!isNaN(input)) {
                movieIndex = parseInt(input) - 1;

                if (movieIndex < 0 || movieIndex >= movieList.length) {
                    message.reply(`Invalid movie number. Please provide a valid number between 1 and ${movieList.length}.`);
                    return;
                }

                movieToShow = movieList[movieIndex];
            } else {
                movieIndex = movieList.findIndex(m => m.name.toLowerCase() === input.toLowerCase());

                if (movieIndex === -1) {
                    message.reply(`Movie **${input}** not found in the list.`);
                    return;
                }

                movieToShow = movieList[movieIndex];
            }

            // Display movie position, name and who added it
            message.channel.send(`Number: ${movieIndex + 1}\nMovie: **${movieToShow.name}**\nAdded by: *${movieToShow.suggestedby}*`);
        }

        if (command === 'currentmovie') {
            let response = '';
            if (!selectedMovie) {
                response += 'No movie has been selected for movie night.';
            } else {
                response += `The selected movie for next movie night is **${selectedMovie.name}**.`;
            }

            if (scheduledMovieTime) {
                response += ` Movie night is scheduled for <t:${scheduledMovieTime}:F>.`;
            } else {
                response += ' Movie night has not been scheduled yet.';
            }
            message.channel.send(response);
        }

        if (command === 'moviecount' || command === 'countmovie') {
            const userId = message.author.id;

            if (!userMovieCount[userId]) {
                userMovieCount[userId] = 0;
            }

            const moviesLeft = MAX_MOVIES_PER_USER - userMovieCount[userId];
            const moviesAdded = movieList.filter(movie => movie.suggestedby === message.author.tag);

            let response = `You have ${moviesLeft} movie(s) left to add.\n\n**Movies added by you:**\n`;

            if (moviesAdded.length === 0) {
                response += 'No movies added yet.';
            } else {
                moviesAdded.forEach((movie, index) => {
                    response += `${index + 1}. **${movie.name}**\n`;
                });
            }

            message.reply(response);
            return;
        }
    }

    if (hasAdminRole) {
        if (command === 'movienight') {
            const timeInput = args.join(' ');

            if (!timeInput) {
                message.reply('Please provide a valid time for the movie night (e.g., `!movienight 2024-09-30 18:00`).');
                return;
            }

            const timezone = process.env.TIMEZONE || 'Europe/London';
            const movieTime = moment.tz(timeInput, 'YYYY-MM-DD HH:mm', timezone);

            if (!movieTime.isValid()) {
                message.reply('Invalid date and time format. Please use `YYYY-MM-DD HH:mm`.');
                return;
            }

            const now = moment();
            const timeUntilMovie = movieTime.diff(now);

            const maxTimeAllowed = moment.duration(21, 'days').asMilliseconds(); // 21 days

            if (timeUntilMovie > maxTimeAllowed) {
                message.channel.send('Movie night cannot be scheduled more than 3 weeks in advance.');
                return;
            }

            const unixTimestamp = movieTime.unix();
            scheduledMovieTime = unixTimestamp;

            if (timeUntilMovie <= 0) {
                message.channel.send('The movie night time must be in the future.');
                return;
            }

            const twoHoursBefore = timeUntilMovie - moment.duration(2, 'hours').asMilliseconds();
            const fifteenMinutesBefore = timeUntilMovie - moment.duration(15, 'minutes').asMilliseconds();

            const role = message.guild.roles.cache.find(r => r.name === 'Movie Night');
            if (!role) {
                message.channel.send('"Movie Night" role not found.');
                return;
            }

            // Clear existing reminders
            if (scheduledReminders.twoHoursBefore) {
                clearTimeout(scheduledReminders.twoHoursBefore);
                delete scheduledReminders.twoHoursBefore;
            }
            if (scheduledReminders.fifteenMinutesBefore) {
                clearTimeout(scheduledReminders.fifteenMinutesBefore);
                delete scheduledReminders.fifteenMinutesBefore;
            }
            if (scheduledReminders.movieTime) {
                clearTimeout(scheduledReminders.movieTime);
                delete scheduledReminders.movieTime;
            }

            // Check if a movie is selected
            const movieMessage = selectedMovie
                ? `We will be watching **${selectedMovie.name}**.`
                : 'No movie has been selected yet.';

            movieLog(`Movie night scheduled for ${movieTime.format('YYYY-MM-DD HH:mm:ss z')} by ${message.author.tag}.`);
            message.channel.send(`Movie night has been scheduled for <t:${unixTimestamp}:F>! ${movieMessage} Reminders will be sent at <t:${Math.floor((unixTimestamp - 2 * 60 * 60))}:T> and <t:${Math.floor((unixTimestamp - 15 * 60))}:T>.`);

            if (twoHoursBefore > 0) {
                scheduleReminder(message.guild, role, `Reminder: Movie night starts in 2 hours!`, twoHoursBefore, 'twoHoursBefore');
            }

            if (fifteenMinutesBefore > 0) {
                scheduleReminder(message.guild, role, `Reminder: Movie night starts in 15 minutes!`, fifteenMinutesBefore, 'fifteenMinutesBefore');
            }

            scheduleReminder(message.guild, role, `Movie night is starting now! Join us in the movies channel!`, timeUntilMovie, 'movieTime');

            // Check for active poll and update closure time if necessary
            if (activePoll) {
                const pollChannel = message.guild.channels.cache.get(activePoll.channelId);
                if (pollChannel) {
                    const pollStartTime = Date.now();
                    const pollEndTime = pollStartTime + 24 * 60 * 60 * 1000;
                    const movieNightCloseTime = scheduledMovieTime * 1000 - 30 * 60 * 1000;
                    const closeTime = Math.min(pollEndTime, movieNightCloseTime);
                    const delay = closeTime - pollStartTime;

                    if (delay <= 0) {
                        movieLog('Scheduled movie night is less than 30 minutes away, closing poll...');
                        message.channel.send('Scheduled movie night is less than 30 minutes away, closing poll...');
                        closePoll(message.guild, pollChannel);
                    } else {
                        const closeTimeFormatted = new Date(closeTime).toLocaleString();
                        movieLog(`Poll closure time updated to ${closeTimeFormatted}.`);
                        message.channel.send(`Poll closure time has been updated to <t:${Math.floor(closeTime / 1000)}:F>.`);
                        setTimeout(() => closePoll(message.guild, pollChannel), delay);
                    }
                }
            }
        }

        if (command === 'pickmovie' || command === 'selectmovie') {
            const input = args.join(' ');

            if (!input) {
                message.reply('Please provide a movie name or its list number to select.');
                return;
            }

            let movieName;
            if (!isNaN(input)) {
                const movieIndex = parseInt(input) - 1;
                if (movieIndex >= 0 && movieIndex < movieList.length) {
                    movieName = movieList[movieIndex];
                }
            } else {
                movieName = movieList.find(m => m.name.toLowerCase() === input.toLowerCase());
            }

            if (!movieName) {
                message.reply(`Movie **${input}** not found in the list.`);
                return;
            } else {
                selectedMovie = movieName;
                movieLog(`"${selectedMovie.name}" selected for movie night by ${message.author.tag}.`);
                message.channel.send(`Next movie: **${selectedMovie.name}**`);
            }
        }

        if (command === 'cancelmovie') {
            if (scheduledReminders.twoHoursBefore) {
                clearTimeout(scheduledReminders.twoHoursBefore);
                delete scheduledReminders.twoHoursBefore;
            }
            if (scheduledReminders.fifteenMinutesBefore) {
                clearTimeout(scheduledReminders.fifteenMinutesBefore);
                delete scheduledReminders.fifteenMinutesBefore;
            }
            if (scheduledReminders.movieTime) {
                clearTimeout(scheduledReminders.movieTime);
                delete scheduledReminders.movieTime;
            }
            selectedMovie = null;
            scheduledMovieTime = null;
            movieLog(`Movie night cancelled by ${message.author.tag}.`);
            message.channel.send('Movie night and all scheduled reminders have been cancelled.');
        }

        if (command === 'endmovie') {
            if (!selectedMovie) {
                message.reply('There is no active movie night to end.');
                return;
            }

            // Cancel any scheduled reminders
            if (scheduledReminders.twoHoursBefore) {
                clearTimeout(scheduledReminders.twoHoursBefore);
                delete scheduledReminders.twoHoursBefore;
            }
            if (scheduledReminders.fifteenMinutesBefore) {
                clearTimeout(scheduledReminders.fifteenMinutesBefore);
                delete scheduledReminders.fifteenMinutesBefore;
            }
            if (scheduledReminders.movieTime) {
                clearTimeout(scheduledReminders.movieTime);
                delete scheduledReminders.movieTime;
            }

            const removedMovie = removeMovieFromList(selectedMovie.name, client);
            selectedMovie = null;
            scheduledMovieTime = null;

            movieLog(`Movie night ended by ${message.author.tag}.`);
            message.channel.send(`Thanks for watching! I hope you all enjoyed **${removedMovie.name}**, it has now been removed from the list.`);
        }

        if (command === 'rollmovie' || command === 'randommovie') {
            if (movieList.length === 0) {
                message.channel.send('The movie list is empty.');
                return;
            }

            const shuffledMovieList = [...movieList];

            const randomIndex = Math.floor(Math.random() * shuffledMovieList.length);
            selectedMovie = shuffledMovieList[randomIndex];
            message.channel.send(`Selected movie: **${selectedMovie.name}** (${randomIndex + 1})`);
        }

        if (command === 'pollmovie' || command === 'moviepoll') {
            // Check if movie starts within 30 minutes and prevent poll creation
            const now = Date.now();
            const halfHourInMillis = 30 * 60 * 1000;

            if (scheduledMovieTime && scheduledMovieTime * 1000 - now <= halfHourInMillis) {
                message.reply('You cannot start a poll within 30 minutes of the movie night start time.');
                return;
            }

            if (args.length === 1 && !isNaN(args[0])) {
                // Option 1: !pollmovie <amount>
                const amount = parseInt(args[0], 10);

                if (isNaN(amount) || amount <= 0) {
                    message.reply('Please provide a valid number of movies to choose from.');
                    return;
                }

                const moviesByUser = movieList.reduce((acc, movie) => {
                    if (!acc[movie.suggestedby]) {
                        acc[movie.suggestedby] = [];
                    }
                    acc[movie.suggestedby].push(movie);
                    return acc;
                }, {});

                const uniqueUsers = Object.keys(moviesByUser);

                // Check if the number of movies requested exceeds the number of users
                if (amount > uniqueUsers.length) {
                    message.reply(`You requested ${amount} movies, but only ${uniqueUsers.length} unique users have added movies. Please choose a smaller number.`);
                    return;
                }

                if (amount > pollEmojis.length) {
                    message.reply(`You requested ${amount} movies, but the maximum number of movies for a poll is ${pollEmojis.length}.`);
                    return;
                }

                // Randomly shuffle the list of users
                const shuffledUsers = [...uniqueUsers].sort(() => 0.5 - Math.random());

                // Select one movie from each user
                const selectedMovies = shuffledUsers.slice(0, amount).map(user => {
                    const userMovies = moviesByUser[user];
                    return userMovies[Math.floor(Math.random() * userMovies.length)];
                });

                let pollMessage = '🎥 **Movie Night Poll** 🎥\nPlease vote for a movie by reacting with the corresponding emoji:\n';
                selectedMovies.forEach((movie, index) => {
                    pollMessage += `${pollEmojis[index]} **${movie.name}** - added by: *${movie.suggestedby}*\n`;
                });

                const poll = await message.channel.send(pollMessage);

                // Store active poll info for !pollclose
                activePoll = {
                    message: poll.id,
                    movies: selectedMovies,
                    channelId: message.channel.id
                };

                for (let i = 0; i < selectedMovies.length; i++) {
                    await poll.react(pollEmojis[i]);
                }

                schedulePollClose(message.guild);
                message.channel.send('To end the poll and count the votes, use `!pollclose`. Otherwise, the poll will automatically close after 24 hours or 30 minutes before movie night (whichever comes first).');
            } else {
                // Option 2: !pollmovie <m1>, <m2>, <m3>, ...
                const selectedMovies = [];
                const movieArgs = args.join(' ').split(',').map(arg => arg.trim());

                const addedMovies = new Set();

                for (const arg of movieArgs) {
                    let movie;
                    if (!isNaN(arg)) {
                        const movieIndex = parseInt(arg) - 1;
                        if (movieIndex >= 0 && movieIndex < movieList.length) {
                            movie = movieList[movieIndex];
                        }
                    } else {
                        movie = movieList.find(m => m.name.toLowerCase() === arg.toLowerCase());
                    }

                    if (movie) {
                        if (addedMovies.has(movie.name.toLowerCase())) {
                            message.reply(`Duplicate movie **${movie.name}** detected in the list. Please try again.`);
                            return;
                        }
                        selectedMovies.push(movie);
                        addedMovies.add(movie.name.toLowerCase());
                    } else {
                        message.reply(`Movie **${arg}** not found in the list. There are only ${movieList.length} movies in the list. Please try again.`);
                        return;
                    }
                }

                if (selectedMovies.length > pollEmojis.length) {
                    message.reply(`The maximum number of movies for a poll is ${pollEmojis.length}. Please try again.`);
                    return;
                }

                let pollMessage = '🎥 **Movie Night Poll** 🎥\nPlease vote for a movie by reacting with the corresponding emoji:\n';
                selectedMovies.forEach((movie, index) => {
                    pollMessage += `${pollEmojis[index]} **${movie.name}** - added by: *${movie.suggestedby}*\n`;
                });

                const poll = await message.channel.send(pollMessage);

                // Store active poll info for !pollclose
                activePoll = {
                    message: poll.id,
                    movies: selectedMovies,
                    channelId: message.channel.id
                };

                for (let i = 0; i < selectedMovies.length; i++) {
                    await poll.react(pollEmojis[i]);
                }

                schedulePollClose(message.guild);
                message.channel.send('To end the poll and count the votes, use `!pollclose`. Otherwise, the poll will automatically close after 24 hours or 30 minutes before movie night (whichever comes first).');
            }
        }

        if (command === 'pollclose' || command === 'closepoll' || command === 'endpoll' || command === 'pollend') {
            message.channel.send('Closing the movie poll and counting votes...');
            if (!activePoll) {
                message.reply('There is no active movie poll to close.');
                return;
            }

            const pollChannel = message.guild.channels.cache.get(activePoll.channelId);
            if (!pollChannel) {
                message.reply('The poll channel could not be found.');
                activePoll = null;
                return;
            }

            movieLog(`Manual poll closure requested by ${message.author.tag}.`);
            closePoll(message.guild, pollChannel);
        }
    }
}

module.exports = {
    loadMovies,
    saveMovies,
    loadUserMovieCount,
    saveUserMovieCount,
    handleMovieCommands
};