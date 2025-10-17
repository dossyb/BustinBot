import type { Movie } from '../../models/Movie';
import { DateTime } from 'luxon';
import type { ServiceContainer } from '../../core/services/ServiceContainer';

let autoEndTimeout: NodeJS.Timeout | null = null;

// Marks the current movie night as completed and archives it
export async function finishMovieNight(endedBy: string, services: ServiceContainer): Promise<{ success: boolean; message: string; finishedMovie?: Movie }> {
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

export function scheduleMovieAutoEnd(services: ServiceContainer, startTimeISO: string, runtimeMinutes: number) {
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
        await finishMovieNight('auto', services);
    }, msUntilEnd);

    console.log(`[MovieLifecycle] Auto-end scheduled in ${Math.round(msUntilEnd / 1000)}s at ${endTime.toISO()}`);
}