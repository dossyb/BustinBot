import cron, { type Logger, type ScheduledTask } from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { Client } from "discord.js";
import { DateTime, type WeekSettings } from "luxon";
import { postAllTaskPolls } from "./HandleTaskPoll.js";
import { startAllTaskEvents } from "./HandleTaskStart.js";
import { generatePrizeDrawSnapshot, rollWinnerForSnapshot, announcePrizeDrawWinner } from "./HandlePrizeDraw.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { SchedulerStatusReporter } from "../../core/services/SchedulerStatusReporter.js";
import { postPeriodicLeaderboardUpdate, warnPendingLeaderboardFinalization } from "./HandleLeaderboardUpdate.js";

// Store next trigger times for console log
let nextPollTime: Date | null = null;
let nextEventTime: Date | null = null;
let nextPrizeTime: Date | null = null;

export function getNextPollDate() { return nextPollTime; }
export function getNextEventDate() { return nextEventTime; }
export function getNextPrizeDrawDate() { return nextPrizeTime; }

// TODO: Replace with config store (admin editable)
const defaultSchedule = {
    pollDay: 0, // 0 = Sunday, 1 = Monday, ...
    pollHourUTC: 0,
    pollDurationHours: 24,
    taskDurationDays: 7,
    prizeFrequencyWeeks: 2,
    prizeDay: 2, // Tuesday
    prizeHourUTC: 0,
    prizeWeekOffset: 0,
};

const schedulerTimezone = "UTC";

function getNextRunDate(expression: string): Date | null {
    try {
        const interval = CronExpressionParser.parse(expression, {
            currentDate: new Date(),
            tz: schedulerTimezone,
        });
        return interval.next().toDate();
    } catch (err) {
        console.warn("[TaskScheduler] Failed to parse cron expression:", expression, err);
        return null;
    }
}

function getNextMatchingRunDate(
    expression: string,
    predicate: (date: Date) => boolean,
    baseDate: Date = new Date()
): Date | null {
    try {
        const interval = CronExpressionParser.parse(expression, {
            currentDate: baseDate,
            tz: schedulerTimezone,
        });

        for (let i = 0; i < 12; i++) {
            const next = interval.next().toDate();
            if (predicate(next)) {
                return next;
            }
        }
        return null;
    } catch (err) {
        console.warn("[TaskScheduler] Failed to evaluate matching cron expression:", expression, err);
        return null;
    }
}

// Test config
function isTestMode() {
    return process.env.BOT_MODE === "dev";
}
const testIntervalMinutes = 7;

const JOB_PREFIX = "taskScheduler";

function jobLogger(name: string): Logger {
    return {
        info: (message) => console.log(`[${name}] ${message}`),
        warn: (message) => console.warn(`[${name}] ${message}`),
        error: (message, err) => console.error(`[${name}]`, message, ...(err ? [err] : [])),
        debug: (message, err) => console.debug(`[${name}]`, message, ...(err ? [err] : [])),
    };
}

function jobOptions(guildId: string, job: string) {
    const name = `${JOB_PREFIX}:${guildId}:${job}`;
    return { timezone: schedulerTimezone, name, logger: jobLogger(name) };
}

function updateTestModeNextTimes(reference: Date = new Date()) {
    const base = DateTime.fromJSDate(reference).startOf("minute");
    const baseMinutes = base.minute;
    const remainder = baseMinutes % testIntervalMinutes;

    const pollOffset = ((testIntervalMinutes - 1 - remainder + testIntervalMinutes) % testIntervalMinutes) || testIntervalMinutes;
    const eventOffset = ((testIntervalMinutes - remainder) % testIntervalMinutes) || testIntervalMinutes;

    const cycleMinutes = 2 * testIntervalMinutes;
    const prizeRemainder = ((baseMinutes - 1) % cycleMinutes + cycleMinutes) % cycleMinutes;
    const prizeOffset = ((cycleMinutes - prizeRemainder) % cycleMinutes) || cycleMinutes;

    nextPollTime = base.plus({ minutes: pollOffset }).toJSDate();
    nextEventTime = base.plus({ minutes: eventOffset }).toJSDate();
    nextPrizeTime = base.plus({ minutes: prizeOffset }).toJSDate();
}

// Weeks start on Sunday and week 1 holds 1 January, as main's own week count did
const PRIZE_WEEKS: WeekSettings = { firstDay: 7, minimalDays: 1, weekend: [6, 7] };

function isPrizeDrawWeek(date: Date): boolean {
    const week = DateTime.fromMillis(date.getTime(), { zone: schedulerTimezone, weekSettings: PRIZE_WEEKS }).localWeekNumber;
    return (week + defaultSchedule.prizeWeekOffset) % defaultSchedule.prizeFrequencyWeeks === 0;
}

async function drawPrize(client: Client, services: ServiceContainer): Promise<void> {
    const { prizeRepo, taskRepo } = services.repos;
    const snapshot = await generatePrizeDrawSnapshot(prizeRepo, taskRepo);
    const winner = await rollWinnerForSnapshot(prizeRepo, snapshot.id, services);
    if (!winner) {
        console.log("[PrizeDraw] No eligible entries - skipping announcement.");
        return;
    }
    const announced = await announcePrizeDrawWinner(client, services, prizeRepo, snapshot.id);
    if (!announced) {
        console.warn(`[PrizeDraw] Winner rolled but announcement failed for ${snapshot.id}.`);
    }
}

export async function runTaskPollJob(client: Client, services: ServiceContainer): Promise<void> {
    console.log("[TaskScheduler] Running weekly task poll post...");
    await postAllTaskPolls(client, services);
}

