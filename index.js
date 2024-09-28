const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = './movies.json';
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

let movieList = [];
let selectedMovie = null;

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

client.once('ready', () => {
    console.log('BustinBot is online!');
    loadMovies();
});

client.on('messageCreate', (message) => {
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === '!bustin') {
        message.channel.send('Bustin\' makes me feel good!');
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

    if (command === 'pickmovie') {
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

    if (command === 'movielist') {
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
});

client.login('MTI4OTUxNjUxNDcxMzc5NjY5Mg.G4C0zj.DotDXhEw7U2aoPnUPMUQnasAgJRqw-wAkBoasU');
