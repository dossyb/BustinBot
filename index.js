require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const botMode = process.env.BOT_MODE || 'dev';
const token = botMode === 'dev' ? process.env.DISCORD_TOKEN_DEV : process.env.DISCORD_TOKEN_LIVE;
const fs = require('fs');
const moment = require('moment');
const path = './movies.json';
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions] });

//Cooldowns
const addMovieCooldown = new Map();
const removeMovieCooldown = new Map();
const COOLDOWN_TIME = 15 * 1000;

const MOVIES_PER_PAGE = 5;
const MAX_MOVIES_PER_USER = 3;

let movieList = [];
let selectedMovie = null;
let scheduledMovieTime = null;
let scheduledReminders = {};
let userMovieCount = {};

// Emoji reactions for the poll
const pollEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

// Load movies from JSON file
function loadMovies() {
    if (fs.existsSync(path)) {
        movieList = JSON.parse(fs.readFileSync(path, 'utf8'));
    }
}

// Save movies to JSON file
function saveMovies() {
    fs.writeFileSync(path, JSON.stringify(movieList, null, 4), 'utf8');
}

// Randomly shuffle and pick movies
function getRandomMovies(amount) {
    const shuffledMovies = [...movieList].sort(() => 0.5 - Math.random());
    return shuffledMovies.slice(0, amount);
}

function scheduleReminder(channel, role, messageText, delay) {
    setTimeout(() => {
        const currentMovie = selectedMovie ? `We will be watching **${selectedMovie.name}**.` : 'No movie has been selected yet.';
        channel.send(`${role.toString()} ${messageText} ${currentMovie}`);
    }, delay);
}

