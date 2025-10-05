import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import fs from 'fs';
import path from 'path';
import type { Command } from '../../../models/Command';
import { CommandRole } from "../../../models/Command";
import { fetchMovieDetailsById } from "../../movies/MovieService";
import { createMovieEmbed } from "../../movies/MovieEmbeds";
import { presentMovieSelection } from "../../movies/MovieSelector";
import type { Movie } from "../../../models/Movie";

const movieFilePath = path.resolve(process.cwd(), 'src/data/movies.json');

const addmovie: Command = {
    name: 'addmovie',
    description: 'Add a movie to the watchlist by searching TMDb.',
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('addmovie')
        .setDescription('Add a movie to the watchlist.')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('The movie title to search for.')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('year')
                .setDescription('(Optional) Release year of the movie')
                .setRequired(false)
        ),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;
        await interaction.deferReply();

        const query = interaction.options.getString('title', true);
        const yearRaw = interaction.options.getInteger('year', false);
        const year = yearRaw ?? undefined;
        try {
            // Present top results and wait for user selection
            const selected = await presentMovieSelection(interaction, query, year);
            if (!selected) return;

            // Fetch full details from TMDb
            const movieMetadata = await fetchMovieDetailsById(selected.id);
            if (!movieMetadata) {
                await interaction.editReply(`Could not fetch details for ${selected.title}.`);
                return;
            }

            // Build movie object
            const newMovie: Movie = {
                id: crypto.randomUUID(),
                tmdbId: movieMetadata.tmdbId,
                title: movieMetadata.title ?? selected.title,
                releaseDate: movieMetadata.releaseDate,
                posterUrl: movieMetadata.posterUrl,
                infoUrl: movieMetadata.infoUrl,
                overview: movieMetadata.overview,
                runtime: movieMetadata.runtime,
                genres: movieMetadata.genres,
                rating: movieMetadata.rating,
                watched: false,
                addedBy: interaction.user.id,
                addedAt: new Date(),
            };

            // Persist to file
            let movies: Movie[] = [];
            if (fs.existsSync(movieFilePath)) {
                const data = fs.readFileSync(movieFilePath, 'utf-8');
                movies = data ? JSON.parse(data) : [];
            }
            movies.push(newMovie);
            fs.writeFileSync(movieFilePath, JSON.stringify(movies, null, 2));

            // Confirm addition
            const embed = createMovieEmbed(newMovie)
                .setTitle(`Added: ${newMovie.title}`)
                .setFooter({ text: `Added by ${interaction.user.username}` });

            await interaction.editReply({ embeds: [embed], components: [] });
        } catch (error) {
            console.error('[AddMovie Command Error]', error);
            await interaction.editReply('An error occurred while adding the movie. Check console for details.');
        }
    }
};

export default addmovie;