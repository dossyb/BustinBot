import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../../models/Command.js';
import { CommandModule, CommandRole } from '../../../models/Command.js';
import { createMovieNightEmbed } from '../../movies/MovieEmbeds.js';
import type { Movie } from '../../../models/Movie.js';
import type { ServiceContainer } from '../../../core/services/ServiceContainer.js';
import { DateTime } from 'luxon';

const currentmovie: Command = {
    name: 'currentmovie',
    description: 'View the currently scheduled movie night details.',
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('currentmovie')
        .setDescription('View the currently scheduled movie night details.'),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction, services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const movieRepo = services.repos.movieRepo;
        if (!movieRepo) {
            await interaction.editReply("Movie repository not available.");
            return;
        }

        // Fetch latest scheduled movie event
        const movieEvent = await movieRepo.getActiveEvent();
        if (!movieEvent || movieEvent.completed || !movieEvent.startTime) {
            await interaction.editReply("No movie night is currently scheduled.");
            return;
        }

        const startDate =
            movieEvent.startTime instanceof Date
                ? movieEvent.startTime
                : typeof (movieEvent.startTime as { toDate?: () => Date })?.toDate === "function"
                    ? (movieEvent.startTime as { toDate: () => Date }).toDate()
                    : null;

        if (!startDate) {
            await interaction.editReply("No movie night is currently scheduled.");
            return;
        }

        const startTime = DateTime.fromJSDate(startDate);
        const readableDate = startTime.toFormat("cccc, dd LLLL yyyy");
        const unixTimestamp = Math.floor(startTime.toSeconds());

        // Fetch current movie (if any)
        const currentMovie: Movie | null = movieEvent.movie ?? null;

        // Determine state message
        let stateMessage = "";
        if (currentMovie) {
            stateMessage = `🎬 We will be watching **${currentMovie.title}**!`;
        } else {
            stateMessage = "📭 No movie has been selected yet.";
        }

        const embed = createMovieNightEmbed(
            currentMovie,
            unixTimestamp,
            stateMessage,
            interaction.user.username
        );

        await interaction.editReply({
            embeds: [embed],
        });

        console.log(`[CurrentMovie] Displayed current movie night info.`);
    },
};

export default currentmovie;