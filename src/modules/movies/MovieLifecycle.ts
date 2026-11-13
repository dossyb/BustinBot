import type { Movie } from "../../models/Movie.js";
import type { MovieEvent } from "../../models/MovieEvent.js";
import { DateTime } from "luxon";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { Client } from "discord.js";
import { resolveGuildContext } from "./MovieLocalSelector.js";
import { MAX_ACTIVE_MOVIES_PER_USER } from "./MovieService.js";

const AUTO_END_BUFFER_MINUTES = 30;

export function isPlaceholderMovie(movie: Movie | null | undefined): boolean {
    if (!movie) return true;
    const id = (movie.id || "").trim().toLowerCase();
    const title = (movie.title || "").trim().toLowerCase();
    if (title && title !== "tbd") return false;
    if (id && id !== "tbd") return false;
    return title === "" || title === "tbd" || id === "tbd";
}

export function movieNightEndsAt(event: MovieEvent): Date | null {
    if (isPlaceholderMovie(event.movie) || !event.movie.runtime) return null;
    return DateTime.fromJSDate(event.startTime)
        .plus({ minutes: event.movie.runtime + AUTO_END_BUFFER_MINUTES })
        .toJSDate();
}

function getMostRecentlySelectedUnwatchedMovie(movies: Movie[]): Movie | null {
    const selectedUnwatched = movies
        .flatMap((movie) => !movie.watched && movie.selectedAt ? [{ movie, selectedAt: movie.selectedAt }] : [])
        .sort((a, b) => b.selectedAt.getTime() - a.selectedAt.getTime());

    return selectedUnwatched[0]?.movie ?? null;
}

async function resolveEventToFinish(
    services: ServiceContainer,
    targetEventId?: string
): Promise<MovieEvent | null> {
    const event = await services.repos.movieRepo.getActiveEvent();
    return !targetEventId || event?.id === targetEventId ? event : null;
}

async function notifySubmitterMovieEnded(client: Client, addedBy: string, finishedMovie: Movie, remainingSlots: number, services: ServiceContainer) {
    const { guildName } = await resolveGuildContext(client, services);
    const plural = remainingSlots === 1 ? "movie" : "movies";
    const message = `Hey <@${addedBy}>, your movie **${finishedMovie.title}** has been watched as part of a movie night in **${guildName}**. You can now add **${remainingSlots} more ${plural}** to the list!`;

    try {
        const user = await client.users.fetch(addedBy);
        await user.send(message);
        console.log(`[MovieLifecycle] Sent DM to ${user.tag} about ended movie: ${finishedMovie.title}`);
    } catch (err) {
        console.warn(`[MovieLifecycle] Could not DM ${addedBy} about ${finishedMovie.title}:`, err);
    }
}

// Marks the current movie night as completed and archives it
export async function finishMovieNight(
    endedBy: string,
    services: ServiceContainer,
    client: Client,
    now: Date = new Date(),
    targetEventId?: string
): Promise<{ success: boolean; message: string; finishedMovie?: Movie }> {
    const movieRepo = services.repos.movieRepo;

    try {
        const latestEvent = await resolveEventToFinish(services, targetEventId);
        if (!latestEvent) {
            return { success: false, message: "No active movie event found to end." };
        }

        const allMovies = await movieRepo.getAllMovies();
        const eventMovie = latestEvent.movie ?? null;
        const movieFromDb =
            eventMovie?.id
                ? allMovies.find((movie) => movie.id === eventMovie.id) ?? null
                : null;
        const selectedMovie = getMostRecentlySelectedUnwatchedMovie(allMovies);
        const resolvedMovie = movieFromDb ?? selectedMovie ?? (!isPlaceholderMovie(eventMovie) ? eventMovie : null);

        const finishedMovie: Movie | undefined = resolvedMovie
            ? { ...resolvedMovie, watched: true, watchedAt: now, selectedAt: undefined, selectedBy: undefined }
            : undefined;

        if (!(await movieRepo.completeEvent(latestEvent.id, now, finishedMovie))) {
            return { success: false, message: "That movie night has already ended." };
        }

        if (finishedMovie) {
            await movieRepo.upsertMovie(finishedMovie);
            console.log(`[MovieLifecycle] Movie night ended by ${endedBy}: ${finishedMovie.title}`);

            const userMovies = allMovies.filter(m => m.addedBy === finishedMovie.addedBy && !m.watched && m.id !== finishedMovie.id);
            await notifySubmitterMovieEnded(client, finishedMovie.addedBy, finishedMovie, Math.max(0, MAX_ACTIVE_MOVIES_PER_USER - userMovies.length), services);
        } else {
            console.warn(
                `[MovieLifecycle] Movie night ended by ${endedBy}, but no selected movie record could be resolved for event ${latestEvent.id}.`
            );
        }

        const attendees = services.movieAttendance.finish(latestEvent.id, now);
        for (const userId of attendees) {
            try {
                await services.repos.userRepo.incrementStat(userId, "moviesAttended", 1);
            } catch (err) {
                console.warn(`[MovieLifecycle] Failed to count attendance for ${userId}:`, err);
            }
        }
        console.log(`[MovieLifecycle] Attendance recorded for ${attendees.length} member(s).`);

        const message = finishedMovie
            ? `The movie night for **${finishedMovie.title}** has ended and been archived.`
            : "The movie night has ended, but no selected movie was found to archive.";

        return finishedMovie ? { success: true, message, finishedMovie } : { success: true, message };
    } catch (error) {
        console.error("[MovieLifecycle] Failed to finish movie night:", error);
        return { success: false, message: "Failed to end movie night." };
    }
}
