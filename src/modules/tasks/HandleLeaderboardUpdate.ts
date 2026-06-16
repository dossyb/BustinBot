import { Client, EmbedBuilder, TextChannel } from "discord.js";
import type { Guild } from "discord.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { isTextChannel } from "../../utils/ChannelUtils.js";
import { SubmissionStatus } from "../../models/TaskSubmission.js";
import {
    awardTaskChampionRoles,
    buildRankedPeriodicEntries,
    ensureTaskLeaderboardsInitialized,
    finalizePeriodicLeaderboard,
    getUniquePeriodCount,
    isPeriodicLeaderboardEnabled,
    resolvePeriodicPlacements,
    resolvePeriodicProgress,
    shouldFinalizePeriodicLeaderboard,
} from "./TaskLeaderboards.js";
import type { TaskLeaderboard, TaskLeaderboardEntry, TaskTierCounts } from "../../models/TaskLeaderboard.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../utils/MentionUtils.js";

async function resolveTaskChannel(client: Client, services: ServiceContainer): Promise<TextChannel | null> {
    const guildId = services.guildId;
    if (!guildId) return null;

    const guildConfig = await services.guilds.get(guildId);
    if (!guildConfig) return null;

    const guild = await client.guilds.fetch(guildId);
    const channelId = guildConfig.channels?.taskChannel;
    if (channelId) {
        const fetched = await guild.channels.fetch(channelId);
        if (fetched && isTextChannel(fetched)) {
            return fetched;
        }
    }

    const fallback = client.channels.cache.find(
        (channel): channel is TextChannel => isTextChannel(channel) && "name" in channel && channel.name === "weekly-task"
    );
    return fallback ?? null;
}

async function resolveTaskUserMention(client: Client, services: ServiceContainer): Promise<string | null> {
    const guildId = services.guildId;
    if (!guildId) return null;

    const guildConfig = await services.guilds.get(guildId);
    if (!guildConfig?.roles?.taskUser) return null;

    return `<@&${guildConfig.roles.taskUser}>`;
}

