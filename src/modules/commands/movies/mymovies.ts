import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import fs from 'fs';
import path from 'path';
import type { Command } from "../../../models/Command";
import { CommandRole } from "../../../models/Command";
import { createMovieEmbed } from "../../movies/MovieEmbeds";
import type { Movie } from "../../../models/Movie";

const movieFilePath = path.resolve(process.cwd(), 'src/data/movies.json');
const MOVIE_CAP = 3;

const mymovies: Command = {
    name: 'mymovies',
    description: 'View the movies you\'ve added to the list.',
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('mymovies')
        .setDescription('View the movies you\'ve added to the list.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        let movies: Movie[] = [];
        if (fs.existsSync(movieFilePath)) {
            const data = fs.readFileSync(movieFilePath, 'utf-8');
            movies = data ? JSON.parse(data) : [];
        }

        const userMovies = movies.filter(m => m.addedBy === interaction.user.id);
        const remaining = MOVIE_CAP - userMovies.length;

        if (userMovies.length > 10) {
            await interaction.editReply({
                content: 'I can\'t generate that many embeds! If you somehow have this many movies in the list, yell at the dev for being too lazy to add pagination.',
            });
            return;
        }

        if (userMovies.length === 0) {
            await interaction.editReply({
                content: `You haven't added any movies yet. You can add up to ${MOVIE_CAP} movies using /addmovie.`,
            });
            return;
        }

        const embeds = userMovies.map(m => createMovieEmbed(m));
        await interaction.editReply({
            content: `You have added **${userMovies.length}/${MOVIE_CAP}** movies. You can still add **${remaining}** more using /addmovie.`,
            embeds,
        });
    }
};

export default mymovies;