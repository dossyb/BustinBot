import { Client, EmbedBuilder } from "discord.js";
import type { GuildTextBasedChannel } from "discord.js";
import { DateTime } from "luxon";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { configuredChannel } from "../../utils/ChannelUtils.js";
import { SubmissionStatus } from "../../models/TaskSubmission.js";
import { TaskCategory } from "../../models/Task.js";
import { TIER_STAT_MAP } from "./TaskService.js";
import {
    awardTaskChampionRoles,
    buildRankedPeriodicEntries,
    buildTopTenTableLines,
    ensureTaskLeaderboardsInitialized,
    finalizePeriodicLeaderboard,
    getStatusPoints,
    getUniquePeriodCount,
    getUserLabel,
    holdsEveryTask,
    incrementLifetimePoints,
    incrementPeriodicPoints,
    isPeriodicLeaderboardEnabled,
    rankPeriodicEntries,
    resolvePeriodicLabel,
    resolvePeriodicPlacements,
    resolvePeriodicProgress,
    shouldFinalizePeriodicLeaderboard,
    weekRegularEvents,
    type RankedEntry,
} from "./TaskLeaderboards.js";
import type { TaskLeaderboard, TaskLeaderboardEntry, TaskLeaderboardPeriod, TaskTierCounts } from "../../models/TaskLeaderboard.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../utils/MentionUtils.js";

async function resolveTaskUserMention(services: ServiceContainer): Promise<string | null> {
    const guildConfig = await services.guilds.get(services.guildId);
    if (!guildConfig?.roles?.taskUser) return null;

    return `<@&${guildConfig.roles.taskUser}>`;
}

async function sendLeaderboardEmbed(
    services: ServiceContainer,
    channel: GuildTextBasedChannel,
    embed: EmbedBuilder,
    mention?: string | null
): Promise<void> {
    const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);

    if (mention) {
        await channel.send(withSuppressedMentions({ content: mention, embeds: [embed] }, suppressMentions));
        return;
    }

    await channel.send({ embeds: [embed] });
}

type PeriodFooter = { elapsed: number; total: number };

async function notifyChampionWinners(
    client: Client,
    services: ServiceContainer,
    placements: ReturnType<typeof resolvePeriodicPlacements>
): Promise<void> {
    const guild = await client.guilds.fetch(services.guildId);
    const guildName = guild.name;
    const guildConfig = await services.guilds.get(services.guildId);
    const championSettings = {
        first: true,
        second: true,
        third: true,
        ...(guildConfig?.taskSettings?.championRoles ?? {}),
    };

    const roleNames = {
        first: guildConfig?.roles?.taskChampionFirst
            ? guild.roles.cache.get(guildConfig.roles.taskChampionFirst)?.name ?? null
            : null,
        second: guildConfig?.roles?.taskChampionSecond
            ? guild.roles.cache.get(guildConfig.roles.taskChampionSecond)?.name ?? null
            : null,
        third: guildConfig?.roles?.taskChampionThird
            ? guild.roles.cache.get(guildConfig.roles.taskChampionThird)?.name ?? null
            : null,
    };

    const toNotify = [
        { winners: placements.first, label: "1st", roleName: roleNames.first, enabled: championSettings.first },
        { winners: placements.second, label: "2nd", roleName: roleNames.second, enabled: championSettings.second },
        { winners: placements.third, label: "3rd", roleName: roleNames.third, enabled: championSettings.third },
    ];

    for (const entry of toNotify) {
        for (const winner of entry.winners) {
            try {
                const user = await client.users.fetch(winner.userId);
                if (!user) continue;
                const roleLine =
                    entry.enabled && entry.roleName
                        ? `You have been awarded the **${entry.roleName}** role to flex.`
                        : "Your placement has been recorded by the task admins.";
                await user.send(
                    `🏆 Congratulations! You placed **${entry.label}** on the periodic task leaderboard in **${guildName}**.\n${roleLine}`
                );
            } catch (err) {
                console.warn(`[LeaderboardUpdate] Failed to DM leaderboard winner ${winner.userId}:`, err);
            }
        }
    }
}

