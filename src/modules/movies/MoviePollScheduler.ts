import { DateTime } from 'luxon';
import { closeActiveMoviePoll } from './MoviePolls.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { scheduleMovieAutoEnd } from './MovieLifecycle.js';
import type { Client } from 'discord.js';
import { SchedulerStatusReporter } from '../../core/services/SchedulerStatusReporter.js';

let pollTimeout: NodeJS.Timeout | null = null;

// Schedule auto-closure of the current active poll based on endsAt field
export async function scheduleActivePollClosure(services: ServiceContainer, client: Client) {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        console.error('[MoviePollScheduler] Movie repository not found.');
        return;
    }

    const activePoll = await movieRepo.getActivePoll();
    if (!activePoll || !activePoll.isActive || !activePoll.endsAt) {
        return;
    }

    const endsAtDate =
        activePoll.endsAt instanceof Date
            ? activePoll.endsAt
            : typeof (activePoll.endsAt as { toDate?: () => Date })?.toDate === "function"
                ? (activePoll.endsAt as { toDate: () => Date }).toDate()
                : new Date(activePoll.endsAt as unknown as string | number | Date);

    if (Number.isNaN(endsAtDate.getTime())) {
        console.warn('[MoviePollScheduler] Invalid poll endsAt timestamp, skipping.');
        return;
    }

    const endsAt = DateTime.fromJSDate(endsAtDate);
    if (!endsAt.isValid) {
        console.warn('[MoviePollScheduler] Invalid poll endsAt timestamp, skipping.');
        return;
    }

    const now = DateTime.utc();
    const delayMs = Math.max(endsAt.diff(now, 'milliseconds').milliseconds, 0);

    if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
    }

    console.log(
        `[MoviePollScheduler] Poll auto-closure scheduled for ${endsAt.toISO()} (${Math.round(
            delayMs / 1000
        )}s)`
    );

    pollTimeout = setTimeout(async () => {
        try {
            // Close the poll in Firestore
            const result = await closeActiveMoviePoll(services, client, 'Scheduler');
            console.log(`[MoviePollScheduler] Poll auto-closed: ${result.message}`);

            // Fetch latest movie event to determine next steps
            const latestEvent = await movieRepo.getActiveEvent();
            if (!latestEvent || !latestEvent.movie) {
                console.warn('[MoviePollScheduler] No movie event found post-poll.');
                return;
            }

            const movie = latestEvent.movie;
            const startTimeISO = latestEvent.startTime instanceof Date
                ? latestEvent.startTime.toISOString()
                : typeof latestEvent.startTime === 'string'
                    ? latestEvent.startTime
                    : null;

            if (movie?.runtime && startTimeISO) {
                console.log('[MoviePollScheduler] Scheduling auto-end post-poll with selected movie.');
                scheduleMovieAutoEnd(services, startTimeISO, movie.runtime, client);
            } else {
                console.warn('[MoviePollScheduler] Cannot schedule auto-end: missing runtime or start time.');
            }
        } catch (error) {
            console.error('[MoviePollScheduler] Failed to auto-close poll:', error);
        } finally {
            pollTimeout = null;
        }
    }, delayMs);

    SchedulerStatusReporter.onNewTrigger('Movie Poll Auto-Close', endsAt.toJSDate());
}

// Cancels the current scheduled timeout, if any
export function cancelActivePollSchedule() {
    if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
        console.log("[MoviePollScheduler] Cancelled existing poll closure schedule.");
    }
}
