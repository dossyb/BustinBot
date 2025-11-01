import type { Movie } from '../../models/Movie';
import { DateTime } from 'luxon';
import type { ServiceContainer } from '../../core/services/ServiceContainer';
import { Client } from 'discord.js';
import { initAttendanceTracking, finaliseAttendance } from './MovieAttendance';
import { SchedulerStatusReporter } from 'core/services/SchedulerStatusReporter';

let autoEndTimeout: NodeJS.Timeout | null = null;

async function notifySubmitterMovieEnded(client: Client, addedBy: string, finishedMovie: Movie, remainingSlots: number, services: ServiceContainer) {
    try {
        const guilds = await services.guilds.getAll();
        const guild = guilds[0];
        const guildName = guild?.id
            ? (await client.guilds.fetch(guild.id)).name
            : "this server";

        const user = await client.users.fetch(addedBy);
        if (!user) return;

        const plural = remainingSlots === 1 ? "movie" : "movies";
        const message =
            `Hey <@${addedBy}>, your movie **${finishedMovie.title}** has been watched as part of a movie night in **${guildName}**. You can now add **${remainingSlots} more ${plural}** to the list!`;

        await user.send(message);
        console.log(`[MovieLifecycle] Sent DM to ${user.tag} about ended movie: ${finishedMovie.title}`);
    } catch (err) {
        console.warn(`[MovieLifecycle] Could not DM ${addedBy} - likely has DMs disabled.`, err);
    }
}

// Marks the current movie night as completed and archives it
export async function finishMovieNight(endedBy: string, services: ServiceContainer, client: Client): Promise<{ success: boolean; message: string; finishedMovie?: Movie }> {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        console.error('[MovieLifecycle] Movie repository not found.');
        return { success: false, message: 'Internal error: repository missing.' };
    }

    try {
        // Retrieve latest active event
        const latestEvent = await movieRepo.getActiveEvent();
        if (!latestEvent) {
            return { success: false, message: 'No active movie event found to end.' };
        }

        const currentMovie = latestEvent.movie;
        if (!currentMovie) {
            return { success: false, message: 'No movie is currently active.' };
        }

        // Mark movie as watched in Firestore
        const finishedMovie: Movie = {
            ...currentMovie,
            watched: true,
            watchedAt: new Date(),
        };
        await movieRepo.upsertMovie(finishedMovie);

        // Update event as completed
        await movieRepo.createMovieEvent({
            ...latestEvent,
            completed: true,
            completedAt: new Date(),
            hostedBy: latestEvent.hostedBy,
            movie: finishedMovie,
        });

        console.log(`[MovieLifecycle] Movie night ended by ${endedBy}: ${finishedMovie.title}`);

        if (finishedMovie.addedBy) {
            try {
                const allMovies = await movieRepo.getAllMovies();
                const userMovies = allMovies.filter(m => m.addedBy === finishedMovie.addedBy && !m.watched);
                const remainingSlots = Math.max(0, 3 - userMovies.length);

                await notifySubmitterMovieEnded(client, finishedMovie.addedBy, finishedMovie, remainingSlots, services);
            } catch (err) {
                console.warn(`[MovieLifecycle] Failed to calculate remaining slots or send DM:`, err);
            }
        }

        const attendees = await finaliseAttendance(services);
        console.log(`[MovieLifecycle] Attendance tracking complete: ${attendees.length} attendees.`);

        return {
            success: true,
            message: `The movie night for **${finishedMovie.title}** has ended.`,
            finishedMovie,
        };
    } catch (error) {
        console.error('[MovieLifecycle] Failed to finish movie night:', error);
        return { success: false, message: 'Failed to end movie night.' };
    }
}

export async function scheduleMovieAutoEnd(services: ServiceContainer, startTimeISO: string, runtimeMinutes: number, client: Client) {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        console.error("[MovieLifecycle] Movie repository not found; cannot shcedule auto-end.");
        return;
    }

    const latestEvent = await movieRepo.getActiveEvent();
    if (!latestEvent) {
        console.warn("[MovieLifecycle] No active movie event found; skipping attendance tracking init.");
    } else {
        initAttendanceTracking(latestEvent.channelId, DateTime.fromISO(startTimeISO).toJSDate());
    }

    const bufferMinutes = 30;
    const endTime = DateTime.fromISO(startTimeISO).plus({ minutes: runtimeMinutes + bufferMinutes });
    const now = DateTime.utc();
    const msUntilEnd = endTime.diff(now).as('milliseconds');

    if (msUntilEnd <= 0) {
        console.warn("[MovieLifecycle] Movie auto-end time is in the past. Skipping.");
        return;
    }

    if (autoEndTimeout) {
        clearTimeout(autoEndTimeout)
    }

    autoEndTimeout = setTimeout(async () => {
        console.log("[MovieLifecycle] Auto-ending movie night based on runtime.");
        const result = await finishMovieNight('auto', services, client);

        if (result.success && result.finishedMovie) {
            try {
                const guilds = await services.guilds.getAll();
                const guild = guilds[0];
                if (!guild?.id) {
                    console.warn("[MovieLifecycle] Could not identify guild for movie night end message.");
                    return;
                }

                const guildConfig = await services.guilds.get(guild.id);
                const movieChannelId = guildConfig?.channels?.movieNight;

                if (movieChannelId) {
                    const guildObj = await client.guilds.fetch(guild.id);
                    const channel = await guildObj.channels.fetch(movieChannelId);
                    if (channel?.isTextBased()) {
                        await channel.send({
                            content: `🎞️ **${result.finishedMovie.title}** has finished and has now been removed from the list. Thanks for watching!`
                        });
                        console.log(`[MovieLifecycle] Sent end-of-night message for ${result.finishedMovie}`);
                    } else {
                        console.warn(`[MovieLifecycle] Configured movie night channel is not text-based: ${movieChannelId}`);
                    }
                } else {
                    console.warn("[MovieLifecycle] No movieNight channel configured; skipping end message.");
                }
            } catch (err) {
                console.warn("[MovieLifecycle] Failed to send end-of-night message:", err);
            }
        }
    }, msUntilEnd);

    console.log(`[MovieLifecycle] Auto-end scheduled in ${Math.round(msUntilEnd / 1000)}s at ${endTime.toISO()}`);
    SchedulerStatusReporter.onNewTrigger('Movie Auto-End', endTime.toJSDate());
}