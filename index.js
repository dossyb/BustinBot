const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = './movies.json';
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

let movieList = [];
let selectedMovie = null;

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
        const movieName = args.join(' ');

        if (!movieName) {
            message.channel.send('Please provide a movie name.');
            return;
        }

        const movieIndex = movieList.findIndex(movie => movie.name.toLowerCase() === movieName.toLowerCase());

        if (movieIndex === -1) {
            message.channel.send(`Movie "${movieName}" not found in the list.`);
            return;
        } else {
            const removedMovie = movieList.splice(movieIndex, 1);
            saveMovies();
            message.channel.send(`Removed ${removedMovie[0].name} from the movie list.`);
        }
    }

    if (command === 'pickmovie' || command === 'selectmovie') {
        const movieName = args.join(' ');

        if (!movieName) {
            message.channel.send('Please provide a movie name.');
            return;
        }

        const movie = movieList.find(m => m.name.toLowerCase() === movieName.toLowerCase());

        if (!movie) {
            message.channel.send(`Movie "${movieName}" not found.`);
            return;
        } else {
            selectedMovie = movie;
            message.channel.send(`Selected movie: ${movie.name}`);
        }
    }

    if (command === 'currentmovie') {
        if (!selectedMovie) {
            message.channel.send('No movie selected.');
        } else {
            message.channel.send(`The next movie is ${selectedMovie.name}.`);
        }
    }

    if (command === 'listmovie' || command === 'movielist') {
        if (movieList.length === 0) {
            message.channel.send('The movie list is empty.');
            return;
        } else {
            const movieDescriptions = movieList.map(movie => `${movie.name} - suggested by: ${movie.suggestedby}`);
            message.channel.send(`Movies in the list:\n${movieDescriptions.join('\n')}`);
        }
    }

    if (command === 'movie') {
        const movieName = args.join(' ');

        if (!movieName) {
            message.channel.send('Please provide a movie name.');
            return;
        }

        const movie = movieList.find(movie => movie.name.toLowerCase() === movieName.toLowerCase());

        if (!movie) {
            message.channel.send(`Movie "${movieName}" not found.`);
            return;
        } else {
            message.channel.send(`Movie is in the list: "${movie.name}" suggested by ${movie.suggestedby}`);
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
- **!removemovie <name>**: Remove a movie from the list.
- **!listmovie**: Show the current list of movies.
- **!movie <name>**: Show details of a specific movie.
- **!pickmovie <name>**: Manually select a movie.
- **!rollmovie**: Randomly select a movie from the list.
- **!currentmovie**: Show the currently selected movie.
- **!pollmovie <amount>**: Randomly select <amount> of movies and create a poll.
- **!moviehelp**: Show this list of commands.
        `;
        message.channel.send(helpMessage);
    }
});

client.login('MTI4OTUxNjUxNDcxMzc5NjY5Mg.G4C0zj.DotDXhEw7U2aoPnUPMUQnasAgJRqw-wAkBoasU');
