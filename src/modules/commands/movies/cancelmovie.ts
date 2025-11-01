import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from "discord.js";
import type { Command } from "../../../models/Command";
import { CommandModule, CommandRole } from "../../../models/Command";
import type { ServiceContainer } from "../../../core/services/ServiceContainer";
import { normaliseFirestoreDates } from "../../../utils/DateUtils";

const cancelmovie: Command = {
    name: 'cancelmovie',
    description: 'Cancel the currently scheduled movie night and selected movie.',
    module: CommandModule.Movie,
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

        const guildConfig = await services.guilds.get(guild.id);
        const client = interaction.client;

        async function fetchMessageFromChannels(messageId: string, ...channelIds: (string | null | undefined)[]) {
            for (const channelId of channelIds) {
                if (!channelId) continue;
                try {
                    const fetchedChannel = await client.channels.fetch(channelId);
                    if (!fetchedChannel?.isTextBased()) continue;
                    const message = await fetchedChannel.messages.fetch(messageId);
                    return { channel: fetchedChannel as TextChannel, message };
                } catch (err) {
                    if ((err as any)?.code === 10008) {
                        continue;
                    }
                    throw err;
                }
            }
            return null;
        }

        const actions: string[] = [];
        let announcementHandled = false;
        let fallbackAnnouncementChannelId: string | undefined;
        const cancellationMessage = `❌ Movie night has been cancelled by <@${interaction.user.id}>.`;

        try {
            // Cancel active poll
            const activePoll = await movieRepo.getActivePoll();
            if (activePoll?.isActive) {
                await movieRepo.closePoll(activePoll.id);
                actions.push("Active movie poll set inactive");

                if (activePoll.messageId) {
                    try {
                        const pollMessageContext = await fetchMessageFromChannels(
                            activePoll.messageId,
                            activePoll.channelId,
                            guildConfig?.channels?.movieNight
                        );

                        if (pollMessageContext) {
                            await pollMessageContext.message.edit({
                                content: `❌ This movie poll was cancelled by <@${interaction.user.id}>.`,
                                embeds: [],
                                components: [],
                            });
                            actions.push("Poll message updated to show cancellation");
                        } else {
                            console.info("[CancelMovie] Poll message no longer exists; skipping edit.");
                        }
                    } catch (err) {
                        console.warn("[CancelMovie] Failed to update poll message:", err);
                    }
                }
            }

            // Mark latest movie event as cancelled
            const latestEvent = await movieRepo.getActiveEvent();
            if (latestEvent && !latestEvent.completed) {
                fallbackAnnouncementChannelId = latestEvent.channelId;
                const completedEvent = {
                    ...latestEvent,
                    completed: true,
                    completedAt: new Date(),
                };
                await movieRepo.createMovieEvent(completedEvent);
                actions.push("Movie night event marked as cancelled");

                if (latestEvent.announcementMessageId) {
                    try {
                        const announcementContext = await fetchMessageFromChannels(
                            latestEvent.announcementMessageId,
                            latestEvent.channelId,
                            guildConfig?.channels?.movieNight
                        );

                        if (announcementContext) {
                            await announcementContext.message.edit({
                                content: cancellationMessage,
                                embeds: [],
                                components: [],
                            });
                            actions.push("Movie night announcement updated to show cancellation");
                            announcementHandled = true;
                        } else {
                            console.info("[CancelMovie] Announcement message no longer exists; skipping edit.");
                        }
                    } catch (err) {
                        console.warn("[CancelMovie] Failed to update movie night announcement message:", err);
                    }
                }
            }

            // Unpick currently selected movie (if any)
            const movies = (await movieRepo.getAllMovies()).map((movie) => normaliseFirestoreDates(movie));
            const withSelection = movies
                .filter((m) => !m.watched && m.selectedAt)
                .map((movie) => {
                    const selectedAt = movie.selectedAt instanceof Date ? movie.selectedAt : null;
                    return selectedAt ? { movie, selectedAt } : null;
                })
                .filter((entry): entry is { movie: typeof movies[number]; selectedAt: Date } => entry !== null)
                .sort((a, b) => b.selectedAt.getTime() - a.selectedAt.getTime());

            const currentlySelected = withSelection[0]?.movie;
            if (currentlySelected) {
                const {
                    selectedAt: _selectedAt,
                    selectedBy: _selectedBy,
                    addedByDisplay: _addedByDisplay,
                    addedByDevId: _addedByDevId,
                    ...rest
                } = currentlySelected;

                await movieRepo.upsertMovie(rest as typeof currentlySelected);
                actions.push(`Unpicked movie "${currentlySelected.title}"`);
            }
        } catch (err) {
            console.error("[CancelMovie] Firestore update failed:", err);
        }

        if (!announcementHandled) {
            let targetChannel: TextChannel | undefined;

            if (fallbackAnnouncementChannelId) {
                const fetched = await interaction.client.channels.fetch(fallbackAnnouncementChannelId).catch(() => null);
                if (fetched?.isTextBased()) {
                    targetChannel = fetched as TextChannel;
                }
            }

            if (!targetChannel) {
                targetChannel = guild.channels.cache.find(
                    (ch) => ch.name === "movie-night" && ch.isTextBased()
                ) as TextChannel | undefined;
            }

            if (targetChannel) {
                await targetChannel.send({ content: cancellationMessage });
            } else {
                console.warn("[CancelMovie] Could not find movie night channel for cancellation notice.");
            }
        }

        await interaction.editReply({
            content: [
                "Movie night cancelled successfully.",
                actions.length ? `Actions taken:\n- ${actions.join("\n- ")}` : ""
            ].filter(Boolean).join("\n\n"),
        });

        console.log(`[CancelMovie] Cancelled movie night.`);
    },
};

export default cancelmovie;
