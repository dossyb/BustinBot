import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import type { ScheduledTask } from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import { postAllTaskPolls } from './HandleTaskPoll';
import { startAllTaskEvents } from './HandleTaskStart';
import { generatePrizeDrawSnapshot, rollWinnerForSnapshot, announcePrizeDrawWinner } from './HandlePrizeDraw';
import type { ServiceContainer } from '../../core/services/ServiceContainer';
import { SchedulerStatusReporter } from 'core/services/SchedulerStatusReporter';

// Store next trigger times for console log
let nextPollTime: Date | null = null;
let nextEventTime: Date | null = null;
let nextPrizeTime: Date | null = null;

export function getNextPollDate() { return nextPollTime; }
export function getNextEventDate() { return nextEventTime; }
export function getNextPrizeDrawDate() { return nextPrizeTime; }

// Replace with config store (admin editable)
const defaultSchedule = {
    pollDay: 0, // 0 = Sunday, 1 = Monday, ...
    pollHourUTC: 0,
    pollDurationHours: 24,
    taskDurationDays: 7,
    prizeFrequencyWeeks: 2,
    prizeDay: 2, // Tuesday
    prizeHourUTC: 0,
};

function getNextRunDate(expression: string): Date | null {
    try {
        const interval = CronExpressionParser.parse(expression, { currentDate: new Date() });
        return interval.next().toDate();
    } catch (err) {
        console.warn('[TaskScheduler] Failed to parse cron expression:', expression, err);
        return null;
    }
}

// Test config
function isTestMode() {
    return process.env.BOT_MODE === "dev";
}
const testIntervalMinutes = 7;

let pollJob: ScheduledTask;
let taskStartJob: ScheduledTask;
let prizeJob: ScheduledTask;
let testJob: ScheduledTask;

function updateTestModeNextTimes(reference: Date = new Date()) {
    const base = new Date(reference);
    base.setSeconds(0, 0);

    const baseMinutes = base.getMinutes();
    const remainder = baseMinutes % testIntervalMinutes;

    const pollOffset = ((testIntervalMinutes - 1 - remainder + testIntervalMinutes) % testIntervalMinutes) || testIntervalMinutes;
    const eventOffset = ((testIntervalMinutes - remainder) % testIntervalMinutes) || testIntervalMinutes;

    const cycleMinutes = 2 * testIntervalMinutes;
    const prizeRemainder = ((baseMinutes - 1) % cycleMinutes + cycleMinutes) % cycleMinutes;
    const prizeOffset = ((cycleMinutes - prizeRemainder) % cycleMinutes) || cycleMinutes;

    const pollTime = new Date(base);
    pollTime.setMinutes(baseMinutes + pollOffset);
    nextPollTime = pollTime;

    const eventTime = new Date(base);
    eventTime.setMinutes(baseMinutes + eventOffset);
    nextEventTime = eventTime;

    const prizeTime = new Date(base);
    prizeTime.setMinutes(baseMinutes + prizeOffset);
    nextPrizeTime = prizeTime;
}

export function getWeekNumber(d: Date): number {
    const oneJan = new Date(d.getUTCFullYear(), 0, 1);
    const millisInDay = 86400000;
    return Math.ceil(((d.getTime() - oneJan.getTime()) / millisInDay + oneJan.getUTCDay() + 1) / 7);
}

export async function getDefaultChannel(client: Client, services: ServiceContainer): Promise<TextChannel | null> {
    const guildId = services.guildId;
    const guildConfig = guildId ? await services.guilds.get(guildId) : null;
    const channelId = guildConfig?.channels?.taskChannel;
    if (!guildId || !channelId) return null;

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    return channel?.isTextBased() ? (channel as TextChannel) : null;
}