async function buildFinalLeaderboardEmbed(
    client: Client,
    services: ServiceContainer,
    leaderboard: TaskLeaderboard,
    placements: ReturnType<typeof resolvePeriodicPlacements>,
    topTen: RankedEntry<TaskLeaderboardEntry>[],
    summaryNote?: string,
    options?: { periodLabel?: string; footer?: PeriodFooter; tierCounts?: Record<string, TaskTierCounts> }
): Promise<EmbedBuilder> {
    const context = { client, guild: await client.guilds.fetch(services.guildId).catch(() => null) };
    const topTenLines = await buildTopTenTableLines(topTen, context, options?.tierCounts ?? leaderboard.tierCounts);
    const winnerLines = await Promise.all(
        [
            { label: "🥇", winners: placements.first },
            { label: "🥈", winners: placements.second },
            { label: "🥉", winners: placements.third },
        ].map(async (group) => {
            if (group.winners.length === 0) return `${group.label} — None`;
            const names = await Promise.all(
                group.winners.map(async (entry) => await getUserLabel(entry.userId, context))
            );
            return `${group.label} ${names.join(", ")}`;
        })
    );

    const periodLabel = options?.periodLabel ?? resolvePeriodicLabel(leaderboard.period?.length);
    const descriptionLines = [
        "The leaderboard period has ended! Congratulations to our top finishers.",
        "Temporary Task Champion roles have been awarded to the top 3.",
        `${periodLabel} leaderboard standings have been reset.`
    ];

    if (summaryNote) {
        descriptionLines.push(summaryNote);
    }

    const embed = new EmbedBuilder()
        .setTitle("🏆 Final Leaderboard Standings")
        .setDescription(descriptionLines.join(" "))
        .setColor(0xa60000)
        .addFields(
            {
                name: "Our Task Champions",
                value: winnerLines.join("\n"),
            },
            {
                name: "Final Top 10",
                value: topTenLines.length ? topTenLines.join("\n") : "No points recorded yet.",
            }
        );

    if (options?.footer) {
        embed.setFooter({ text: `Task events elapsed: ${options.footer.elapsed}/${options.footer.total}` });
    } else if (leaderboard.period) {
        const progress = await resolvePeriodicProgress(services, leaderboard.period);
        embed.setFooter({ text: `Task events elapsed: ${progress.elapsed}/${leaderboard.period.length}` });
    }

    return embed;
}

async function postCurrentStandings(
    client: Client,
    services: ServiceContainer,
    leaderboard: TaskLeaderboard,
    period: TaskLeaderboardPeriod
): Promise<boolean> {
    const channel = await configuredChannel(client, services, "taskChannel");
    if (!channel) return false;

    const topTen = buildRankedPeriodicEntries(leaderboard.points).slice(0, 10);
    const lines = await buildTopTenTableLines(topTen, { client, guild: await client.guilds.fetch(services.guildId).catch(() => null) }, leaderboard.tierCounts);
    const progress = await resolvePeriodicProgress(services, period);

    const embed = new EmbedBuilder()
        .setTitle("🏆 Current Leaderboard Standings")
        .setDescription("Leaderboard points are tallied from approved task submissions for the current period.")
        .setColor(0xa60000)
        .addFields(
            {
                name: "Top 10",
                value: lines.length ? lines.join("\n") : "No points recorded yet.",
            },
            {
                name: "Period Progress",
                value: `Week ${progress.elapsed + 1} of ${period.length}`,
            }
        )
        .setFooter({
            text: `Task events elapsed: ${progress.elapsed}/${period.length}`,
        });

    await channel.send({ embeds: [embed] });
    return true;
}

export async function postWeeklyLeaderboardSnapshot(client: Client, services: ServiceContainer): Promise<boolean> {
    let leaderboard: TaskLeaderboard | null;
    try {
        leaderboard = (await ensureTaskLeaderboardsInitialized(services)).periodic;
    } catch (err) {
        console.warn("[LeaderboardUpdate] Leaderboard initialisation failed:", err);
        return false;
    }

    if (!leaderboard?.period) return false;

    return await postCurrentStandings(client, services, leaderboard, leaderboard.period);
}

export async function postFinalLeaderboardSnapshot(client: Client, services: ServiceContainer): Promise<boolean> {
    let leaderboard: TaskLeaderboard | null;
    try {
        leaderboard = (await ensureTaskLeaderboardsInitialized(services)).periodic;
    } catch (err) {
        console.warn("[LeaderboardUpdate] Leaderboard initialisation failed:", err);
        return false;
    }

    if (!leaderboard?.period) return false;

    const channel = await configuredChannel(client, services, "taskChannel");
    if (!channel) return false;

    const hasCurrentEvents = leaderboard.period.eventIds.length > 0;
    const fallbackToCompleted = !hasCurrentEvents && !!leaderboard.completedPeriod;

    if (fallbackToCompleted && leaderboard.completedPeriod) {
        const completed = leaderboard.completedPeriod;
        const topTen = completed.topTen ?? completed.topThree ?? [];
        const placements = resolvePeriodicPlacements(topTen);
        const rankedTopTen = rankPeriodicEntries(topTen).slice(0, 10);
        const summaryNote = "No task events have completed yet for the new period; showing last period standings.";
        const elapsed = await getUniquePeriodCount(services, completed.eventIds);
        const finalEmbed = await buildFinalLeaderboardEmbed(
            client,
            services,
            leaderboard,
            placements,
            rankedTopTen,
            summaryNote,
            {
                periodLabel: resolvePeriodicLabel(elapsed),
                footer: { elapsed, total: elapsed },
                tierCounts: completed.tierCounts ?? {},
            }
        );
        const mention = await resolveTaskUserMention(services);
        await sendLeaderboardEmbed(services, channel, finalEmbed, mention);
        return true;
    }

    const progress = await resolvePeriodicProgress(services, leaderboard.period);
    const ranked = buildRankedPeriodicEntries(leaderboard.points);
    const topTen = ranked.slice(0, 10);
    const placements = resolvePeriodicPlacements(
        ranked.map((entry) => ({ userId: entry.userId, points: entry.points }))
    );
    const finalEmbed = await buildFinalLeaderboardEmbed(client, services, leaderboard, placements, topTen, undefined, {
        periodLabel: resolvePeriodicLabel(leaderboard.period.length),
        footer: {
            elapsed: progress.elapsed,
            total: leaderboard.period.length,
        },
        tierCounts: leaderboard.tierCounts ?? {},
    });
    const mention = await resolveTaskUserMention(services);
    await sendLeaderboardEmbed(services, channel, finalEmbed, mention);
    return true;
}

