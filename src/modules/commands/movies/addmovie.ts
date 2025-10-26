import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember } from "discord.js";
import type { Command } from '../../../models/Command';
import { CommandModule, CommandRole } from "../../../models/Command";
import { addMovieWithStats, fetchMovieDetailsById } from "../../movies/MovieService";
import { createMovieEmbed } from "../../movies/MovieEmbeds";
import { presentMovieSelection } from "../../movies/MovieSelector";
import type { Movie } from "../../../models/Movie";
import type { ServiceContainer } from "../../../core/services/ServiceContainer";

const MAX_ACTIVE_MOVIES_PER_USER = 3;

const addmovie: Command = {
    name: 'addmovie',
    description: 'Add a movie to the watchlist by searching TMDb.',
    module: CommandModule.Movie,
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

    async execute({ interaction, services }: {
        interaction?: ChatInputCommandInteraction;
        services: ServiceContainer;
    }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const guildConfig = await services.guilds.requireConfig(interaction);
        if (!guildConfig) return;

        const movieRepo = services.repos.movieRepo;
        if (!movieRepo) {
            await interaction.editReply("Movie repository not available.");
            return;
        }

        const guild = interaction.guild!;
        const member = interaction.member as GuildMember;

        const guildRoles = guildConfig.roles ?? {};
        const userRoleIds = member.roles.cache.map((r) => r.id);

        const isBotAdmin =
            guildRoles.admin && userRoleIds.includes(guildRoles.admin);
        const isMovieAdmin =
            guildRoles.movieAdmin && userRoleIds.includes(guildRoles.movieAdmin);

        const isPrivilegedUser =
            guild.ownerId === interaction.user.id ||
            member.permissions.has("Administrator") ||
            isBotAdmin ||
            isMovieAdmin;

        try {
            const movies = await movieRepo.getAllMovies();
            const activeMoviesByUser = movies.filter(
                (movie) => movie.addedBy === interaction.user.id && !movie.watched
            );

            if (!isPrivilegedUser && activeMoviesByUser.length >= MAX_ACTIVE_MOVIES_PER_USER) {
                await interaction.editReply(
                    `You have reached the maximum of ${MAX_ACTIVE_MOVIES_PER_USER} active movies. Remove one or wait for a movie night to conclude before adding more.`
                );
                return;
            }
        } catch (error) {
            console.error("[AddMovie] Failed to validate movie cap:", error);
            await interaction.editReply("Could not verify your movie count. Please try again later.");
            return;
        }

        const query = interaction.options.getString("title", true);
        const yearRaw = interaction.options.getInteger("year", false);
        const year = yearRaw ?? undefined;

        try {
            // Present top search results from TMDb and let user choose one
            const selected = await presentMovieSelection(interaction, query, year);
            if (!selected) return;

            // Fetch full metadata from TMDb
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
                director: movieMetadata.director,
                cast: movieMetadata.cast,
                watched: false,
                addedBy: interaction.user.id,
                addedAt: new Date(),
            };

            // Save to Firestore
            await addMovieWithStats(newMovie, services);

            // Confirm addition
            const embed = createMovieEmbed(newMovie)
                .setTitle(`Added: ${newMovie.title}`)
                .setFooter({ text: `Added by ${interaction.user.username}` });

            await interaction.editReply({ embeds: [embed], components: [] });
            console.log(`[AddMovie] Added "${newMovie.title}" by ${interaction.user.username}`);
        } catch (error) {
            console.error("[AddMovie Command Error]", error);
            await interaction.editReply(
                "An error occurred while adding the movie. Check console for details."
            );
        }
    },
};

export default addmovie;