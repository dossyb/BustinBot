import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import Fuse from 'fuse.js';
import type { Command } from '../../../models/Command';
import { CommandModule, CommandRole } from '../../../models/Command';
import { createMovieEmbed } from '../../movies/MovieEmbeds';
import type { Movie } from '../../../models/Movie';
import type { ServiceContainer } from '../../../core/services/ServiceContainer';

const viewmovie: Command = {
    name: 'viewmovie',
    description: 'View details of a movie in the watchlist.',
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('viewmovie')
        .setDescription('View a movie from the local movie list.')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Name of the movie.')
                .setRequired(true)
        ),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

       const movieRepo = services.repos.movieRepo;
        if (!movieRepo) {
            await interaction.editReply("Movie repository not available.");
            return;
        }

        const titleQuery = interaction.options.getString("title", true);

        try {
            // Fetch all movies
            const movies: Movie[] = await movieRepo.getAllMovies();

            if (!movies.length) {
                await interaction.editReply("No movies are currently in the watchlist.");
                return;
            }

            // Fuzzy match the requested title
            const fuse = new Fuse(movies, {
                keys: ["title"],
                threshold: 0.4,
            });

            const results = fuse.search(titleQuery);
            if (results.length === 0) {
                await interaction.editReply(`No matching movie found for **${titleQuery}**.`);
                return;
            }

            const matchedMovie = results[0]!.item;

            let description = matchedMovie.overview ?? "No description available.";
            description += `\n\n*Added by <@${matchedMovie.addedBy ?? "unknown"}>*`;

            const embed = createMovieEmbed(matchedMovie)
                .setTitle(`🎬 ${matchedMovie.title}`)
                .setDescription(description);

            await interaction.editReply({ embeds: [embed] });

            console.log(
                `[ViewMovie] ${interaction.user.username} viewed details for "${matchedMovie.title}".`
            );
        } catch (error) {
            console.error("[ViewMovie Command Error]", error);
            await interaction.editReply(
                "An error occurred while fetching the movie details. Check console for details."
            );
        }
    },
};

export default viewmovie;
