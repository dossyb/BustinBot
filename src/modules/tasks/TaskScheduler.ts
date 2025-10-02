import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import { postTaskPoll } from './HandleTaskPoll';

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

let pollJob: ScheduledTask;
let taskStartJob: ScheduledTask;
let prizeJob: ScheduledTask;

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

    // Schedule poll
    pollJob = cron.schedule(
        // `0 ${defaultSchedule.pollHourUTC} * * ${defaultSchedule.pollDay}`, 
        // Test timing
        '0 * * * * *',
        async () => {
        console.log('[TaskScheduler] Running weekly task poll post...');
        const channel = await getDefaultChannel(client);
        if (channel) {
            await postTaskPoll(client);
        }
    });

    // Schedule task start
    taskStartJob = cron.schedule(
        // `0 ${defaultSchedule.pollHourUTC} * * ${(defaultSchedule.pollDay + 1) % 7}`,
        // Test timing
        '20 * * * * *',
        async () => {
            console.log('[TaskScheduler] Closing poll and starting task event...');
            const channel = await getDefaultChannel(client);
            if (channel) {
                await channel.send('⏳ Poll closed! Weekly task started.');
            }
        }
    );

    // Schedule prize draw
    prizeJob = cron.schedule(
        // `0 ${defaultSchedule.prizeHourUTC} * * ${defaultSchedule.prizeDay}`,
        // Test timing
        '50 */2 * * * *',
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

export function stopTaskScheduler() {
    pollJob?.stop();
    taskStartJob?.stop();
    prizeJob?.stop();
    console.log('[TaskScheduler] All jobs stopped.');
}