async function settleMonisChoice(services: ServiceContainer): Promise<void> {
    const taskRepo = services.repos.taskRepo;
    const now = DateTime.now();
    const ended = await taskRepo.getTaskEventsBetween(now.minus({ weeks: 1 }).toJSDate(), now.toJSDate());
    for (const monisChoice of ended.filter((event) => event.category === TaskCategory.MonisChoice && !event.settledAt)) {
        const regularEvents = await weekRegularEvents(taskRepo, monisChoice);
        for (const userId of monisChoice.completedUserIds ?? []) {
            if (!holdsEveryTask(regularEvents, userId)) continue;
            const status = await services.tasks.getHeldStatus(userId, monisChoice.id);
            const stat = status && TIER_STAT_MAP[status];
            if (!stat) continue;
            await services.repos.userRepo.incrementStat(userId, stat, -1);
            await incrementLifetimePoints(services, userId, -getStatusPoints(status));
            await incrementPeriodicPoints(services, userId, -getStatusPoints(status), monisChoice.id, null, status);
        }
        await taskRepo.createTaskEvent({ ...monisChoice, settledAt: new Date() });
    }
}

export async function postPeriodicLeaderboardUpdate(client: Client, services: ServiceContainer): Promise<void> {
    await settleMonisChoice(services);

    if (!(await isPeriodicLeaderboardEnabled(services))) {
        return;
    }

    let leaderboard: TaskLeaderboard | null;
    try {
        leaderboard = (await ensureTaskLeaderboardsInitialized(services)).periodic;
    } catch (err) {
        console.warn("[LeaderboardUpdate] Leaderboard initialisation failed:", err);
        return;
    }

    if (!leaderboard?.period) return;

    const period = leaderboard.period;

    if (await shouldFinalizePeriodicLeaderboard(services, period)) {
        const rankedAll = buildRankedPeriodicEntries(leaderboard.points);
        const placements = resolvePeriodicPlacements(
            rankedAll.map((entry) => ({
                userId: entry.userId,
                points: entry.points,
            }))
        );

        await finalizePeriodicLeaderboard(services, leaderboard, placements.winners);
        await awardTaskChampionRoles(client, services, placements, period.index);

        const channel = await configuredChannel(client, services, "taskChannel");
        if (channel) {
            const progress = await resolvePeriodicProgress(services, period);
            const finalEmbed = await buildFinalLeaderboardEmbed(client, services, leaderboard, placements, rankedAll.slice(0, 10), undefined, {
                periodLabel: resolvePeriodicLabel(period.length),
                footer: {
                    elapsed: progress.elapsed,
                    total: progress.total,
                },
                tierCounts: leaderboard.tierCounts ?? {},
            });
            const mention = await resolveTaskUserMention(services);
            await sendLeaderboardEmbed(services, channel, finalEmbed, mention);
        }

        await notifyChampionWinners(client, services, placements);
        return;
    }

    await postCurrentStandings(client, services, leaderboard, period);
}

export async function warnPendingLeaderboardFinalization(client: Client, services: ServiceContainer): Promise<void> {
    const taskRepo = services.repos.taskRepo;

    if (!(await isPeriodicLeaderboardEnabled(services))) {
        return;
    }

    let leaderboard: TaskLeaderboard | null;
    try {
        leaderboard = (await ensureTaskLeaderboardsInitialized(services)).periodic;
    } catch (err) {
        console.warn("[LeaderboardUpdate] Leaderboard initialisation failed:", err);
        return;
    }

    if (!leaderboard?.period || !(await shouldFinalizePeriodicLeaderboard(services, leaderboard.period))) return;

    const pendingCounts = await Promise.all(
        leaderboard.period.eventIds.map(async (eventId) => {
            const submissions = await taskRepo.getSubmissionsForTask(eventId);
            return submissions.filter((submission) => submission.status === SubmissionStatus.Pending).length;
        })
    );

    const pendingTotal = pendingCounts.reduce((sum, count) => sum + count, 0);
    if (pendingTotal === 0) return;

    const channel = await configuredChannel(client, services, "taskVerification");
    if (!channel) return;

    const adminRoleId = (await services.guilds.get(services.guildId))?.roles?.taskAdmin;
    const mention = adminRoleId ? `<@&${adminRoleId}>` : "Task Admins";
    const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);

    await channel.send(withSuppressedMentions({
        content: `${mention} There are ${pendingTotal} pending task submissions and the periodic leaderboard will finalise in ~24 hours. Please review before the update.`
    }, suppressMentions));
}
