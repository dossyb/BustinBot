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