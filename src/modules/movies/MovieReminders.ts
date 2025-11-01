import { DateTime } from "luxon";
import type { Reminder } from "../../models/Reminder";
import type { Client, TextChannel } from 'discord.js';
import type { ServiceContainer } from "../../core/services/ServiceContainer";

export function getPendingReminders(movieStart: DateTime, now: DateTime = DateTime.utc()): Reminder[] {
    const reminderOffsets = [
        { label: '2 hours before', offset: { hours: 2 } },
        { label: '30 mins before', offset: { minutes: 30 } },
        { label: 'start time', offset: { minutes: 0 } },
    ];

    return reminderOffsets
        .map(({ label, offset }) => {
            const sendAt = movieStart.minus(offset);
            return { sendAt, label };
        })
        .filter(({ sendAt }) => sendAt > now);
}

export async function restoreMovieReminders(services: ServiceContainer, client: Client) {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        console.error("[MovieReminders] Movie repository not found in services.");
        return;
    }

    const latestEvent = await movieRepo.getActiveEvent();
    if (!latestEvent?.startTime) {
        console.log("[MovieReminders] No upcoming movie event found.");
        return;
    }

    const movieStart = DateTime.fromJSDate(latestEvent.startTime);
    const reminders = getPendingReminders(movieStart);

    await scheduleMovieReminders(services, movieStart, client);

    console.log(
        `[MovieReminders] Restored ${reminders.length} reminder(s) from Firestore (event ${latestEvent.id})`
    );
}

export async function scheduleMovieReminders(services: ServiceContainer, movieStart: DateTime, client: Client) {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        console.error("[MovieReminders] Movie repository not found in services.");
        return;
    }

    const reminders = getPendingReminders(movieStart);
    const guildId = services.guildId;
    const guildConfig = guildId ? await services.guilds.get(guildId) : null;
    if (!guildId || !guildConfig) {
        console.warn("[MovieReminders] Missing guild configuration for reminders.");
        return;
    }

    const guild = await client.guilds.fetch(guildId);
    const movieChannelId = guildConfig.channels?.movieNight;
    const voiceChannelId = guildConfig.channels?.movieVC;
    const movieRoleId = guildConfig.roles?.movieUser;

    let channel: TextChannel | undefined;
    if (movieChannelId) {
        const fetched = await guild.channels.fetch(movieChannelId);
        if (fetched?.isTextBased()) {
            channel = fetched as TextChannel;
        }
    }

    if (!channel) {
        channel = guild.channels.cache.find(
            (ch) => ch.name === "movie-night" && ch.isTextBased()
        ) as TextChannel | undefined;
    }

    const role = movieRoleId ? guild.roles.cache.get(movieRoleId) : null;
    const mention = role ? `<@&${role.id}>` : "";

    if (!channel) {
        console.warn("[MovieReminders] Could not find movie-night channel.");
        return;
    }

    for (const { sendAt, label } of reminders) {
        const now = DateTime.utc();
        const delayMs = sendAt.diff(now).as("milliseconds");

        if (delayMs <= 0) {
            console.warn(`[MovieReminders] Skipping past reminder "${label}"`);
            continue;
        }

        setTimeout(async () => {
            try {
                // Retrieve current state from Firestore
                const [activePoll, latestEvent] = await Promise.all([
                    movieRepo.getActivePoll(),
                    movieRepo.getActiveEvent(),
                ]);

                // Determine movie state line
                let stateLine = "";
                const movie = latestEvent?.movie;
                if (activePoll?.isActive) {
                    stateLine = `A movie poll is currently running! Go cast your vote before it closes.`;
                } else if (movie?.title) {
                    stateLine = `We will be watching **${movie.title}**!`;
                } else {
                    stateLine = `No movie has been selected yet — stay tuned!`;
                }

                // Format remaining time
                const totalMinutes = Math.max(
                    Math.round(movieStart.diffNow("minutes").minutes),
                    0
                );
                const hours = Math.floor(totalMinutes / 60);
                const minutes = totalMinutes % 60;
                let timeString = "";

                if (hours > 0) {
                    timeString = `${hours} hour${hours > 1 ? "s" : ""}`;
                    if (minutes > 0)
                        timeString += ` and ${minutes} minute${
                            minutes !== 1 ? "s" : ""
                        }`;
                } else {
                    timeString = `${minutes} minute${
                        minutes !== 1 ? "s" : ""
                    }`;
                }

                const absoluteTime = `<t:${Math.floor(
                    movieStart.toSeconds()
                )}:t>`;

                // Build and send message
                const voiceMention = voiceChannelId ? `<#${voiceChannelId}>` : "the movie voice channel";
                const msg =
                    label === "start time"
                        ? `${mention} Movie night is starting **now**! Join us in ${voiceMention} 🎬\n${stateLine}`
                        : `${mention} Movie night starts in **${timeString}** (at ${absoluteTime})! ${stateLine}`;

                await channel.send(msg);
                console.log(
                    `[MovieReminders] Sent "${label}" reminder at ${sendAt.toISO()}`
                );
            } catch (err) {
                console.error(`[MovieReminders] Failed to send reminder:`, err);
            }
        }, delayMs);

        console.log(
            `[MovieReminders] Scheduled "${label}" in ${Math.round(
                delayMs / 60000
            )} min(s)`
        );
    }
}
