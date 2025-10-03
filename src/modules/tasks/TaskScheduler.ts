import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import { postTaskPoll } from './HandleTaskPoll';
import { startTaskEvent } from './HandleTaskStart';

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

// Test config
const testMode = true;
const testIntervalMinutes = 7;

let pollJob: ScheduledTask;
let taskStartJob: ScheduledTask;
let prizeJob: ScheduledTask;
let testJob: ScheduledTask;

function getWeekNumber(d: Date): number {
    const oneJan = new Date(d.getUTCFullYear(), 0, 1);
    const millisInDay = 86400000;
    return Math.ceil(((d.getTime() - oneJan.getTime()) / millisInDay + oneJan.getUTCDay() + 1) / 7);
}

async function getDefaultChannel(client: Client): Promise<TextChannel | null> {
    const guildId = process.env.DISCORD_GUILD_ID;
    const channelId = process.env.TASK_CHANNEL_ID;
    if (!guildId || !channelId) return null;

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    return channel?.isTextBased() ? (channel as TextChannel) : null;
}

export function initTaskScheduler(client: Client) {
    console.log('[TaskScheduler] Initialising default task schedule...');

    if (testMode) {
        // ------------------------------
        // TEST MODE (minute-base cycle)
        // ------------------------------
        const T = testIntervalMinutes;

        testJob = cron.schedule('* * * * *', async () => {
            const minute = new Date().getMinutes();

            if (minute % T === (T - 1)) {
                console.log('[TaskScheduler] [TEST] Running poll...');
                await postTaskPoll(client);
            }

            if (minute % T === 0) {
                console.log('[TaskScheduler] [TEST] Starting task event...');
                await startTaskEvent(client);
            }

            if ((minute - 1) % (2 * T) === 0) {
                console.log('[TaskScheduler] [TEST] Running prize draw...');
                const channel = await getDefaultChannel(client);
                if (channel) await channel.send('🏆 Running prize draw. The winner is BustinBot!');
            }
        });
    } else {
        // ------------------------------
        // PRODUCTION MODE (admin-configured cycle)
        // ------------------------------
        pollJob = cron.schedule(
            `0 ${defaultSchedule.pollHourUTC} * * ${defaultSchedule.pollDay}`,
            async () => {
                console.log('[TaskScheduler] Running weekly task poll post...');
                const channel = await getDefaultChannel(client);
                if (channel) {
                    await postTaskPoll(client);
                }
            });

        taskStartJob = cron.schedule(
            `0 ${defaultSchedule.pollHourUTC} * * ${(defaultSchedule.pollDay + 1) % 7}`,
            async () => {
                console.log('[TaskScheduler] Closing poll and starting task event...');
                const channel = await getDefaultChannel(client);
                if (channel) {
                    await startTaskEvent(client);
                }
            }
        );

        prizeJob = cron.schedule(
            `0 ${defaultSchedule.prizeHourUTC} * * ${defaultSchedule.prizeDay}`,
            async () => {
                const now = new Date();
                const isEvenWeek = Math.floor(getWeekNumber(now)) % defaultSchedule.prizeFrequencyWeeks === 0;
                if (!isEvenWeek) return;
                console.log('[TaskScheduler] Running prize draw...');
                const channel = await getDefaultChannel(client);
                if (channel) {
                    await channel.send('🏆 Running prize draw. The winner is BustinBot!');
                }
            }
        );
    }
}

export function stopTaskScheduler() {
    testJob?.stop();
    pollJob?.stop();
    taskStartJob?.stop();
    prizeJob?.stop();
    console.log('[TaskScheduler] All jobs stopped.');
}