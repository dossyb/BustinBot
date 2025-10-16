import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from "discord.js";
import type { Command } from "../../../models/Command";
import { CommandRole } from "../../../models/Command";
import type { ServiceContainer } from "../../../core/services/ServiceContainer";

const cancelmovie: Command = {
    name: 'cancelmovie',
    description: 'Cancel the currently scheduled movie night and selected movie.',
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName('cancelmovie')
        .setDescription('Cancel the currently scheduled movie night and selected movie.'),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply("Could not identify the guild. Please try again in a server channel.");
            return;
        }

        const movieRepo = services.repos.movieRepo;
        if (!movieRepo) {
            await interaction.editReply("Movie repository not available.");
            return;
        }

        const deleted: string[] = [];

        try {
            // Cancel active poll
            const activePoll = await movieRepo.getActivePoll();
            if (activePoll?.isActive) {
                await movieRepo.closePoll(activePoll.id);
                deleted.push("Active movie poll (set inactive)");
            }

            // Mark latest movie event as cancelled
            const latestEvent = await movieRepo.getLatestEvent();
            if (latestEvent && !latestEvent.completed) {
                await movieRepo.createMovieEvent({
                    ...latestEvent,
                    completed: true,
                    completedAt: new Date(),
                });
                deleted.push("Current movie night event");
            }

            // Optionally, clean up current movie state (if any unwatched movie remains)
            const allMovies = await movieRepo.getAllMovies();
            const unwatched = allMovies.filter((m) => !m.watched);
            if (unwatched.length) {
                for (const m of unwatched) {
                    await movieRepo.upsertMovie({ ...m, watched: false });
                }
                deleted.push(`${unwatched.length} movie(s) left unwatched (cleared)`);
            }
        } catch (err) {
            console.error("[CancelMovie] Firestore update failed:", err);
        }

        // Public notification
        const movieChannel = guild.channels.cache.find(
            (ch) => ch.name === "movie-night" && ch.isTextBased()
        ) as TextChannel | undefined;

        if (movieChannel) {
            await movieChannel.send({
                content: "Movie night has been cancelled by an admin.",
            });
        } else {
            console.warn("[CancelMovie] Could not find movie night channel.");
        }

        // Private confirmation
        const summary =
            deleted.length > 0
                ? `Cleared: ${deleted.join(", ")}`
                : "No movie data was found to clear.";

        await interaction.editReply({
            content: `Movie night cancelled successfully.\n${summary}`,
        });

        console.log(`[CancelMovie] Cancelled movie night — ${summary}`);
    },
};

export default cancelmovie;