import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import { closeActiveMoviePoll } from './MoviePolls';

const pollPath = path.resolve(process.cwd(), "src/data/activeMoviePoll.json");

let pollTimeout: NodeJS.Timeout | null = null;

// Schedule auto-closure of the current active poll based on endsAt field
export async function scheduleActivePollClosure() {
    if (!fs.existsSync(pollPath)) return;

    const pollData = JSON.parse(fs.readFileSync(pollPath, "utf-8"));
    if (!pollData?.isActive || !pollData.endsAt) return;

    const endsAt = DateTime.fromISO(pollData.endsAt);
    if (!endsAt.isValid) {
        console.warn("[MoviePollScheduler] Invalid poll endsAt timestamp, skipping.");
        return;
    }

    const now = DateTime.utc();
    const delayMs = Math.max(endsAt.diff(now, "milliseconds").milliseconds, 0);

    if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
    }

    console.log(`[MoviePollScheduler] Poll auto-closure scheduled for ${endsAt.toISO()} (${Math.round(delayMs / 1000)}s)`);

    pollTimeout = setTimeout(async () => {
        try {
            const result = await closeActiveMoviePoll("Scheduler");
            console.log(`[MoviePollScheduler] Poll auto-closed: ${result.message}`);

            // Attempt to schedule auto-end AFTER poll is closed and movie is selected
            const currentMoviePath = path.resolve(process.cwd(), 'src/data/currentMovie.json');
            const movieNightPath = path.resolve(process.cwd(), 'src/data/movieNight.json');

            if (fs.existsSync(currentMoviePath) && fs.existsSync(movieNightPath)) {
                const movie = JSON.parse(fs.readFileSync(currentMoviePath, 'utf-8'));
                const movieNightData = JSON.parse(fs.readFileSync(movieNightPath, 'utf-8'));

                if (movie?.runtime && movieNightData?.storedUTC) {
                    const { scheduleMovieAutoEnd } = await import('./MovieLifecycle'); // avoid circular import at top
                    console.log("[MoviePollScheduler] Scheduling auto-end post-poll with selected movie.");
                    scheduleMovieAutoEnd(movieNightData.storedUTC, movie.runtime);
                } else {
                    console.warn("[MoviePollScheduler] Cannot schedule auto-end: missing runtime or scheduled start time.");
                }
            } else {
                console.warn("[MoviePollScheduler] Cannot schedule auto-end: movie or movie night data missing.");
            }

        } catch (error) {
            console.error("[MoviePollScheduler] Failed to auto-close poll:", error);
        } finally {
            pollTimeout = null;
        }
    }, delayMs);
}

// Cancels the current scheduled timeout, if any
export function cancelActivePollSchedule() {
    if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
        console.log("[MoviePollScheduler] Cancelled existing poll closure schedule.");
    }
}