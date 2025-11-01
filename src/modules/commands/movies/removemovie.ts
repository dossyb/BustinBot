import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import Fuse from 'fuse.js';
import type { Command } from "../../../models/Command";
import { CommandModule, CommandRole } from "../../../models/Command";
import { createMovieEmbed } from "../../movies/MovieEmbeds";
import type { Movie } from "../../../models/Movie";
import type { ServiceContainer } from "../../../core/services/ServiceContainer";
import { removeMovieWithStats } from "modules/movies/MovieService";

const removemovie: Command = {
    name: 'removemovie',
    description: 'Remove a movie you have added from the list (removie).',
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.Everyone, CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName('removemovie')
        .setDescription('Remove a movie you have added from the list (removie).')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('The movie title to remove.')
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

        const query = interaction.options.getString('title', true);
        const userId = interaction.user.id;
        const isAdmin = interaction.memberPermissions?.has('Administrator') || false;

       try {
            // Fetch all movies
            const movies: Movie[] = await movieRepo.getAllMovies();

            if (!movies.length) {
                await interaction.editReply("The movie list is currently empty.");
                return;
            }

            // Fuzzy search for match
            const fuse = new Fuse(movies, {
                keys: ["title"],
                threshold: 0.4,
            });

            const results = fuse.search(query);
            if (results.length === 0) {
                await interaction.editReply(`No matching movie found for \`${query}\`.`);
                return;
            }

            const matched = results[0]!.item;

            // Permission check
            if (matched.addedBy !== userId && !isAdmin) {
                await interaction.editReply(`You can only remove movies you have added.`);
                return;
            }

            // Delete from Firestore
            await removeMovieWithStats(matched, services);

            // Confirmation embed
            const embed = createMovieEmbed(matched)
                .setTitle(`🗑️ Removed: ${matched.title}`)
                .setFooter({ text: `Removed by ${interaction.user.username}` });

            await interaction.editReply({
                content: `Movie **${matched.title}** has been removed from the list.`,
                embeds: [embed],
            });

            console.log(
                `[RemoveMovie] ${interaction.user.username} removed "${matched.title}" (${matched.id})`
            );
        } catch (error) {
            console.error("[RemoveMovie Command Error]", error);
            await interaction.editReply(
                "An error occurred while trying to remove the movie. Check console for details."
            );
        }
    },
};

export default removemovie;