import { randomUUID } from "node:crypto";
import { StringSelectMenuInteraction, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, ModalSubmitInteraction, Client, time, TimestampStyles, MessageFlags } from "discord.js";
import cron, { type ScheduledTask } from "node-cron";
import { DateTime } from "luxon";
import { createMovieNightEmbed, createMoviePollClosedEmbed } from "./MovieEmbeds.js";
import type { Movie } from "../../models/Movie.js";
import type { MovieEvent } from "../../models/MovieEvent.js";
import { getPendingReminders, sendDueReminders } from "./MovieReminders.js";
import { finishMovieNight, isPlaceholderMovie, movieNightEndsAt } from "./MovieLifecycle.js";
import { closeActiveMoviePoll } from "./MoviePolls.js";
import { getActiveVoiceMemberIds } from "./MovieAttendance.js";
import { configuredChannel } from "../../utils/ChannelUtils.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../utils/MentionUtils.js";

export async function resolveGuildTimezone(services: ServiceContainer): Promise<string> {
    const config = await services.guilds.get(services.guildId);
    return config?.timezone || "UTC";
}

export function startMovieScheduler(client: Client, guildServices: () => ServiceContainer[]): ScheduledTask {
    return cron.schedule(
        "* * * * *",
        async () => {
            for (const services of guildServices()) {
                await sweepMovieNight(client, services);
            }
        },
        { name: "movieScheduler:sweep", noOverlap: true }
    );
}

export async function sweepMovieNight(client: Client, services: ServiceContainer): Promise<void> {
    const now = new Date();
    const movieRepo = services.repos.movieRepo;

    const step = async (name: string, work: () => Promise<void>) => {
        try {
            await work();
        } catch (err) {
            console.error(`[MovieScheduler] ${name} failed for guild ${services.guildId}:`, err);
        }
    };

    await step("Closing the poll", () => closeDuePoll(client, services, now));

    const event = await movieRepo.getActiveEvent();
    if (!event) return;

    await step("Sending reminders", () => sendDueReminders(client, services, event, now));
    if (isPlaceholderMovie(event.movie)) return;

    await step("Counting attendance", () => trackAttendance(client, services, event, now));

    const endsAt = movieNightEndsAt(event);
    if (endsAt && endsAt <= now) {
        await step("Ending the movie night", () => endMovieNight(client, services, event, now));
    }
}

async function closeDuePoll(client: Client, services: ServiceContainer, now: Date): Promise<void> {
    const poll = await services.repos.movieRepo.getActivePoll();
    if (!poll?.isActive || poll.endsAt > now) return;

    // Close the poll in Firestore
    const result = await closeActiveMoviePoll(services, client, "Scheduler");
    console.log(`[MovieScheduler] Poll closed: ${result.message}`);
    // Send winner announcement if poll was successful
    if (!result.success || !result.winner) return;

    const channel = await configuredChannel(client, services, "movieNight");
    await channel?.send({
        embeds: [createMoviePollClosedEmbed(result.winner, "Scheduler", result.winningVotes ?? 0, result.tieBreak ?? false)]
    });
}

async function trackAttendance(client: Client, services: ServiceContainer, event: MovieEvent, now: Date): Promise<void> {
    const attendance = services.movieAttendance;
    const guildConfig = await services.guilds.get(services.guildId);
    const voiceChannelId = event.voiceChannelId ?? guildConfig?.channels?.movieVC ?? null;
    const memberIds = voiceChannelId ? await getActiveVoiceMemberIds(client, voiceChannelId) : [];

    if (!attendance.isTracking(event.id)) {
        attendance.start(event.id, voiceChannelId, memberIds, now);
    } else {
        attendance.reconcile(memberIds, now);
    }
}

async function endMovieNight(client: Client, services: ServiceContainer, event: MovieEvent, now: Date): Promise<void> {
    const result = await finishMovieNight("auto", services, client, now, event.id);
    if (!result.success || !result.finishedMovie) return;

    const channel = await configuredChannel(client, services, "movieNight");
    await channel?.send({
        content: `🎞️ **${result.finishedMovie.title}** has finished and has now been archived from the active list. Thanks for watching!`
    });
}

export async function handleMovieNightDate(interaction: StringSelectMenuInteraction, services: ServiceContainer) {
    const selectedDate = interaction.values[0];
    const timezone = await resolveGuildTimezone(services);

    // Derive short label
    const now = DateTime.now().setZone(timezone);
    const numericOffset = now.toFormat("Z");
    const shortTZ = `(UTC${numericOffset})`;

    const modal = new ModalBuilder()
        .setCustomId(`movienight-time-${selectedDate}`)
        .setTitle("Enter movie night time");

    const timeInput = new TextInputBuilder()
        .setCustomId("start-time")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("e.g. 20:30");

    modal.addLabelComponents(new LabelBuilder().setLabel(`Start time ${shortTZ}`).setTextInputComponent(timeInput));

    await interaction.showModal(modal);
}

