import { DateTime } from "luxon";
import type { ServiceContainer } from "./ServiceContainer";
import { getNextPollDate, getNextEventDate, getNextPrizeDrawDate } from "modules/tasks/TaskScheduler";

export class SchedulerStatusReporter {
    static async logAllUpcoming(services: ServiceContainer) {
        const now = DateTime.utc();
        console.log("\n=== Upcoming Scheduled Triggers ===");
        console.log(`Current UTC Time: ${now.toISO()}`);

        try {
            const { repos } = services;
            const movieRepo = repos.movieRepo;
            // TASK SCHEDULES
            const pollDate = getNextPollDate();
            if (pollDate) console.log(`📅 Next Task Poll: ${pollDate.toUTCString()}`);

            const eventDate = getNextEventDate();
            if (eventDate) console.log(`🎯 Next Task Event: ${eventDate.toUTCString()}`);

            const prizeDate = getNextPrizeDrawDate();
            if (prizeDate) console.log(`🏆 Next Prize Draw: ${prizeDate.toUTCString()}`);

            // MOVIE EVENTS
            if (movieRepo) {
                const activePoll = await movieRepo.getActivePoll();
                const nextEvent = await movieRepo.getActiveEvent();
                if (activePoll?.endsAt) {
                    const endsAt = activePoll.endsAt instanceof Date
                        ? activePoll.endsAt
                        : new Date((activePoll.endsAt as any).toDate?.() ?? activePoll.endsAt);
                    console.log(`Active Movie Poll ends: ${endsAt.toUTCString()}`);
                }
                if (nextEvent?.startTime) {
                    const start = nextEvent.startTime instanceof Date
                        ? nextEvent.startTime
                        : new Date((nextEvent.startTime as any).toDate?.() ?? nextEvent.startTime);
                    console.log(`Next Movie Night: ${start.toUTCString()}`);
                }
            }
        } catch (err) {
            console.error("[SchedulerStatusReporter] Failed to retrieve schedule info:", err);
        }

        console.log("====================================\n");
    }

    static onNewTrigger(type: string, time: Date) {
        console.log(`Scheduled new ${type}: ${time.toUTCString()}`);
    }

    static scheduleDailyLog(services: ServiceContainer) {
        const now = DateTime.utc();
        const nextMidnight = now.plus({ days: 1 }).startOf("day");
        const delay = nextMidnight.diff(now).as("milliseconds");

        setTimeout(() => {
            this.logAllUpcoming(services);
            setInterval(() => this.logAllUpcoming(services), 24 * 60 * 60 * 1000);
        }, delay);
    }
}