export function initTaskScheduler(
    client: Client,
    services: ServiceContainer,
    getChannel: (client: Client, services: ServiceContainer) => Promise<TextChannel | null> = getDefaultChannel,
    getWeek: typeof getWeekNumber = getWeekNumber
) {
    console.log('[TaskScheduler] Initialising default task schedule...');

    const { tasks, taskEvents, keywords, repos } = services;

    if (!tasks || !taskEvents || !keywords || !repos?.taskRepo || !repos?.prizeRepo) {
        throw new Error(
            "[TaskScheduler] Missing one or more required services (tasks, taskEvents, keywords, or repos)."
        );
    }

    // Shortcuts for readability
    const taskRepo = repos.taskRepo;
    const prizeRepo = repos.prizeRepo;

    if (isTestMode()) {
        // ------------------------------
        // TEST MODE (minute-base cycle)
        // ------------------------------
        const T = testIntervalMinutes;
        updateTestModeNextTimes();

        testJob = cron.schedule('* * * * *', async () => {
            const now = new Date();
            const minute = now.getMinutes();
            updateTestModeNextTimes(now);

            if (minute % T === (T - 1)) {
                console.log('[TaskScheduler] [TEST] Running poll...');
                await postAllTaskPolls(client, services);
                if (nextPollTime) {
                    SchedulerStatusReporter.onNewTrigger('[TEST] Task Poll', nextPollTime);
                }
            }

            if (minute % T === 0) {
                console.log('[TaskScheduler] [TEST] Starting task event...');
                await startAllTaskEvents(client, services);
                if (nextEventTime) {
                    SchedulerStatusReporter.onNewTrigger('[TEST] Task Event', nextEventTime);
                }
            }

            if ((minute - 1) % (2 * T) === 0) {
                console.log('[TaskScheduler] [TEST] Running prize draw...');
                const snapshot = await generatePrizeDrawSnapshot(prizeRepo, taskRepo);
                const winner = await rollWinnerForSnapshot(prizeRepo, snapshot.id, services);
                if (winner) {
                    const announced = await announcePrizeDrawWinner(client, services, prizeRepo, snapshot.id);
                    if (!announced) {
                        console.warn(`[PrizeDraw] Winner rolled but announcement failed for ${snapshot.id}.`);
                    }
                } else {
                    console.log("[PrizeDraw] No winner - no eligible entries.");
                }
                if (nextPrizeTime) {
                    SchedulerStatusReporter.onNewTrigger('[TEST] Prize Draw', nextPrizeTime);
                }
            }
            console.log('[TaskScheduler] Test mode active (interval: every 7 minutes)');
            return;
        });
    } else {
        // ------------------------------
        // PRODUCTION MODE (admin-configured cycle)
        // ------------------------------
        pollJob = cron.schedule(
            `0 ${defaultSchedule.pollHourUTC} * * ${defaultSchedule.pollDay}`,
            async () => {
                console.log('[TaskScheduler] Running weekly task poll post...');
                const channel = await getChannel(client, services);
                if (channel) {
                    await postAllTaskPolls(client, services);
                }
                const pollExpr = `0 ${defaultSchedule.pollHourUTC} * * ${defaultSchedule.pollDay}`;
                nextPollTime = getNextRunDate(pollExpr);
                if (nextPollTime) SchedulerStatusReporter.onNewTrigger('Task Poll', nextPollTime);
            });

        taskStartJob = cron.schedule(
            `0 ${defaultSchedule.pollHourUTC} * * ${(defaultSchedule.pollDay + 1) % 7}`,
            async () => {
                console.log('[TaskScheduler] Closing poll and starting task event...');
                const channel = await getChannel(client, services);
                if (channel) {
                    await startAllTaskEvents(client, services,);
                }
                const eventExpr = `0 ${defaultSchedule.pollHourUTC} * * ${(defaultSchedule.pollDay + 1) % 7}`;
                nextEventTime = getNextRunDate(eventExpr);
                if (nextEventTime) SchedulerStatusReporter.onNewTrigger('Task Event', nextEventTime);
            }
        );

        prizeJob = cron.schedule(
            `0 ${defaultSchedule.prizeHourUTC} * * ${defaultSchedule.prizeDay}`,
            async () => {
                const now = new Date();
                const isEvenWeek = Math.floor(getWeek(now)) % defaultSchedule.prizeFrequencyWeeks === 0;
                if (!isEvenWeek) return;
                console.log('[TaskScheduler] Running prize draw...');
                const channel = await getChannel(client, services);
                if (channel) {
                    await channel.send('🏆 Running prize draw. The winner is BustinBot!');
                }
                const prizeExpr = `0 ${defaultSchedule.prizeHourUTC} * * ${defaultSchedule.prizeDay}`;
                nextPrizeTime = getNextRunDate(prizeExpr);
                if (nextPrizeTime) SchedulerStatusReporter.onNewTrigger('Prize Draw', nextPrizeTime);
            }
        );
        const pollExpr = `0 ${defaultSchedule.pollHourUTC} * * ${defaultSchedule.pollDay}`;
        nextPollTime = getNextRunDate(pollExpr);
        if (nextPollTime) SchedulerStatusReporter.onNewTrigger('Task Poll', nextPollTime);

        const eventExpr = `0 ${defaultSchedule.pollHourUTC} * * ${(defaultSchedule.pollDay + 1) % 7}`;
        nextEventTime = getNextRunDate(eventExpr);
        if (nextEventTime) SchedulerStatusReporter.onNewTrigger('Task Event', nextEventTime);

        const prizeExpr = `0 ${defaultSchedule.prizeHourUTC} * * ${defaultSchedule.prizeDay}`;
        nextPrizeTime = getNextRunDate(prizeExpr);
        if (nextPrizeTime) SchedulerStatusReporter.onNewTrigger('Prize Draw', nextPrizeTime);
    }
    console.log('[TaskScheduler] Production mode schedule initialised.');
}

export function stopTaskScheduler() {
    testJob?.stop();
    pollJob?.stop();
    taskStartJob?.stop();
    prizeJob?.stop();
    console.log('[TaskScheduler] All jobs stopped.');
}