export async function runTaskStartJob(client: Client, services: ServiceContainer): Promise<void> {
    console.log("[TaskScheduler] Closing poll and starting task event...");
    await startAllTaskEvents(client, services);
}

export async function runPrizeDrawJob(client: Client, services: ServiceContainer): Promise<void> {
    if (!isPrizeDrawWeek(new Date())) return;

    console.log("[TaskScheduler] Running prize draw...");
    await drawPrize(client, services);
}

export async function initTaskScheduler(client: Client, services: ServiceContainer): Promise<void> {
    console.log("[TaskScheduler] Initialising default task schedule...");

    const prizeExpression = `0 ${defaultSchedule.prizeHourUTC} * * ${defaultSchedule.prizeDay}`;

    const { guildId } = services;
    await stopTaskScheduler(guildId);

    if (isTestMode()) {
        // ------------------------------
        // TEST MODE (minute-base cycle)
        // ------------------------------
        const T = testIntervalMinutes;
        updateTestModeNextTimes();

        cron.schedule("* * * * *", async () => {
            const now = new Date();
            const minute = now.getMinutes();
            updateTestModeNextTimes(now);

            if (minute % T === (T - 1)) {
                await runTaskPollJob(client, services);
                if (nextPollTime) {
                    SchedulerStatusReporter.onNewTrigger("[TEST] Task Poll", nextPollTime);
                }
            }

            if (minute % T === 0) {
                await runTaskStartJob(client, services);
                if (nextEventTime) {
                    SchedulerStatusReporter.onNewTrigger("[TEST] Task Event", nextEventTime);
                }
            }

            if ((minute - 1) % (2 * T) === 0) {
                console.log("[TaskScheduler] [TEST] Running prize draw...");
                await drawPrize(client, services);
                if (nextPrizeTime) {
                    SchedulerStatusReporter.onNewTrigger("[TEST] Prize Draw", nextPrizeTime);
                }
            }
            console.log("[TaskScheduler] Test mode active (interval: every 7 minutes)");
            return;
        }, jobOptions(guildId, "test"));
    } else {
        // ------------------------------
        // PRODUCTION MODE (admin-configured cycle)
        // ------------------------------
        cron.schedule(
            `0 ${defaultSchedule.pollHourUTC} * * ${defaultSchedule.pollDay}`,
            async () => {
                await runTaskPollJob(client, services);
                const pollExpr = `0 ${defaultSchedule.pollHourUTC} * * ${defaultSchedule.pollDay}`;
                nextPollTime = getNextRunDate(pollExpr);
                if (nextPollTime) SchedulerStatusReporter.onNewTrigger("Task Poll", nextPollTime);
            },
            jobOptions(guildId, "poll")
        );

        cron.schedule(
            `0 ${defaultSchedule.pollHourUTC} * * ${(defaultSchedule.pollDay + 1) % 7}`,
            async () => {
                await runTaskStartJob(client, services);
                const eventExpr = `0 ${defaultSchedule.pollHourUTC} * * ${(defaultSchedule.pollDay + 1) % 7}`;
                nextEventTime = getNextRunDate(eventExpr);
                if (nextEventTime) SchedulerStatusReporter.onNewTrigger("Task Event", nextEventTime);
            },
            jobOptions(guildId, "taskStart")
        );

        const scheduleNextPrize = (reference: Date) => {
            nextPrizeTime = getNextMatchingRunDate(prizeExpression, isPrizeDrawWeek, reference);
            if (nextPrizeTime) {
                SchedulerStatusReporter.onNewTrigger("Prize Draw", nextPrizeTime);
            }
        };

        cron.schedule(
            prizeExpression,
            async () => {
                try {
                    await runPrizeDrawJob(client, services);
                } finally {
                    scheduleNextPrize(new Date());
                }
            },
            jobOptions(guildId, "prizeDraw")
        );
        cron.schedule(
            "0 0 * * 2",
            () => warnPendingLeaderboardFinalization(client, services),
            jobOptions(guildId, "leaderboardWarning")
        );

        cron.schedule(
            "0 0 * * 3",
            () => postPeriodicLeaderboardUpdate(client, services),
            jobOptions(guildId, "leaderboardUpdate")
        );
        const pollExpr = `0 ${defaultSchedule.pollHourUTC} * * ${defaultSchedule.pollDay}`;
        nextPollTime = getNextRunDate(pollExpr);
        if (nextPollTime) SchedulerStatusReporter.onNewTrigger("Task Poll", nextPollTime);

        const eventExpr = `0 ${defaultSchedule.pollHourUTC} * * ${(defaultSchedule.pollDay + 1) % 7}`;
        nextEventTime = getNextRunDate(eventExpr);
        if (nextEventTime) SchedulerStatusReporter.onNewTrigger("Task Event", nextEventTime);

        scheduleNextPrize(new Date());
    }
    console.log("[TaskScheduler] Production mode schedule initialised.");
}

export function taskSchedulerJobs(guildId: string): Map<string, ScheduledTask> {
    const prefix = `${JOB_PREFIX}:${guildId}:`;
    return new Map([...cron.getTasks().values()].flatMap((job) => job.name?.startsWith(prefix) ? [[job.name.slice(prefix.length), job]] : []));
}

export async function stopTaskScheduler(guildId: string): Promise<void> {
    const guildJobs = [...taskSchedulerJobs(guildId).values()];
    await Promise.all(guildJobs.map((job) => job.destroy()));
    if (guildJobs.length) console.log(`[TaskScheduler] Stopped ${guildJobs.length} jobs for ${guildId}.`);
}
