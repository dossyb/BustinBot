import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { createMovieNightEmbed } from "../../movies/MovieEmbeds.js";
import type { Movie } from "../../../models/Movie.js";
import { isPlaceholderMovie } from "../../movies/MovieLifecycle.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";

const currentmovie: Command = {
    name: "currentmovie",
    description: "View the currently scheduled movie night details.",
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName("currentmovie")
        .setDescription("View the currently scheduled movie night details."),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction, services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const movieRepo = services.repos.movieRepo;

        // Fetch latest scheduled movie event
        const movieEvent = await movieRepo.getActiveEvent();
        if (!movieEvent) {
            await interaction.editReply("No movie night is currently scheduled.");
            return;
        }

        // Fetch current movie (if any)
        const currentMovie: Movie | null = isPlaceholderMovie(movieEvent.movie) ? null : movieEvent.movie;

        // Determine state message
        let stateMessage = "";
        if (currentMovie) {
            stateMessage = `🎬 We will be watching **${currentMovie.title}**!`;
        } else {
            stateMessage = "📭 No movie has been selected yet.";
        }

        const host = await interaction.client.users.fetch(movieEvent.hostedBy);
        const embed = createMovieNightEmbed(currentMovie, movieEvent.startTime, stateMessage, host.username);

        await interaction.editReply({
            embeds: [embed],
        });

        console.log(`[CurrentMovie] Displayed current movie night info.`);
    },
};

export default currentmovie;