export async function handleMovieNightTime(interaction: ModalSubmitInteraction, services: ServiceContainer) {
    // Defer reply immediately to avoid 3-second timeout
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { repos } = services;
    const movieRepo = repos.movieRepo;

    const guildConfig = await services.guilds.get(services.guildId);

    const parts = interaction.customId.split("-");
    const selectedDate = `${parts[2]}-${parts[3]}-${parts[4]}`;
    const enteredTime = interaction.fields.getTextInputValue("start-time");
    const timezone = await resolveGuildTimezone(services);

    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(enteredTime)) {
        await interaction.editReply({
            content: "Invalid time format. Use 24-hour HH:MM format (e.g. 20:30)."
        });
        return;
    }

    const localDateTime = DateTime.fromISO(`${selectedDate}T${enteredTime}`, { zone: timezone });
    const utcDateTime = localDateTime.toUTC();

    const activePoll = await movieRepo.getActivePoll();
    let movie: Movie | null = null;
    let pollChannelId: string | undefined;

    if (activePoll && activePoll.isActive) {
        pollChannelId = activePoll.channelId || undefined;
    }

    // Prefer the most recently selected, unwatched movie
    const movies = await movieRepo.getAllMovies();
    const selectedMovies = movies
        .flatMap((m) => !m.watched && m.selectedAt ? [{ movie: m, selectedAt: m.selectedAt }] : [])
        .sort((a, b) => b.selectedAt.getTime() - a.selectedAt.getTime());

    movie = selectedMovies[0]?.movie ?? null;

    // Adjust poll end time if needed
    if (activePoll?.isActive && activePoll.endsAt) {
        const movieStart = utcDateTime;
        const pollEnd = DateTime.fromJSDate(activePoll.endsAt);
        const adjustedEnd = movieStart.minus({ hours: 1 });

        if (adjustedEnd < pollEnd) {
            await movieRepo.createPoll({
                ...activePoll,
                endsAt: adjustedEnd.toJSDate()
            });
        }
    }

    // Build embed
    const readableDate = localDateTime.toFormat("cccc, dd LLLL yyyy");
    const pendingReminders = getPendingReminders(utcDateTime);
    const visibleReminders = pendingReminders.filter(r => r.label !== "start time");
    const reminderLine = visibleReminders.length
        ? `_Reminders will be sent at ${visibleReminders.map(r => time(r.sendAt.toJSDate(), TimestampStyles.ShortTime)).join(" and ")} that day._`
        : "";

    let stateMessage = "";
    if (movie) {
        stateMessage = `🎬 We will be watching **${movie.title}**!`;
    } else if (pollChannelId) {
        stateMessage = `🗳️ A poll is currently running in <#${pollChannelId}> to decide which movie we will watch. Go vote!`;
    } else {
        stateMessage = `No movie has been selected yet.`;
    }

    const showStateMessage = !movie;
    const combinedMessage = [
        showStateMessage ? stateMessage : "",
        reminderLine
    ].filter(Boolean).join("\n\n");

    const embed = createMovieNightEmbed(
        movie,
        utcDateTime.toJSDate(),
        combinedMessage,
        interaction.user.username
    );

    const movieChannel = await configuredChannel(interaction.client, services, "movieNight");

    const movieRoleId = guildConfig?.roles?.movieUser;
    const voiceChannelId = guildConfig?.channels?.movieVC;
    const mention = movieRoleId ? `<@&${movieRoleId}>` : "";
    const suppressMentions = await isMentionSuppressed(services.guilds, interaction.guildId);

    if (!voiceChannelId) {
        console.warn("[MovieScheduler] No movie voice channel configured; attendance tracking will be disabled for this event.");
    }

    // Mark any previously active events as completed so lifecycle commands operate on a single active event.
    const existingEvents = await movieRepo.getAllEvents();
    const activeEvents = existingEvents.filter((event) => !event.completed);
    if (activeEvents.length) {
        const completedAt = new Date();
        await Promise.all(activeEvents.map((event) => movieRepo.completeEvent(event.id, completedAt)));
        services.movieAttendance.stop();
    }

    // Prepare movie event record; announcement details filled after send
    const eventId = randomUUID();
    const baseEvent = {
        id: eventId,
        createdAt: new Date(),
        startTime: utcDateTime.toJSDate(),
        movie: movie ?? { id: "TBD", title: "TBD", addedBy: interaction.user.id, addedAt: new Date(), watched: false },
        channelId: pollChannelId || interaction.channelId || "",
        voiceChannelId,
        hostedBy: interaction.user.id,
        completed: false,
        ...(movieRoleId ? { roleId: movieRoleId } : {}),
    };

    let announcementMessageId: string | undefined;
    let announcementChannelId = baseEvent.channelId;
    if (movieChannel) {
        const sent = await movieChannel.send(withSuppressedMentions({ content: mention, embeds: [embed] }, suppressMentions));
        announcementMessageId = sent.id;
        announcementChannelId = sent.channelId;
    }

    // Avoid spreading an undefined voiceChannelId (MovieEvent expects a string); exclude it and re-add only if defined.
    const { voiceChannelId: _voiceChannelId, ...eventWithoutVoice } = baseEvent;
    await movieRepo.createMovieEvent({
        ...eventWithoutVoice,
        ...(_voiceChannelId ? { voiceChannelId: _voiceChannelId } : {}),
        channelId: announcementChannelId,
        ...(announcementMessageId ? { announcementMessageId } : {}),
    });

    // Edit deferred reply with success message
    await interaction.editReply({
        content: `Movie night scheduled for **${readableDate}** at **${enteredTime}**.`
    });
}
