import { DateTime } from "luxon";
import cron from "node-cron";
import type { ServiceContainer } from "./ServiceContainer.js";
import { getNextPollDate, getNextEventDate, getNextPrizeDrawDate } from "../../modules/tasks/TaskScheduler.js";

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
            const activePoll = await movieRepo.getActivePoll();
            const nextEvent = await movieRepo.getActiveEvent();
            if (activePoll) {
                console.log(`Active Movie Poll ends: ${activePoll.endsAt.toUTCString()}`);
            }
            if (nextEvent) {
                console.log(`Next Movie Night: ${nextEvent.startTime.toUTCString()}`);
            }
        } catch (err) {
            console.error("[SchedulerStatusReporter] Failed to retrieve schedule info:", err);
        }

        console.log("====================================\n");
    }

    static onNewTrigger(type: string, time: Date) {
        console.log(`Scheduled new ${type}: ${time.toUTCString()}`);
    }

    static scheduleDailyLog(services: ServiceContainer): void {
        cron.schedule("0 0 * * *", () => this.logAllUpcoming(services), {
            timezone: "UTC",
            name: "daily-schedule-log",
        });
    }
}