function removeMovieFromList(movieName) {
    const movieIndex = movieList.findIndex(movie => movie.name.toLowerCase() === movieName.toLowerCase());
    if (movieIndex !== -1) {
        const removedMovie = movieList.splice(movieIndex, 1)[0];
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

client.once('ready', () => {
    console.log(`BustinBot is online in ${botMode} mode!`);
    loadMovies();
});

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!')) return;

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

    if (command === 'bustin') {
        message.channel.send('Bustin\' makes me feel good! <a:Bustin:1290456273522921606>');
        return;
    }

    if (command === 'moviehelp') {
        const helpMessage = `
🎥 **BustinBot's Movie Commands** 🎥

- **!addmovie <name>**: Add a movie to the list.
- **!removemovie <name|number>**/**!removie <name|number>**: Remove a movie from the list by its name or number.
- **!movielist**/**!listmovie**: Show a numbered list of all movies in the list.
- **!movie <name|number>**: Show details of a specific movie by its name or number.
- **!currentmovie**: Show the currently selected movie and the scheduled movie night time (if any).
- **!selectmovie <name|number>**/**!pickmovie <name|number>**: Select a movie from the list by its name or number for movie night. (Admin only)
- **!rollmovie**: Randomly select a movie from the list. (Admin only)
- **!pollmovie <amount>**: Randomly select <amount> of movies from the list and create a poll with them as options. (Admin only)
- **!movienight <YYYY-MM-DD HH:mm>**: Schedule a movie night at a specific time (within 3 weeks). (Admin only)
- **!cancelmovie**: Cancel the scheduled movie night and all reminders. (Admin only)
- **!endmovie**: End the current movie night, remove the selected movie from the list, and clear the schedule. (Admin only)
- **!moviehelp**: Show this list of commands.

For the **number-based commands**, you can reference a movie by its position in the list shown in **!movielist**. Example: "!movie 2" to view the second movie in the list.
        `;
        message.channel.send(helpMessage);
    }

    if (hasMovieNightOrAdminRole) {
        if (command === 'addmovie') {
            const userId = message.author.id;

            if (!hasAdminRole) {
                const cooldownMessage = checkCooldown(addMovieCooldown, userId);
                if (cooldownMessage) {
                    message.channel.send(cooldownMessage);
                    return;
                }

                if (!userMovieCount[userId]) {
                    userMovieCount[userId] = 0;
                }
    
                if (userMovieCount[userId] >= MAX_MOVIES_PER_USER) {
                    message.channel.send(`You have reached the maximum limit of ${MAX_MOVIES_PER_USER} movies per user.`);
                    return;
                }
            }

            const movieName = args.join(' ');
    
            if (!movieName) {
                message.channel.send('Please provide a movie name.');
                return;
            }
    
            const movieObject = {
                name: movieName,
                suggestedby: message.author.tag
            };
    
            movieList.push(movieObject);
            saveMovies();
    
            const moviePosition = movieList.length;
    
            message.channel.send(`Added **${movieName}** (${moviePosition}) to the movie list.`);

            if (!hasAdminRole) {
                userMovieCount[userId]++;
                setCooldown(addMovieCooldown, userId);
            }
        }

        if (command === 'removemovie' || command === 'removie') {
            const userId = message.author.id;

            if (!hasAdminRole) {
                const cooldownMessage = checkCooldown(removeMovieCooldown, userId);
                if (cooldownMessage) {
                    message.channel.send(cooldownMessage);
                    return;
                }
            }

            const input = args.join(' ');
    
            if (!input) {
                message.channel.send('Please provide a movie name or its list number to remove.');
                return;
            }

            // Find movie in the list
            let movieIndex;
            let removedMovie;

            // Refactor to a function later
            if (!isNaN(input)) {
                movieIndex = parseInt(input) - 1;

                if (movieIndex < 0 || movieIndex >= movieList.length) {
                    message.channel.send(`Invalid movie number. Please provide a valid number between 1 and ${movieList.length}.`);
                    return;
                }
                
                const movie = movieList[movieIndex];

                if (movie.suggestedby !== message.author.tag && !hasAdminRole) {
                    message.channel.send(`You can only remove movies that you have added. Movie #${input} was added by *${movie.suggestedby}*.`);
                    return;
                }

                removedMovie = movieList.splice(movieIndex, 1)[0];
            } else {
                movieIndex = movieList.findIndex(m => m.name.toLowerCase() === input.toLowerCase());

                if (movieIndex === -1) {
                    message.channel.send(`Movie **${input}** not found in the list.`);
                    return;
                }

                const movie = movieList[movieIndex];

                if (movie.suggestedby !== message.author.tag && !hasAdminRole) {
                    message.channel.send(`You can only remove movies that you have added. Movie **${input}** was added by *${movie.suggestedby}*.`);
                    return;
                }

                removedMovie = movieList.splice(movieIndex, 1)[0];
            }

            saveMovies();
            message.channel.send(`Removed **${removedMovie.name}** from the movie list.`);

            // let removedMovie;
            // if (!isNaN(input)) {
            //     const movieIndex = parseInt(input) - 1;
            //     if (movieIndex >= 0 && movieIndex < movieList.length) {
            //         removedMovie = movieList.splice(movieIndex, 1)[0];
            //         saveMovies();
            //     }
            // } else {
            //     removedMovie = removeMovieFromList(input);
            // }
    
            // if (!removedMovie){
            //     message.channel.send(`Movie "${input}" not found in the list.`);
            // } else {
            //     message.channel.send(`Removed **${removedMovie.name}** from the movie list.`);
            // }

            if (!hasAdminRole) {
                userMovieCount[userId]--;
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
            const embedMessage = await message.channel.send({ embeds: [generateEmbed(currentPage)] });

            // Add reactions for navigation
            if (totalPages > 1) {
                await embedMessage.react('⏪');
                await embedMessage.react('⏩');
            }

            // Create a reaction collector
            const filter = (reaction, user) => { return ['⏪', '⏩'].includes(reaction.emoji.name) && user.id === message.author.id && !user.bot;};
            const collector = embedMessage.createReactionCollector({ filter, time: 3600000 });

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
                embedMessage.reactions.removeAll();
            });
        }

        if (command === 'movie') {
            const input = args.join(' ');
    
            if (!input) {
                message.channel.send('Please provide a movie name or its list number to view.');
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
                message.channel.send(`Movie **${input}** not found in the list.`);
            } else {
                message.channel.send(`Movie: **${movieName.name}**\nAdded by: *${movieName.suggestedby}*`);
            }
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
    }

    if (hasAdminRole) {
        if (command === 'movienight') {
            const timeInput = args.join(' ');
    
            if (!timeInput) {
                message.channel.send('Please provide a valid time for the movie night (e.g., `!movienight 2024-09-30 18:00`).');
                return;
            }
    
            const movieTime = moment(timeInput, 'YYYY-MM-DD HH:mm').toDate();
            if (isNaN(movieTime.getTime())) {
                message.channel.send('Invalid date and time format. Please use `YYYY-MM-DD HH:mm`.');
                return;
            }
                    
            const now = new Date();
            const timeUntilMovie = movieTime.getTime() - now.getTime();
    
            const maxTimeAllowed = 21 * 24 * 60 * 60 * 1000; // 21 days
    
            if (timeUntilMovie > maxTimeAllowed) {
                message.channel.send('Movie night cannot be scheduled more than 3 weeks in advance.');
                return;
            }
    
            const unixTimestamp = Math.floor(movieTime.getTime() / 1000);
            scheduledMovieTime = unixTimestamp;
    
            if (timeUntilMovie <= 0) {
                message.channel.send('The movie night time must be in the future.');
                return;
            }
    
            const twoHoursBefore = timeUntilMovie - 2 * 60 * 60 * 1000;
            const fifteenMinutesBefore = timeUntilMovie - 15 * 60 * 1000;
    
            const role = message.guild.roles.cache.find(r => r.name === 'Movie Night');
            if (!role) {
                message.channel.send('"Movie Night" role not found.');
                return;
            }
    
            // Check if a movie is selected
            const movieMessage = selectedMovie
            ? `We will be watching **${selectedMovie.name}**.`
            : 'No movie has been selected yet.';
    
            message.channel.send(`Movie night has been scheduled for <t:${unixTimestamp}:F>! ${movieMessage} Reminders will be sent at two hours and at fifteen minutes beforehand.`);
    
            if (twoHoursBefore > 0) {
                scheduleReminder(message.channel, role, `Reminder: Movie night starts in 2 hours!`, twoHoursBefore);
            }
    
            if (fifteenMinutesBefore > 0) {
                scheduleReminder(message.channel, role, `Reminder: Movie night starts in 15 minutes!`, fifteenMinutesBefore);
            }
    
            scheduleReminder(message.channel, role, `Movie night is starting now! Join us in the movies channel! **${movieMessage}**`, timeUntilMovie);
        }

        if (command === 'pickmovie' || command === 'selectmovie') {
            const input = args.join(' ');
    
            if (!input) {
                message.channel.send('Please provide a movie name or its list number to select.');
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
                message.channel.send(`Movie **${input}** not found in the list.`);
                return;
            } else {
                selectedMovie = movieName;
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
            message.channel.send('Movie night and all scheduled reminders have been cancelled.');
        }
    
        if (command === 'endmovie') {
            if (!selectedMovie) {
                message.channel.send('There is no active movie night to end.');
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
    
            const removedMovie = removeMovieFromList(selectedMovie.name);
            selectedMovie = null;
            scheduledMovieTime = null;
    
            message.channel.send(`Movie night has ended. **${removedMovie.name}** has been removed from the list.`);
        }
    
        if (command === 'clearlist') {
            movieList = [];
            saveMovies();
            message.channel.send('Cleared the movie list.');
        }
    
        if (command === 'rollmovie') {
            if (movieList.length === 0) {
                message.channel.send('The movie list is empty.');
                return;
            }

            const shuffledMovieList = [...movieList];
    
            const randomIndex = Math.floor(Math.random() * shuffledMovieList.length);
            selectedMovie = shuffledMovieList[randomIndex];
            message.channel.send(`Selected movie: **${selectedMovie.name}** (${randomIndex + 1})`);
        }
    
        if (command === 'pollmovie') {
            const amount = parseInt(args[0], 10);
    
            if (isNaN(amount) || amount <= 0) {
                message.channel.send('Please provide a valid number of movies to choose from.');
                return;
            }
    
            if (amount > pollEmojis.length) {
                message.channel.send(`Please provide a number between 1 and ${pollEmojis.length}.`);
                return;
            }
    
            if (movieList.length < amount) {
                message.channel.send('Not enough movies in the list to create a poll.');
                return;
            }
    
            const randomMovies = getRandomMovies(amount);
    
            let pollMessage = '🎥 **Movie Night Poll** 🎥\nPlease vote for a movie by reacting with the corresponding emoji:\n';
            randomMovies.forEach((movie, index) => {
                pollMessage += `${pollEmojis[index]} **${movie.name}** - added by: *${movie.suggestedby}*\n`;
            });
    
            const poll = await message.channel.send(pollMessage);
    
            for (let i = 0; i < amount; i++) {
                await poll.react(pollEmojis[i]);
            }
        }
    } else if (
        command === 'rollmovie' ||
        command === 'pollmovie' ||
        command === 'movienight' ||
        command === 'pickmovie' ||
        command === 'selectmovie' ||
        command === 'cancelmovie' ||
        command === 'endmovie' ||
        command === 'clearlist'
    ) {
        message.channel.send('You do not have permission to use this command.');
    }
});

client.login(token);
