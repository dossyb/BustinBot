import { StringSelectMenuInteraction, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, ModalSubmitInteraction, TextChannel } from "discord.js";
import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import { createMovieNightEmbed } from "./MovieEmbeds";
import type { Movie } from "../../models/Movie";
import { scheduleActivePollClosure } from "./MoviePollScheduler";
import { scheduleMovieReminders, getPendingReminders } from "./MovieReminders";

const movieNightPath = path.resolve(process.cwd(), 'src/data/movieNight.json');
const activeMoviePollPath = path.resolve(process.cwd(), 'src/data/activeMoviePoll.json');
const currentMoviePath = path.resolve(process.cwd(), 'src/data/currentMovie.json');

export async function handleMovieNightDate(interaction: StringSelectMenuInteraction) {
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

export async function handleMovieNightTime(interaction: ModalSubmitInteraction) {
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

    const movieNightData = {
        date: selectedDate,
        time,
        timezone: BOT_TIMEZONE,
        storedUTC: utcDateTime.toISO(),
        createdBy: interaction.user.id,
        createdAt: new Date().toISOString()
    };

    fs.writeFileSync(movieNightPath, JSON.stringify(movieNightData, null, 2));

    // Schedule movie night reminders
    await scheduleMovieReminders(utcDateTime, interaction.client);
    console.log(`[MovieScheduler] Movie night reminders scheduled for ${utcDateTime.toISO()}`);

    // Adjust existing active poll if needed
    const activePollPath = path.resolve(process.cwd(), "src/data/activeMoviePoll.json");

    if (fs.existsSync(activePollPath)) {
        try {
            const pollData = JSON.parse(fs.readFileSync(activePollPath, "utf-8"));

            if (pollData?.isActive && pollData.endsAt) {
                const movieStart = DateTime.fromISO(movieNightData.storedUTC ?? "");
                const pollEnd = DateTime.fromISO(pollData.endsAt);
                const adjustedEnd = movieStart.minus({ hours: 1 });

                if (movieStart.isValid && pollEnd.isValid && adjustedEnd < pollEnd) {
                    pollData.endsAt = adjustedEnd.toISO();
                    fs.writeFileSync(activePollPath, JSON.stringify(pollData, null, 2));

                    await scheduleActivePollClosure();

                    console.log(
                        `[MovieScheduler] Active poll end time adjusted to 1 hour before movie night (${adjustedEnd.toISO()})`
                    );

                    const guild = interaction.guild;
                    const pollChannel = guild?.channels.cache.get(pollData.channelId) as TextChannel;

                    if (pollChannel) {
                        await pollChannel.send({
                            content: `⚠️ The active movie poll has been adjusted to close <t:${Math.floor(
                                adjustedEnd.toSeconds()
                            )}:R> due to the upcoming movie night schedule.`,
                        });
                    }
                }
            }
        } catch (err) {
            console.warn("[MovieScheduler] Failed to adjust active poll timing:", err);
        }
    }

    // Determine movie state
    let stateMessage = "";
    let movie: Movie | null = null;
    let pollChannelId: string | undefined;

    if (fs.existsSync(currentMoviePath)) {
        const data = JSON.parse(fs.readFileSync(currentMoviePath, 'utf-8'));
        if (data && !data.watched) movie = data;
    }

    if (fs.existsSync(activeMoviePollPath)) {
        const poll = JSON.parse(fs.readFileSync(activeMoviePollPath, 'utf-8'));
        if (poll && poll.isActive) {
            pollChannelId = poll.channelId;
        }
    }

    if (pollChannelId && !movie) {
        stateMessage = `🗳️ A poll is currently running in <#${pollChannelId}> to decide which movie we will watch. Go vote!`;
    } else if (!movie) {
        stateMessage = `No movie has been selected yet.`;
    }

    const readableDate = localDateTime.toFormat("cccc, dd LLLL yyyy");
    const utcUnix = Math.floor(utcDateTime.toSeconds());

    const pendingReminders = getPendingReminders(utcDateTime);
    const visibleReminders = pendingReminders.filter(r => r.label !== 'start time');

    const reminderLine = visibleReminders.length
        ? `_Reminders will be sent at ${visibleReminders.map(r => `<t:${Math.floor(r.sendAt.toSeconds())}:t>`).join(' and ')} that day._`
        : '';

    const embed = createMovieNightEmbed(
        movie,
        utcUnix,
        `${stateMessage}\n\n${reminderLine}`,
        interaction.user.username
    );

    const guild = interaction.guild;
    if (!guild) {
        console.warn("[MovieScheduler] No guild found in interaction context.");
        return interaction.reply({
            content: "Could not identify the guild. Please try again in a server channel.",
            flags: 1 << 6,
        });
    }

    const movieChannel = guild.channels.cache.find(
        ch => ch.name === 'movie-night' && ch.isTextBased()
    ) as TextChannel | undefined;

    const roleName = process.env.MOVIE_USER_ROLE_NAME;
    let mention = '';

    if (roleName) {
        const role = guild.roles.cache.find(r => r.name === roleName);
        if (role) {
            mention = `<@&${role.id}>`;
        } else {
            console.warn(`[MovieScheduler] Could not find role named "${roleName}". Proceeding without mention.`);
        }
    }

    if (movieChannel) {
        await movieChannel.send({
            content: mention || '',
            embeds: [embed],
        });
    } else {
        console.warn('[MovieScheduler] Movie night channel not found.');
    }

    await interaction.reply({
        content: `Movie night scheduled for **${readableDate}** at **${time}**.`,
        flags: 1 << 6
    });
}