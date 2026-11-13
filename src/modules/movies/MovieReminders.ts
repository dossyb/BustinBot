import { DateTime, Duration } from "luxon";
import { time, TimestampStyles, type Client } from "discord.js";
import type { Reminder } from "../../models/Reminder.js";
import type { MovieEvent } from "../../models/MovieEvent.js";
import { isPlaceholderMovie } from "./MovieLifecycle.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../utils/MentionUtils.js";
import { configuredChannel } from "../../utils/ChannelUtils.js";

const MOVIE_REMINDERS = [
    { label: "2 hours before", offset: { hours: 2 } },
    { label: "30 mins before", offset: { minutes: 30 } },
    { label: "start time", offset: { minutes: 0 } },
] as const;

const REMINDER_GRACE = Duration.fromObject({ minutes: 15 });

function remindersFor(movieStart: DateTime): Reminder[] {
    return MOVIE_REMINDERS.map(({ label, offset }) => ({ sendAt: movieStart.minus(offset), label }));
}

export function getPendingReminders(movieStart: DateTime, now: DateTime = DateTime.utc()): Reminder[] {
    return remindersFor(movieStart).filter(({ sendAt }) => sendAt > now);
}

export async function sendDueReminders(
    client: Client,
    services: ServiceContainer,
    event: MovieEvent,
    now: Date
): Promise<void> {
    const movieRepo = services.repos.movieRepo;

    const start = DateTime.fromJSDate(event.startTime);
    const at = DateTime.fromJSDate(now);
    const due = remindersFor(start).filter(({ label, sendAt }) => sendAt <= at && !(event.remindersSent ?? []).includes(label));
    if (!due.length) return;

    const channel = await configuredChannel(client, services, "movieNight");
    if (!channel) return;

    const claimed = await movieRepo.claimReminders(event.id, due.map(({ label }) => label));
    const latest = due.filter(({ label }) => claimed.includes(label)).at(-1);
    if (!latest) return;
    if (latest.sendAt.plus(REMINDER_GRACE) < at) {
        console.warn(`[MovieReminders] Skipped the "${latest.label}" reminder for ${event.id}: it came due while the bot was down.`);
        return;
    }

    const guildConfig = await services.guilds.get(services.guildId);
    const mention = guildConfig?.roles?.movieUser ? `<@&${guildConfig.roles.movieUser}> ` : "";
    const voiceChannelId = event.voiceChannelId ?? guildConfig?.channels?.movieVC;
    const voiceMention = voiceChannelId ? `<#${voiceChannelId}>` : "the movie voice channel";

    // Retrieve current state from Firestore
    const activePoll = await movieRepo.getActivePoll();
    // Determine movie state line
    const title = isPlaceholderMovie(event.movie) ? null : event.movie.title;
    const stateLine = activePoll?.isActive
        ? `A movie poll is currently running! Go cast your vote before it closes.`
        : title
            ? `We will be watching **${title}**!`
            : `No movie has been selected yet — stay tuned!`;

    // Format remaining time
    const minutesLeft = Math.max(Math.round(start.diff(at, "minutes").minutes), 0);
    const remaining = Duration.fromObject({ minutes: minutesLeft }, { locale: "en" })
        .shiftTo("hours", "minutes")
        .removeZeros()
        .toHuman({ listStyle: "long" });
    // Build and send message
    const content =
        latest.label === "start time"
            ? `${mention}Movie night is starting **now**! Join us in ${voiceMention} 🎬\n${stateLine}`
            : `${mention}Movie night starts in **${remaining}** (at ${time(event.startTime, TimestampStyles.ShortTime)})! ${stateLine}`;

    const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);
    await channel.send(withSuppressedMentions({ content }, suppressMentions));
    console.log(`[MovieReminders] Sent "${latest.label}" reminder for ${event.id}.`);
}
