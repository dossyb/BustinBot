import { StringSelectMenuInteraction, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, ModalSubmitInteraction, TextChannel } from "discord.js";
import { DateTime } from 'luxon';
import { createMovieNightEmbed } from "./MovieEmbeds";
import type { Movie } from "../../models/Movie";
import { scheduleActivePollClosure } from "./MoviePollScheduler";
import { scheduleMovieReminders, getPendingReminders } from "./MovieReminders";
import { scheduleMovieAutoEnd } from "./MovieLifecycle";
import type { ServiceContainer } from "../../core/services/ServiceContainer";

export async function handleMovieNightDate(interaction: StringSelectMenuInteraction, services: ServiceContainer) {
    const selectedDate = interaction.values[0];
    const BOT_TIMEZONE = process.env.BOT_TIMEZONE || "UTC";

    // Derive short label
    const now = DateTime.now().setZone(BOT_TIMEZONE);
    const numericOffset = now.toFormat("Z");
    const shortTZ = `(UTC${numericOffset})`;

    const modal = new ModalBuilder()
        .setCustomId(`movienight-time-${selectedDate}`)
        .setTitle('Enter movie night time');

    const timeInput = new TextInputBuilder()
        .setCustomId('start-time')
        .setLabel(`Start time ${shortTZ}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("e.g. 20:30");

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(timeInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
}

export async function handleMovieNightTime(interaction: ModalSubmitInteraction, services: ServiceContainer) {
    const { repos } = services;
    const movieRepo = repos.movieRepo;
    if (!movieRepo) {
        console.error("[MovieScheduler] No movie repository found in services.");
        return interaction.reply({ content: "Internal error: missing movie repository.", flags: 1 << 6 });
    }

    const parts = interaction.customId.split('-');
    const selectedDate = `${parts[2]}-${parts[3]}-${parts[4]}`;
    const time = interaction.fields.getTextInputValue('start-time');
    const BOT_TIMEZONE = process.env.BOT_TIMEZONE || "UTC";

    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(time)) {
        return await interaction.reply({
            content: "Invalid time format. Use 24-hour HH:MM format (e.g. 20:30).",
            flags: 1 << 6
        });
    }

    const localDateTime = DateTime.fromISO(`${selectedDate}T${time}`, { zone: BOT_TIMEZONE });
    const utcDateTime = localDateTime.toUTC();

    const activePoll = await movieRepo.getActivePoll();
    let movie: Movie | null = null;
    let pollChannelId: string | undefined;

    const toDate = (value: unknown): Date | null => {
        if (!value) return null;
        if (value instanceof Date) return value;
        const maybeTimestamp = value as { toDate?: () => Date };
        if (maybeTimestamp && typeof maybeTimestamp.toDate === "function") {
            return maybeTimestamp.toDate();
        }
        return null;
    };

    if (activePoll && activePoll.isActive) {
        pollChannelId = activePoll.channelId || undefined;
    }

    // Prefer the most recently selected, unwatched movie
    const movies = await movieRepo.getAllMovies();
    const selectedMovies = movies
        .filter((m) => !m.watched && m.selectedAt)
        .map((m) => {
            const selectedAtDate = toDate(m.selectedAt);
            return selectedAtDate ? { movie: m, selectedAt: selectedAtDate } : null;
        })
        .filter((entry): entry is { movie: Movie; selectedAt: Date } => entry !== null)
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
            await scheduleActivePollClosure(services);
        }
    }

    // Create movie event record
    const event = {
        id: `event-${Date.now()}`,
        createdAt: new Date(),
        startTime: utcDateTime.toJSDate(),
        movie: movie ?? { id: "TBD", title: "TBD", addedBy: interaction.user.id, addedAt: new Date(), watched: false },
        channelId: pollChannelId || "",
        hostedBy: interaction.user.id,
        completed: false,
    };
    await movieRepo.createMovieEvent(event);

    // Schedule reminders
    await scheduleMovieReminders(services, utcDateTime, interaction.client);

    // Auto-end scheduling (if runtime known)
    if (movie?.runtime) {
        scheduleMovieAutoEnd(services, utcDateTime.toISO()!, movie.runtime);
    }

    // Build embed
    const readableDate = localDateTime.toFormat("cccc, dd LLLL yyyy");
    const utcUnix = Math.floor(utcDateTime.toSeconds());
    const pendingReminders = getPendingReminders(utcDateTime);
    const visibleReminders = pendingReminders.filter(r => r.label !== 'start time');
    const reminderLine = visibleReminders.length
        ? `_Reminders will be sent at ${visibleReminders.map(r => `<t:${Math.floor(r.sendAt.toSeconds())}:t>`).join(' and ')} that day._`
        : '';

    let stateMessage = '';
    if (movie) {
        stateMessage = `🎬 We will be watching **${movie.title}**!`;
    } else if (pollChannelId) {
        stateMessage = `🗳️ A poll is currently running in <#${pollChannelId}> to decide which movie we will watch. Go vote!`;
    } else {
        stateMessage = `No movie has been selected yet.`;
    }

    const embed = createMovieNightEmbed(movie, utcUnix, `${stateMessage}\n\n${reminderLine}`, interaction.user.username);

    const guild = interaction.guild;
    if (!guild) {
        return interaction.reply({
            content: "Could not identify the guild. Please try again in a server channel.",
            flags: 1 << 6,
        });
    }

    const movieChannel = guild.channels.cache.find(
        ch => ch.name === 'movie-night' && ch.isTextBased()
    ) as TextChannel | undefined;

    const roleName = process.env.MOVIE_USER_ROLE_NAME;
    const role = roleName ? guild.roles.cache.find(r => r.name === roleName) : null;
    const mention = role ? `<@&${role.id}>` : '';

    if (movieChannel) {
        await movieChannel.send({ content: mention, embeds: [embed] });
    }

    await interaction.reply({
        content: `Movie night scheduled for **${readableDate}** at **${time}**.`,
        flags: 1 << 6
    });
}