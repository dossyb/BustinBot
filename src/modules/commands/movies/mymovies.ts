import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { createMovieEmbed } from "../../movies/MovieEmbeds.js";
import type { Movie } from "../../../models/Movie.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";

const MOVIE_CAP = 3;

const mymovies: Command = {
    name: 'mymovies',
    description: 'View the movies you\'ve added to the list.',
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('mymovies')
        .setDescription('View the movies you\'ve added to the list.'),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });
        
        const movieRepo = services.repos.movieRepo;
        if (!movieRepo) {
            await interaction.editReply("Movie repository not available.");
            return;
        }

        try {
            // Fetch all movies from Firestore
            const movies: Movie[] = await movieRepo.getAllMovies();

            // Filter by user
            const userMovies = movies.filter((m) => m.addedBy === interaction.user.id);
            const remaining = MOVIE_CAP - userMovies.length;

            // Handle edge cases
            if (userMovies.length > 10) {
                await interaction.editReply({
                    content:
                        "I can't generate that many embeds! If you somehow have this many movies in the list, yell at the dev for being too lazy to add pagination.",
                });
                return;
            }

            if (userMovies.length === 0) {
                await interaction.editReply({
                    content: `You haven't added any movies yet. You can add up to ${MOVIE_CAP} movies using /addmovie.`,
                });
                return;
            }

            // Build embeds for user's movies
            const embeds = userMovies.map((m) => createMovieEmbed(m));

            await interaction.editReply({
                content: `You have added **${userMovies.length}/${MOVIE_CAP}** movies. You can still add **${remaining}** more using /addmovie.`,
                embeds,
            });

            console.log(
                `[MyMovies] Displayed ${userMovies.length} movies for ${interaction.user.username}.`
            );
        } catch (error) {
            console.error("[MyMovies Command Error]", error);
            await interaction.editReply(
                "An error occurred while retrieving your movies. Check console for details."
            );
        }
    },
};

export default mymovies;