async function sendLeaderboardEmbed(
    services: ServiceContainer,
    channel: TextChannel,
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

async function resolveUserLabel(
    client: Client,
    services: ServiceContainer,
    userId: string,
    guild?: Guild | null
): Promise<string> {
    if (guild) {
        try {
            const member = await guild.members.fetch(userId);
            const displayName = member?.displayName ?? member?.user?.username;
            if (displayName) return displayName.replace(/`/g, "'");
        } catch (err) {
            // Ignore and fall back
        }
    } else if (services.guildId) {
        try {
            const fetchedGuild = await client.guilds.fetch(services.guildId);
            return await resolveUserLabel(client, services, userId, fetchedGuild);
        } catch (err) {
            // Ignore and fall back
        }
    }

    const cached = client.users.cache.get(userId);
    if (cached?.username) return cached.username.replace(/`/g, "'");

    try {
        const user = await client.users.fetch(userId);
        return user?.username?.replace(/`/g, "'") ?? userId;
    } catch (err) {
        return userId;
    }
}

type RankedEntry = TaskLeaderboardEntry & { rank: number };

function rankPeriodicEntries(entries: TaskLeaderboardEntry[]): RankedEntry[] {
    const sorted = [...entries].sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return a.userId.localeCompare(b.userId);
    });

    let lastKey = "";
    let lastRank = 0;

    return sorted.map((entry, index) => {
        const key = `${entry.points}`;
        const rank = key === lastKey ? lastRank : index + 1;
        lastKey = key;
        lastRank = rank;
        return { ...entry, rank };
    });
}

async function buildTopTenTableLines(
    client: Client,
    services: ServiceContainer,
    entries: RankedEntry[],
    tierCounts?: Record<string, TaskTierCounts>
): Promise<string[]> {
    if (entries.length === 0) return [];

    let guild: Guild | null = null;
    if (services.guildId) {
        try {
            guild = await client.guilds.fetch(services.guildId);
        } catch (err) {
            guild = null;
        }
    }

    const uniqueIds = [...new Set(entries.map((entry) => entry.userId))];
    const nameEntries = await Promise.all(
        uniqueIds.map(async (userId) => [userId, await resolveUserLabel(client, services, userId, guild)] as const)
    );
    const nameMap = new Map(nameEntries);

    const MAX_NAME_LENGTH = 14;
    const rankCounts = new Map<number, number>();
    for (const entry of entries) {
        rankCounts.set(entry.rank, (rankCounts.get(entry.rank) ?? 0) + 1);
    }

    const rows = entries.map((entry) => {
        const rawName = nameMap.get(entry.userId) ?? entry.userId;
        const name =
            rawName.length > MAX_NAME_LENGTH ? `${rawName.slice(0, MAX_NAME_LENGTH - 3)}...` : rawName;
        const baseRankLabel =
            entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : `${entry.rank}.`;
        const tiePrefix = (rankCounts.get(entry.rank) ?? 0) > 1 ? "=" : "";
        const rankLabel = `${tiePrefix}${baseRankLabel}`;
        const counts = tierCounts?.[entry.userId];
        return {
            rankLabel,
            name,
            points: String(entry.points),
            bronze: String(counts?.bronze ?? 0),
            silver: String(counts?.silver ?? 0),
            gold: String(counts?.gold ?? 0),
        };
    });

    const rankWidth = Math.max("Rank".length, ...rows.map((row) => row.rankLabel.length));
    const nameWidth = Math.max("Name".length, ...rows.map((row) => row.name.length));
    const pointsWidth = Math.max("Pts".length, ...rows.map((row) => row.points.length));
    const bronzeWidth = Math.max("B".length, ...rows.map((row) => row.bronze.length));
    const silverWidth = Math.max("S".length, ...rows.map((row) => row.silver.length));
    const goldWidth = Math.max("G".length, ...rows.map((row) => row.gold.length));

    const header = `${"Rank".padEnd(rankWidth)}  ${"Name".padEnd(nameWidth)}  ${"Pts".padStart(pointsWidth)}  ${"B".padStart(bronzeWidth)}  ${"S".padStart(silverWidth)}  ${"G".padStart(goldWidth)}`;
    const body = rows.map(
        (row) =>
            `${row.rankLabel.padEnd(rankWidth)}  ${row.name.padEnd(nameWidth)}  ${row.points.padStart(pointsWidth)}  ${row.bronze.padStart(bronzeWidth)}  ${row.silver.padStart(silverWidth)}  ${row.gold.padStart(goldWidth)}`
    );

    return ["```", header, ...body, "```"];
}

function resolvePeriodicLabel(length?: number): string {
    switch (length) {
        case 2:
            return "Fortnightly";
        case 4:
            return "Monthly";
        case 8:
            return "Bi-Monthly";
        case 12:
            return "Quarterly";
        default:
            return "Periodic";
    }
}

type PeriodFooter = { elapsed: number; total: number };

async function notifyChampionWinners(
    client: Client,
    services: ServiceContainer,
    placements: ReturnType<typeof resolvePeriodicPlacements>
): Promise<void> {
    const guildId = services.guildId;
    if (!guildId) return;

    const guild = await client.guilds.fetch(guildId);
    const guildName = guild.name;
    const guildConfig = await services.guilds.get(guildId);
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
    topTen: RankedEntry[],
    summaryNote?: string,
    options?: { periodLabel?: string; footer?: PeriodFooter; tierCounts?: Record<string, TaskTierCounts> }
): Promise<EmbedBuilder> {
    const topTenLines = await buildTopTenTableLines(
        client,
        services,
        topTen,
        options?.tierCounts ?? leaderboard.tierCounts
    );
    const winnerLines = await Promise.all(
        [
            { label: "🥇", winners: placements.first },
            { label: "🥈", winners: placements.second },
            { label: "🥉", winners: placements.third },
        ].map(async (group) => {
            if (group.winners.length === 0) return `${group.label} — None`;
            const names = await Promise.all(
                group.winners.map(async (entry) => await resolveUserLabel(client, services, entry.userId))
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

export async function postWeeklyLeaderboardSnapshot(
    client: Client,
    services: ServiceContainer
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;
    if (!repo) return;

    try {
        await ensureTaskLeaderboardsInitialized(services);
    } catch (err) {
        console.warn("[LeaderboardUpdate] Leaderboard initialisation failed:", err);
        return;
    }

    const leaderboard = await repo.getLeaderboard("periodic");
    if (!leaderboard?.period) return;

    const ranked = buildRankedPeriodicEntries(leaderboard.points);
    const topTen = ranked.slice(0, 10);
    const lines = await buildTopTenTableLines(client, services, topTen, leaderboard.tierCounts);
    const progress = await resolvePeriodicProgress(services, leaderboard.period);

    const embed = new EmbedBuilder()
        .setTitle("🏆 Current Leaderboard Standings")
        .setColor(0xa60000)
        .addFields(
            {
                name: "Current Top 10",
                value: lines.length ? lines.join("\n") : "No points recorded yet.",
            }
        )
        .setFooter({
            text: `Task events elapsed: ${progress.elapsed}/${leaderboard.period.length}`,
        });

    const channel = await resolveTaskChannel(client, services);
    if (!channel) {
        console.warn("[LeaderboardUpdate] Task channel not found for leaderboard update.");
        return;
    }

    await channel.send({ embeds: [embed] });
}

export async function postFinalLeaderboardSnapshot(
    client: Client,
    services: ServiceContainer
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;
    if (!repo) return;

    try {
        await ensureTaskLeaderboardsInitialized(services);
    } catch (err) {
        console.warn("[LeaderboardUpdate] Leaderboard initialisation failed:", err);
        return;
    }

    const leaderboard = await repo.getLeaderboard("periodic");
    if (!leaderboard?.period) return;

    const channel = await resolveTaskChannel(client, services);
    if (!channel) {
        console.warn("[LeaderboardUpdate] Task channel not found for leaderboard update.");
        return;
    }

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
        const mention = await resolveTaskUserMention(client, services);
        await sendLeaderboardEmbed(services, channel, finalEmbed, mention);
        return;
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
    const mention = await resolveTaskUserMention(client, services);
    await sendLeaderboardEmbed(services, channel, finalEmbed, mention);
}

export async function postPeriodicLeaderboardUpdate(
    client: Client,
    services: ServiceContainer
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;
    if (!repo) return;

    if (!(await isPeriodicLeaderboardEnabled(services))) {
        return;
    }

    try {
        await ensureTaskLeaderboardsInitialized(services);
    } catch (err) {
        console.warn("[LeaderboardUpdate] Leaderboard initialisation failed:", err);
        return;
    }

    const leaderboard = await repo.getLeaderboard("periodic");
    if (!leaderboard?.period) return;

    const { ready, leaderboard: latest } = await shouldFinalizePeriodicLeaderboard(services);
    const activeLeaderboard = latest ?? leaderboard;

    if (ready && latest) {
        const rankedAll = buildRankedPeriodicEntries(latest.points);
        const placements = resolvePeriodicPlacements(
            rankedAll.map((entry) => ({
                userId: entry.userId,
                points: entry.points,
            }))
        );

        await awardTaskChampionRoles(client, services, placements);

        const channel = await resolveTaskChannel(client, services);
        if (!channel) {
            console.warn("[LeaderboardUpdate] Task channel not found for leaderboard update.");
            return;
        }

        const finalTopTen = rankedAll.slice(0, 10);

        if (!latest.period) {
            console.warn("[LeaderboardUpdate] Period data missing during finalisation.");
            return;
        }

        const progress = await resolvePeriodicProgress(services, latest.period);
        const finalEmbed = await buildFinalLeaderboardEmbed(client, services, latest, placements, finalTopTen, undefined, {
            periodLabel: resolvePeriodicLabel(latest.period?.length),
            footer: {
                elapsed: progress.elapsed,
                total: progress.total,
            },
            tierCounts: latest.tierCounts ?? {},
        });
        const mention = await resolveTaskUserMention(client, services);
        await sendLeaderboardEmbed(services, channel, finalEmbed, mention);

        await notifyChampionWinners(client, services, placements);
        await finalizePeriodicLeaderboard(services, latest, placements.winners);
        return;
    }

    const ranked = buildRankedPeriodicEntries(activeLeaderboard.points);
    const topTen = ranked.slice(0, 10);
    const lines = await buildTopTenTableLines(client, services, topTen, activeLeaderboard.tierCounts);
    const progress = activeLeaderboard.period
        ? await resolvePeriodicProgress(services, activeLeaderboard.period)
        : { elapsed: 0, total: 0 };
    const progressLine = `Week ${progress.elapsed + 1} of ${activeLeaderboard.period?.length}`;

    const embed = new EmbedBuilder()
        .setTitle("🏆 Current Leaderboard Standings")
        .setColor(0xa60000)
        .addFields(
            {
                name: "Top 10",
                value: lines.length ? lines.join("\n") : "No points recorded yet.",
            },
            {
                name: "Period Progress",
                value: progressLine,
            }
        )
        .setFooter({
            text: `Task events elapsed: ${progress.elapsed}/${activeLeaderboard.period?.length ?? 0}`,
        });

    const channel = await resolveTaskChannel(client, services);
    if (!channel) {
        console.warn("[LeaderboardUpdate] Task channel not found for leaderboard update.");
        return;
    }

    await channel.send({ embeds: [embed] });
}

export async function warnPendingLeaderboardFinalization(
    client: Client,
    services: ServiceContainer
): Promise<void> {
    const taskRepo = services.repos.taskRepo;
    if (!taskRepo) return;

    if (!(await isPeriodicLeaderboardEnabled(services))) {
        return;
    }

    try {
        await ensureTaskLeaderboardsInitialized(services);
    } catch (err) {
        console.warn("[LeaderboardUpdate] Leaderboard initialisation failed:", err);
        return;
    }

    const { ready, leaderboard } = await shouldFinalizePeriodicLeaderboard(services);
    if (!ready || !leaderboard?.period) return;

    const pendingCounts = await Promise.all(
        leaderboard.period.eventIds.map(async (eventId) => {
            const submissions = await taskRepo.getSubmissionsForTask(eventId);
            return submissions.filter((submission) => submission.status === SubmissionStatus.Pending).length;
        })
    );

    const pendingTotal = pendingCounts.reduce((sum, count) => sum + count, 0);
    if (pendingTotal === 0) return;

    const guildId = services.guildId;
    if (!guildId) return;

    const guildConfig = await services.guilds.get(guildId);
    if (!guildConfig) return;

    const channelId = guildConfig.channels?.taskVerification;
    if (!channelId) return;

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;

    const adminRoleId = guildConfig.roles?.taskAdmin;
    const mention = adminRoleId ? `<@&${adminRoleId}>` : "Task Admins";
    const suppressMentions = await isMentionSuppressed(services.guilds, guildId);

    await (channel as TextChannel).send(withSuppressedMentions({
        content: `${mention} There are ${pendingTotal} pending task submissions and the periodic leaderboard will finalise in ~24 hours. Please review before the update.`
    }, suppressMentions));
}
