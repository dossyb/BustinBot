import { SlashCommandBuilder, ChatInputCommandInteraction, DiscordAPIError, RESTJSONErrorCodes, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../../utils/MentionUtils.js";
import { configuredChannel } from "../../../utils/ChannelUtils.js";

const cancelmovie: Command = {
    name: "cancelmovie",
    description: "Cancel the currently scheduled movie night and selected movie.",
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName("cancelmovie")
        .setDescription("Cancel the currently scheduled movie night and selected movie."),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply("Could not identify the guild. Please try again in a server channel.");
            return;
        }

        const movieRepo = services.repos.movieRepo;

        const guildConfig = await services.guilds.get(guild.id);
        const client = interaction.client;

        async function fetchMessageFromChannels(messageId: string, ...channelIds: (string | null | undefined)[]) {
            for (const channelId of new Set(channelIds)) {
                if (!channelId) continue;
                try {
                    const fetchedChannel = await client.channels.fetch(channelId);
                    if (!fetchedChannel?.isTextBased()) continue;
                    return await fetchedChannel.messages.fetch(messageId);
                } catch (err) {
                    if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMessage) {
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
        const suppressMentions = await isMentionSuppressed(services.guilds, interaction.guildId);

        try {
            // Cancel active poll
            const openPoll = await movieRepo.getActivePoll();
            const activePoll = openPoll?.isActive ? await movieRepo.closePoll(openPoll.id) : null;
            if (activePoll) {
                actions.push("Active movie poll set inactive");

                if (activePoll.messageId) {
                    try {
                        const pollMessage = await fetchMessageFromChannels(
                            activePoll.messageId,
                            activePoll.channelId,
                            guildConfig?.channels?.movieNight
                        );

                        if (pollMessage) {
                            await pollMessage.edit({
                                content: `❌ This movie poll was cancelled by <@${interaction.user.id}>.`,
                                embeds: [],
                                components: [],
                                ...(suppressMentions ? { allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } } : {}),
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
            if (latestEvent) {
                fallbackAnnouncementChannelId = latestEvent.channelId;
                await movieRepo.completeEvent(latestEvent.id, new Date());
                services.movieAttendance.stop();
                actions.push("Movie night event marked as cancelled");

                if (latestEvent.announcementMessageId) {
                    try {
                        const announcement = await fetchMessageFromChannels(
                            latestEvent.announcementMessageId,
                            latestEvent.channelId,
                            guildConfig?.channels?.movieNight
                        );

                        if (announcement) {
                            await announcement.edit({
                                content: cancellationMessage,
                                embeds: [],
                                components: [],
                                ...(suppressMentions ? { allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } } : {}),
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
            const movies = await movieRepo.getAllMovies();
            const withSelection = movies
                .flatMap((movie) => !movie.watched && movie.selectedAt ? [{ movie, selectedAt: movie.selectedAt }] : [])
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

                await movieRepo.upsertMovie(rest);
                actions.push(`Unpicked movie "${currentlySelected.title}"`);
            }
        } catch (err) {
            console.error("[CancelMovie] Firestore update failed:", err);
        }

        if (!announcementHandled) {
            const fetched = fallbackAnnouncementChannelId
                ? await interaction.client.channels.fetch(fallbackAnnouncementChannelId).catch(() => null)
                : null;
            const targetChannel = fetched?.isSendable()
                ? fetched
                : await configuredChannel(interaction.client, services, "movieNight");
            await targetChannel?.send(withSuppressedMentions({ content: cancellationMessage }, suppressMentions));
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
