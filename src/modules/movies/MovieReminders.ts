import { DateTime } from "luxon";
import fs from 'fs';
import path from 'path';
import type { Reminder } from "../../models/Reminder";
import type { Client, TextChannel } from 'discord.js';

export function getPendingReminders(movieStart: DateTime, now: DateTime = DateTime.utc()): Reminder[] {
    const reminderOffsets = [
        { label: '2 hours before', offset: { hours: 2 } },
        { label: '30 mins before', offset: { minutes: 30 } },
        { label: 'start time', offset: { minutes: 0 } },
    ];

    return reminderOffsets
        .map(({ label, offset }) => {
            const sendAt = movieStart.minus(offset);
            return { sendAt, label };
        })
        .filter(({ sendAt }) => sendAt > now);
}

export async function restoreMovieReminders(client: Client) {
    const movieNightPath = path.resolve(process.cwd(), "src/data/movieNight.json");
    if (!fs.existsSync(movieNightPath)) return;

    const data = JSON.parse(fs.readFileSync(movieNightPath, "utf-8"));
    const storedUTC = data.storedUTC;

    if (!storedUTC) return;

    const movieStart = DateTime.fromISO(storedUTC);
    const reminders = getPendingReminders(movieStart);

    scheduleMovieReminders(movieStart, client);

    console.log(`[MovieReminders] Restored ${reminders.length} reminder(s) from movieNight.json`);
}

export async function scheduleMovieReminders(movieStart: DateTime, client: Client) {
    const reminders = getPendingReminders(movieStart);
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID!);
    const voiceChannelId = process.env.MOVIE_VOICE_CHANNEL_ID!;
    const roleName = process.env.MOVIE_USER_ROLE_NAME!;

    const channel = guild.channels.cache.find(
        ch => ch.name === 'movie-night' && ch.isTextBased()
    ) as TextChannel | undefined;

    const role = guild.roles.cache.find(r => r.name === roleName);
    const mention = role ? `<@&${role.id}>` : '';

    if (!channel) {
        console.warn('[MovieReminders] Could not find movie-night channel.');
        return;
    }

    for (const { sendAt, label } of reminders) {
        const now = DateTime.utc();
        const delayMs = sendAt.diff(now).as('milliseconds');

        if (delayMs <= 0) {
            console.warn(`[MovieReminders] Skipping past reminder "${label}"`);
            continue;
        }

        setTimeout(async () => {
            const relativeTime = sendAt.toRelative({ base: now }) ?? label;
            const msg =
                label === 'start time'
                    ? `${mention} Movie night is starting now! Join us in <#${voiceChannelId}> 🎬`
                    : `${mention} Movie night starts <t:${Math.floor(movieStart.toSeconds())}:R>! Get ready 🍿`;
            try {
                await channel.send(msg);
                console.log(`[MovieReminders] Sent "${label}" reminder at ${sendAt.toISO()}`);
            } catch (err) {
                console.error(`[MovieReminders] Failed to send reminder:`, err);
            }
        }, delayMs);

        console.log(`[MovieReminders] Scheduled "${label}" in ${Math.round(delayMs / 60000)} min(s)`);
    }
}