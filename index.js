const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const moment = require('moment');
const path = './movies.json';
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

let movieList = [];
let selectedMovie = null;
let scheduledMovieTime = null;
let scheduledReminders = {};

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
    const shuffledMovies = movieList.sort(() => 0.5 - Math.random());
    return shuffledMovies.slice(0, amount);
}

function scheduleReminder(channel, role, messageText, delay, reminderType) {
    const timeoutID = setTimeout(() => {
        channel.send(`${role} ${messageText}`);
        delete scheduledReminders[reminderType];
    }, delay);

    scheduledReminders[reminderType] = timeoutID;
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

client.once('ready', () => {
    console.log('BustinBot is online!');
    loadMovies();
});

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'bustin') {
        message.channel.send('Bustin\' makes me feel good!');
        return;
    }

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
        ? `We will be watching "${selectedMovie.name}".`
        : 'No movie has been selected yet.';

        message.channel.send(`Movie night has been scheduled for <t:${unixTimestamp}:f>! ${movieMessage} Reminders will be sent at two hours and at fifteen minutes beforehand.`);

        if (twoHoursBefore > 0) {
            scheduleReminder(message.channel, role, `Reminder: Movie night starts in 2 hours! ${movieMessage}`, twoHoursBefore, 'twoHoursBefore');
        }

        if (fifteenMinutesBefore > 0) {
            scheduleReminder(message.channel, role, `Reminder: Movie night starts in 15 minutes! ${movieMessage}`, fifteenMinutesBefore, 'fifteenMinutesBefore');
        }

        scheduleReminder(message.channel, role, `Movie night is starting now! Join us in the movies channel! ${movieMessage}`, timeUntilMovie, 'movieTime');
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

        message.channel.send(`Movie night has ended. ${removedMovie.name} has been removed from the list.`);
    }

    if (command === 'clearlist') {
        movieList = [];
        saveMovies();
        message.channel.send('Cleared the movie list.');
    }

    if (command === 'addmovie') {
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
        message.channel.send(`Added ${movieName} to the movie list.`);
    }

    if (command === 'removemovie' || command === 'removie') {
        const input = args.join(' ');

        if (!input) {
            message.channel.send('Please provide a movie name or its list number to remove.');
            return;
        }

        let removedMovie;
        if (!isNaN(input)) {
            const movieIndex = parseInt(input) - 1;
            if (movieIndex >= 0 && movieIndex < movieList.length) {
                removedMovie = movieList.splice(movieIndex, 1)[0];
                saveMovies();
            }
        } else {
            removedMovie = removeMovieFromList(input);
        }

        if (!removedMovie){
            message.channel.send(`Movie "${input}" not found in the list.`);
        } else {
            message.channel.send(`Removed ${removedMovie.name} from the movie list.`);
        }
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
            message.channel.send(`Movie "${input}" not found in the list.`);
            return;
        } else {
            selectedMovie = movieName;
            message.channel.send(`Next movie: ${selectedMovie.name}`);
        }
    }

    if (command === 'currentmovie') {
        if (!selectedMovie) {
            message.channel.send('No movie has been selected for movie night.');
        } else {
            let response = `The next movie is ${selectedMovie.name}.`;

            if (scheduledMovieTime) {
                response += ` Movie night is scheduled for <t:${scheduledMovieTime}:f>.`;
            } else {
                response += ' Movie night has not been scheduled yet.';
            }

            message.channel.send(response);
        }
    }

    if (command === 'listmovie' || command === 'movielist') {
        if (movieList.length === 0) {
            message.channel.send('The movie list is empty.');
            return;
        } else {
            const movieDescriptions = movieList.map((movie, index) => `${index + 1} | ${movie.name} - suggested by: ${movie.suggestedby}`);
            message.channel.send(`Movies in the list:\n${movieDescriptions.join('\n')}`);
        }
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
            message.channel.send(`Movie "${input}" not found in the list.`);
        } else {
            message.channel.send(`Movie: ${movieName.name}\nSuggested by: ${movieName.suggestedby}`);
        }
    }

    if (command === 'rollmovie') {
        if (movieList.length === 0) {
            message.channel.send('The movie list is empty.');
            return;
        }

        const randomIndex = Math.floor(Math.random() * movieList.length);
        selectedMovie = movieList[randomIndex];
        message.channel.send(`Selected movie: ${selectedMovie.name}`);
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
            pollMessage += `${pollEmojis[index]} ${movie.name} - suggested by: ${movie.suggestedby}\n`;
        });

        const poll = await message.channel.send(pollMessage);

        for (let i = 0; i < amount; i++) {
            await poll.react(pollEmojis[i]);
        }
    }

    if (command === 'moviehelp') {
        const helpMessage = `
🎥 **BustinBot's Movie Commands** 🎥

- **!addmovie <name>**: Add a movie to the list.
- **!removemovie <name|number>**/**!removie <name|number>**: Remove a movie from the list by its name or number.
- **!movielist**/**!listmovie**: Show a numbered list of all movies in the list.
- **!movie <name|number>**: Show details of a specific movie by its name or number.
- **!selectmovie <name|number>**/**!pickmovie <name|number>**: Select a movie from the list by its name or number for movie night.
- **!rollmovie**: Randomly select a movie from the list.
- **!pollmovie <amount>**: Randomly select <amount> of movies from the list and create a poll with them as options.
- **!movienight <YYYY-MM-DD HH:mm>**: Schedule a movie night at a specific time (within 3 weeks).
- **!cancelmovie**: Cancel the scheduled movie night and all reminders.
- **!endmovie**: End the current movie night, remove the selected movie from the list, and clear the schedule.
- **!currentmovie**: Show the currently selected movie and the scheduled movie night time (if any).
- **!moviehelp**: Show this list of commands.

For the **number-based commands**, you can reference a movie by its position in the list shown in **!movielist**. Example: "!movie 2" to view the second movie in the list.
        `;
        message.channel.send(helpMessage);
    }
});

client.login('MTI4OTUxNjUxNDcxMzc5NjY5Mg.G4C0zj.DotDXhEw7U2aoPnUPMUQnasAgJRqw-wAkBoasU');
