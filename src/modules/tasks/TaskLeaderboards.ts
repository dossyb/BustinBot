import type { Client, Guild } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import type { TaskLeaderboard, TaskLeaderboardChampions, TaskLeaderboardEntry, TaskLeaderboardId, TaskLeaderboardPendingPeriod, TaskLeaderboardPeriod, TaskTierCounts } from "../../models/TaskLeaderboard.js";
import type { TaskEvent } from "../../models/TaskEvent.js";
import type { UserStats } from "../../models/UserStats.js";
import { SubmissionStatus } from "../../models/TaskSubmission.js";
import { normaliseFirestoreDates } from "../../utils/DateUtils.js";

const TIER_POINTS = {
    bronze: 1,
    silver: 3,
    gold: 6,
};

export function getTierPoints(tier: keyof typeof TIER_POINTS): number {
    return TIER_POINTS[tier];
}

const STATUS_POINTS: Partial<Record<SubmissionStatus, number>> = {
    [SubmissionStatus.Bronze]: TIER_POINTS.bronze,
    [SubmissionStatus.Silver]: TIER_POINTS.silver,
    [SubmissionStatus.Gold]: TIER_POINTS.gold,
};

export function getStatusPoints(status?: SubmissionStatus): number {
    if (!status) return 0;
    return STATUS_POINTS[status] ?? 0;
}

type LeaderboardTier = keyof typeof TIER_POINTS;

function inferPreviousTierFromDelta(tier: LeaderboardTier, amount: number): LeaderboardTier | null {
    const previousPoints = TIER_POINTS[tier] - amount;
    const previous = Object.entries(TIER_POINTS).find(([, points]) => points === previousPoints);
    return (previous?.[0] as LeaderboardTier | undefined) ?? null;
}

function applyTierCountDelta(
    tierCounts: Record<string, TaskTierCounts> | undefined,
    userId: string,
    tier: LeaderboardTier,
    amount: number
): Record<string, TaskTierCounts> {
    const updated = structuredClone(tierCounts ?? {});
    updated[userId] ??= { bronze: 0, silver: 0, gold: 0 };

    const previousTier = inferPreviousTierFromDelta(tier, amount);
    if (previousTier) {
        updated[userId][previousTier] = Math.max(0, updated[userId][previousTier] - 1);
    }
    updated[userId][tier] += 1;

    return updated;
}

function incrementPendingPeriodPoints(
    pendingPeriod: TaskLeaderboardPendingPeriod,
    userId: string,
    amount: number,
    tier: LeaderboardTier
): TaskLeaderboardPendingPeriod {
    return {
        ...pendingPeriod,
        points: {
            ...pendingPeriod.points,
            [userId]: (pendingPeriod.points[userId] ?? 0) + amount,
        },
        tierCounts: applyTierCountDelta(pendingPeriod.tierCounts, userId, tier, amount),
    };
}

const DEFAULT_PERIOD_EVENTS = 4;

function resolvePeriodKey(event: TaskEvent): string {
    if (event.startTime instanceof Date) return `start:${event.startTime.toISOString().slice(0, 10)}`;
    const keyword = event.keyword?.trim().toLowerCase();
    if (keyword) return `kw:${keyword}`;
    if (event.endTime instanceof Date) return `end:${event.endTime.toISOString().slice(0, 10)}`;
    return `id:${event.id}`;
}

async function loadPeriodicEvents(services: ServiceContainer, eventIds: string[]): Promise<TaskEvent[]> {
    const taskRepo = services.repos.taskRepo;
    if (!taskRepo) return [];

    const events = await Promise.all(eventIds.map(async (eventId) => await taskRepo.getTaskEventById(eventId)));
    return events.filter((event): event is TaskEvent => !!event).map((event) => normaliseFirestoreDates(event));
}

export async function getUniquePeriodCount(
    services: ServiceContainer,
    eventIds: string[]
): Promise<number> {
    const events = await loadPeriodicEvents(services, eventIds);
    if (events.length === 0) {
        return eventIds.length;
    }

    const keys = new Set<string>();
    for (const event of events) {
        keys.add(resolvePeriodKey(event));
    }
    return keys.size;
}

export async function resolvePeriodicProgress(
    services: ServiceContainer,
    period: TaskLeaderboardPeriod,
    asOf: Date = new Date()
): Promise<{ started: number; elapsed: number; total: number }> {
    const events = await loadPeriodicEvents(services, period.eventIds);
    if (events.length === 0) {
        const started = period.eventIds.length;
        return { started, elapsed: started, total: period.length };
    }

    const periodEndTimes = new Map<string, number>();
    for (const event of events) {
        const key = resolvePeriodKey(event);
        const endTime = event.endTime instanceof Date ? event.endTime.getTime() : null;
        if (endTime === null) continue;
        const existing = periodEndTimes.get(key);
        if (existing === undefined || endTime > existing) {
            periodEndTimes.set(key, endTime);
        }
    }

    const started = periodEndTimes.size;
    const elapsed = [...periodEndTimes.values()].filter((endTime) => endTime <= asOf.getTime()).length;
    return { started, elapsed, total: period.length };
}

export function calculateLifetimePoints(stats: UserStats): number {
    const legacy = stats.legacyTasksCompleted ?? 0;
    const bronze = stats.tasksCompletedBronze ?? 0;
    const silver = stats.tasksCompletedSilver ?? 0;
    const gold = stats.tasksCompletedGold ?? 0;

    return legacy + bronze * TIER_POINTS.bronze + silver * TIER_POINTS.silver + gold * TIER_POINTS.gold;
}

type RankedEntry<T> = T & { rank: number };

type LifetimeEntry = TaskLeaderboardEntry & { currentStreak: number };

function buildEntries(points: Record<string, number>): TaskLeaderboardEntry[] {
    return Object.entries(points)
        .map(([userId, value]) => ({ userId, points: Number(value) || 0 }))
        .filter((entry) => entry.points > 0);
}

export function buildRankedPeriodicEntries(points: Record<string, number>): RankedEntry<TaskLeaderboardEntry>[] {
    const sorted = buildEntries(points).sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return a.userId.localeCompare(b.userId);
    });

    return applyRanks(sorted, (entry) => `${entry.points}`);
}

export function buildRankedLifetimeEntries(
    points: Record<string, number>,
    streaks: Record<string, number>
): RankedEntry<LifetimeEntry>[] {
    const entries = buildEntries(points).map((entry) => ({
        ...entry,
        currentStreak: streaks[entry.userId] ?? 0,
    }));

    const sorted = entries.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.currentStreak !== a.currentStreak) return b.currentStreak - a.currentStreak;
        return a.userId.localeCompare(b.userId);
    });

    return applyRanks(sorted, (entry) => `${entry.points}|${entry.currentStreak}`);
}

function applyRanks<T extends { points: number }>(
    entries: T[],
    tieKey: (entry: T) => string
): RankedEntry<T>[] {
    let currentRank = 0;
    let lastKey: string | null = null;

    return entries.map((entry, index) => {
        const key = tieKey(entry);
        if (key !== lastKey) {
            currentRank = index + 1;
            lastKey = key;
        }
        return { ...entry, rank: currentRank };
    });
}

export function getRankFromEntries<T extends { userId: string; rank: number }>(
    entries: T[],
    userId: string
): number | null {
    const entry = entries.find((candidate) => candidate.userId === userId);
    return entry?.rank ?? null;
}

async function resolvePeriodLength(services: ServiceContainer): Promise<number> {
    const guildId = services.guildId;
    const guildConfig = guildId ? await services.guilds.get(guildId) : null;
    const configured = guildConfig?.taskSettings?.periodEvents;
    return configured ?? DEFAULT_PERIOD_EVENTS;
}

export async function isPeriodicLeaderboardEnabled(services: ServiceContainer): Promise<boolean> {
    const guildId = services.guildId;
    const guildConfig = guildId ? await services.guilds.get(guildId) : null;
    return guildConfig?.toggles?.taskLeaderboard ?? true;
}

export async function ensureTaskLeaderboardsInitialized(services: ServiceContainer): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;
    if (!repo) return;

    const now = new Date().toISOString();
    const [lifetime, periodic] = await Promise.all([
        repo.getLeaderboard("lifetime"),
        repo.getLeaderboard("periodic"),
    ]);

    if (!lifetime) {
        const points: Record<string, number> = {};
        const userRepo = services.repos.userRepo;
        if (!userRepo) {
            throw new Error("Leaderboard initialisation failed. Please use /reportbug if it continues.");
        }

        const users = await userRepo.getAllUsers();
        for (const stats of users) {
            const total = calculateLifetimePoints(stats);
            if (total > 0) points[stats.userId] = total;
        }

        const payload: TaskLeaderboard = {
            id: "lifetime",
            points,
            createdAt: now,
            updatedAt: now,
        };

        await repo.createLeaderboard(payload);
    }

    if (!periodic) {
        const periodLength = await resolvePeriodLength(services);
        const payload: TaskLeaderboard = {
            id: "periodic",
            points: {},
            tierCounts: {},
            createdAt: now,
            updatedAt: now,
            period: {
                length: periodLength,
                eventIds: [],
                startedAt: now,
                index: 1,
            },
        };
        await repo.createLeaderboard(payload);
    } else if (!periodic.period) {
        const periodLength = await resolvePeriodLength(services);
        await repo.updateLeaderboard("periodic", {
            period: {
                length: periodLength,
                eventIds: [],
                startedAt: now,
                index: 1,
            },
            tierCounts: periodic.tierCounts ?? {},
            updatedAt: now,
        });
    }
}

export async function incrementLifetimePoints(
    services: ServiceContainer,
    userId: string,
    amount: number
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;
    if (!repo) return;

    const leaderboard = await repo.getLeaderboard("lifetime");
    if (!leaderboard) {
        try {
            await ensureTaskLeaderboardsInitialized(services);
        } catch (err) {
            console.warn("[TaskLeaderboards] Leaderboard initialisation failed:", err);
            return;
        }
    }

    try {
        await repo.incrementPoints("lifetime", userId, amount);
    } catch (err) {
        console.warn(`[TaskLeaderboards] Failed to increment lifetime points for ${userId}:`, err);
    }
}

export async function incrementPeriodicPoints(
    services: ServiceContainer,
    userId: string,
    amount: number,
    taskEventId: string,
    tier: "bronze" | "silver" | "gold"
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;
    if (!repo) return;

    let leaderboard = await repo.getLeaderboard("periodic");
    if (!leaderboard) {
        try {
            await ensureTaskLeaderboardsInitialized(services);
            leaderboard = await repo.getLeaderboard("periodic");
        } catch (err) {
            console.warn("[TaskLeaderboards] Leaderboard initialisation failed:", err);
            return;
        }
    }

    const period = leaderboard?.period;
    if (!period) return;

    if (!period.eventIds.includes(taskEventId)) {
        if (leaderboard?.pendingPeriod?.period.eventIds.includes(taskEventId)) {
            const pendingPeriod = incrementPendingPeriodPoints(
                leaderboard.pendingPeriod,
                userId,
                amount,
                tier
            );
            try {
                await repo.updateLeaderboard("periodic", {
                    pendingPeriod,
                    updatedAt: new Date().toISOString(),
                });
            } catch (err) {
                console.warn(`[TaskLeaderboards] Failed to increment pending periodic points for ${userId}:`, err);
            }
        }
        return;
    }

    try {
        await repo.incrementPoints("periodic", userId, amount);
        const previousTier = inferPreviousTierFromDelta(tier, amount);
        if (previousTier) {
            await repo.incrementTierCount("periodic", userId, previousTier, -1);
        }
        await repo.incrementTierCount("periodic", userId, tier, 1);
    } catch (err) {
        console.warn(`[TaskLeaderboards] Failed to increment periodic points for ${userId}:`, err);
    }
}

export async function registerPeriodicTaskEvent(
    services: ServiceContainer,
    taskEventId: string
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;
    if (!repo) return;

    let leaderboard = await repo.getLeaderboard("periodic");
    if (!leaderboard) {
        try {
            await ensureTaskLeaderboardsInitialized(services);
            leaderboard = await repo.getLeaderboard("periodic");
        } catch (err) {
            console.warn("[TaskLeaderboards] Leaderboard initialisation failed:", err);
            return;
        }
    }

    if (!leaderboard?.period) return;

    if (leaderboard.period.eventIds.includes(taskEventId)) return;

    const uniqueCount = await getUniquePeriodCount(services, leaderboard.period.eventIds);
    if (uniqueCount >= leaderboard.period.length) {
        const nextIndex = leaderboard.period.index + 1;
        const pendingPeriod = leaderboard.pendingPeriod ?? {
            period: {
                length: await resolvePeriodLength(services),
                eventIds: [],
                startedAt: new Date().toISOString(),
                index: nextIndex,
            },
            points: {},
            tierCounts: {},
        };

        if (pendingPeriod.period.eventIds.includes(taskEventId)) return;

        await repo.updateLeaderboard("periodic", {
            pendingPeriod: {
                ...pendingPeriod,
                period: {
                    ...pendingPeriod.period,
                    eventIds: [...pendingPeriod.period.eventIds, taskEventId],
                },
            },
            updatedAt: new Date().toISOString(),
        });
        return;
    }

    const updatedIds = [...leaderboard.period.eventIds, taskEventId];
    const updatedPeriod = {
        ...leaderboard.period,
        eventIds: updatedIds,
    };

    await repo.updateLeaderboard("periodic", {
        period: updatedPeriod,
        updatedAt: new Date().toISOString(),
    });
}

export async function getPeriodicLeaderboardTopEntries(
    services: ServiceContainer,
    limit = 5
): Promise<TaskLeaderboardEntry[]> {
    const repo = services.repos.taskLeaderboardRepo;
    if (!repo) return [];

    let leaderboard = await repo.getLeaderboard("periodic");
    if (!leaderboard) {
        try {
            await ensureTaskLeaderboardsInitialized(services);
            leaderboard = await repo.getLeaderboard("periodic");
        } catch (err) {
            console.warn("[TaskLeaderboards] Leaderboard initialisation failed:", err);
            return [];
        }
    }
    if (!leaderboard) return [];

    return buildRankedPeriodicEntries(leaderboard.points)
        .slice(0, limit)
        .map((entry) => ({ userId: entry.userId, points: entry.points }));
}

export async function shouldFinalizePeriodicLeaderboard(
    services: ServiceContainer,
    asOf: Date = new Date()
): Promise<{ ready: boolean; leaderboard?: TaskLeaderboard }> {
    const repo = services.repos.taskLeaderboardRepo;
    const taskRepo = services.repos.taskRepo;
    if (!repo || !taskRepo) return { ready: false };

    const leaderboard = await repo.getLeaderboard("periodic");
    if (!leaderboard?.period) return { ready: false };

    const progress = await resolvePeriodicProgress(services, leaderboard.period, asOf);
    if (progress.started < leaderboard.period.length) {
        return { ready: false, leaderboard };
    }
    if (progress.elapsed < leaderboard.period.length) {
        return { ready: false, leaderboard };
    }

    return { ready: true, leaderboard };
}

export async function finalizePeriodicLeaderboard(
    services: ServiceContainer,
    leaderboard: TaskLeaderboard,
    winners: TaskLeaderboardEntry[]
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;
    if (!repo || !leaderboard.period) return;

    const now = new Date().toISOString();
    const nextIndex = leaderboard.period.index + 1;
    const nextLength = await resolvePeriodLength(services);
    const finalTopTen = buildRankedPeriodicEntries(leaderboard.points)
        .slice(0, 10)
        .map((entry) => ({ userId: entry.userId, points: entry.points }));

    const pendingPeriod = leaderboard.pendingPeriod;

    await repo.updateLeaderboard("periodic", {
        completedPeriod: {
            index: leaderboard.period.index,
            eventIds: leaderboard.period.eventIds,
            endedAt: now,
            topThree: winners,
            topTen: finalTopTen,
            tierCounts: leaderboard.tierCounts ?? {},
        },
        period: {
            ...leaderboard.period,
            eventIds: pendingPeriod?.period.eventIds ?? [],
            startedAt: pendingPeriod?.period.startedAt ?? now,
            index: nextIndex,
            length: pendingPeriod?.period.length ?? nextLength,
        },
        points: pendingPeriod?.points ?? {},
        tierCounts: pendingPeriod?.tierCounts ?? {},
        pendingPeriod: null,
        updatedAt: now,
    });
}

export async function resetPeriodicLeaderboard(services: ServiceContainer): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;
    if (!repo) return;

    await ensureTaskLeaderboardsInitialized(services);
    const leaderboard = await repo.getLeaderboard("periodic");
    if (!leaderboard) return;

    const now = new Date().toISOString();
    const periodLength = await resolvePeriodLength(services);
    const periodIndex = leaderboard.period?.index ?? 1;

    await repo.updateLeaderboard("periodic", {
        points: {},
        period: {
            length: periodLength,
            eventIds: [],
            startedAt: now,
            index: periodIndex,
        },
        tierCounts: {},
        updatedAt: now,
    });
}

function resolveChampionRoleId(
    guild: Guild,
    configuredId: string | undefined,
    fallbackName: string
): string | null {
    if (configuredId) return configuredId;
    const role = guild.roles.cache.find((candidate) => candidate.name === fallbackName);
    if (!role) return null;
    return role.id;
}

export type PeriodicPlacements = {
    first: TaskLeaderboardEntry[];
    second: TaskLeaderboardEntry[];
    third: TaskLeaderboardEntry[];
    winners: TaskLeaderboardEntry[];
};

export function resolvePeriodicPlacements(entries: TaskLeaderboardEntry[]): PeriodicPlacements {
    const sorted = [...entries].sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return a.userId.localeCompare(b.userId);
    });

    if (sorted.length === 0) {
        return { first: [], second: [], third: [], winners: [] };
    }

    const groups: TaskLeaderboardEntry[][] = [];
    for (const entry of sorted) {
        const lastGroup = groups[groups.length - 1];
        if (!lastGroup || lastGroup[0]?.points !== entry.points) {
            groups.push([entry]);
        } else {
            lastGroup.push(entry);
        }
    }

    const first = groups[0] ?? [];
    let second: TaskLeaderboardEntry[] = [];
    let third: TaskLeaderboardEntry[] = [];

    if (first.length >= 3) {
        second = [];
        third = [];
    } else if (first.length === 2) {
        second = [];
        third = groups[1] ?? [];
    } else {
        second = groups[1] ?? [];
        if (second.length >= 2) {
            third = [];
        } else {
            third = groups[2] ?? [];
        }
    }

    return {
        first,
        second,
        third,
        winners: [...first, ...second, ...third],
    };
}

export async function awardTaskChampionRoles(
    client: Client,
    services: ServiceContainer,
    placements: PeriodicPlacements,
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;
    if (!repo) return;

    const leaderboard = await repo.getLeaderboard("periodic");
    if (!leaderboard) return;

    const guildId = services.guildId;
    const guildConfig = guildId ? await services.guilds.get(guildId) : null;
    if (!guildId || !guildConfig) return;

    const guild = await client.guilds.fetch(guildId);

    const championSettings = {
        first: true,
        second: true,
        third: true,
        ...(guildConfig.taskSettings?.championRoles ?? {}),
    };

    const resolvedRoleIds = {
        first: resolveChampionRoleId(guild, guildConfig.roles?.taskChampionFirst, "Task Champion (1st)"),
        second: resolveChampionRoleId(guild, guildConfig.roles?.taskChampionSecond, "Task Champion (2nd)"),
        third: resolveChampionRoleId(guild, guildConfig.roles?.taskChampionThird, "Task Champion (3rd)"),
    };

    const previous = leaderboard.champions ?? {};
    const normaliseIds = (value?: string[] | string | null) => {
        if (!value) return [];
        return Array.isArray(value) ? value : [value];
    };

    const toRemove = [
        { roleId: resolvedRoleIds.first, userIds: normaliseIds(previous.first) },
        { roleId: resolvedRoleIds.second, userIds: normaliseIds(previous.second) },
        { roleId: resolvedRoleIds.third, userIds: normaliseIds(previous.third) },
    ];

    for (const entry of toRemove) {
        if (!entry.roleId) continue;
        for (const userId of entry.userIds) {
            if (!userId) continue;
            try {
                const member = await guild.members.fetch(userId);
                if (member.roles.cache.has(entry.roleId)) {
                    await member.roles.remove(entry.roleId);
                }
            } catch (err) {
                console.warn(`[TaskLeaderboards] Failed to remove champion role from ${userId}:`, err);
            }
        }
    }

    const roleAssignments = [
        { rank: "first", roleId: resolvedRoleIds.first, winners: placements.first, enabled: championSettings.first },
        { rank: "second", roleId: resolvedRoleIds.second, winners: placements.second, enabled: championSettings.second },
        { rank: "third", roleId: resolvedRoleIds.third, winners: placements.third, enabled: championSettings.third },
    ] as const;

    for (const assignment of roleAssignments) {
        if (!assignment.roleId || !assignment.enabled) continue;
        for (const winner of assignment.winners) {
            if (!winner?.userId) continue;
            try {
                const member = await guild.members.fetch(winner.userId);
                if (!member.roles.cache.has(assignment.roleId)) {
                    await member.roles.add(assignment.roleId);
                }
            } catch (err) {
                console.warn(`[TaskLeaderboards] Failed to assign champion role to ${winner.userId}:`, err);
            }
        }
    }

    const userRepo = services.repos.userRepo;
    if (userRepo) {
        for (const assignment of roleAssignments) {
            for (const winner of assignment.winners) {
                if (!winner?.userId) continue;
                try {
                    switch (assignment.rank) {
                        case "first":
                            await userRepo.incrementStat(winner.userId, "taskChampionFirsts", 1);
                            break;
                        case "second":
                            await userRepo.incrementStat(winner.userId, "taskChampionSeconds", 1);
                            break;
                        case "third":
                            await userRepo.incrementStat(winner.userId, "taskChampionThirds", 1);
                            break;
                    }
                } catch (err) {
                    console.warn(`[TaskLeaderboards] Failed to update champion stats for ${winner.userId}:`, err);
                }
            }
        }
    }

    const championsUpdate: TaskLeaderboardChampions = {
        first: placements.first.map((entry) => entry.userId),
        second: placements.second.map((entry) => entry.userId),
        third: placements.third.map((entry) => entry.userId),
        awardedAt: new Date().toISOString(),
    };

    if (leaderboard.period?.index !== undefined) {
        championsUpdate.periodIndex = leaderboard.period.index;
    }

    await repo.updateLeaderboard("periodic", {
        champions: championsUpdate,
    });
}

export async function buildLeaderboardMessage(
    services: ServiceContainer,
    view: TaskLeaderboardId,
    viewerId: string,
    context?: { client?: Client; guild?: Guild | null }
): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] }> {
    const repo = services.repos.taskLeaderboardRepo;
    if (!repo) {
        const embed = new EmbedBuilder()
            .setTitle("Task Leaderboard")
            .setDescription("Leaderboard data is unavailable.")
            .setColor(0xa60000);
        return {
            embeds: [embed],
            components: [],
        };
    }

    await ensureTaskLeaderboardsInitialized(services);
    const leaderboard = await repo.getLeaderboard(view);

    if (!leaderboard) {
        const embed = new EmbedBuilder()
            .setTitle("Task Leaderboard")
            .setDescription("Leaderboard data is unavailable.")
            .setColor(0xa60000);
        return { embeds: [embed], components: [] };
    }

    const userRepo = services.repos.userRepo;
    const guildConfig = services.guildId ? await services.guilds.get(services.guildId) : null;

    const periodEvents = guildConfig?.taskSettings?.periodEvents ?? DEFAULT_PERIOD_EVENTS;
    const resolvePeriodicLabel = (events?: number): string => {
        switch (events) {
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
    };

    const getUserLabel = async (userId: string): Promise<string> => {
        const safeFallback = userId;
        if (context?.guild) {
            try {
                const member = await context.guild.members.fetch(userId);
                const displayName = member?.displayName ?? member?.user?.username;
                if (displayName) return displayName.replace(/`/g, "'");
            } catch (err) {
                // Ignore and fall back
            }
        }

        if (context?.client) {
            try {
                const user = await context.client.users.fetch(userId);
                if (user?.username) return user.username.replace(/`/g, "'");
            } catch (err) {
                // Ignore and fall back
            }
        }

        return safeFallback.replace(/`/g, "'");
    };
    let lines: string[] = [];
    let rankedEntries: Array<{ userId: string; points: number; rank: number }> = [];
    let statsMap = new Map<string, UserStats>();
    let topEntries: Array<{
        userId: string;
        points: number;
        rank: number;
        streak: string;
        bronze: number;
        silver: number;
        gold: number;
    }> = [];

    if (view === "lifetime") {
        if (!userRepo) {
            throw new Error("Leaderboard initialisation failed. Please use /reportbug if it continues.");
        }

        const users = await userRepo.getAllUsers();
        const streaks: Record<string, number> = {};
        statsMap = new Map<string, UserStats>();

        for (const stats of users) {
            streaks[stats.userId] = stats.taskStreak ?? 0;
            statsMap.set(stats.userId, stats);
        }

        const rankedLifetime = buildRankedLifetimeEntries(leaderboard.points, streaks);
        rankedEntries = rankedLifetime.map(({ userId, points, rank }) => ({ userId, points, rank }));

        topEntries = rankedLifetime.slice(0, 10).map((entry) => {
            const stats = statsMap.get(entry.userId);
            const longest = stats?.longestTaskStreak ?? 0;
            const current = stats?.taskStreak ?? 0;
            const streakMark = longest > 0 && current === longest ? "*" : "";
            return {
                userId: entry.userId,
                points: entry.points,
                rank: entry.rank,
                streak: `${longest}${streakMark}`,
                bronze: stats?.tasksCompletedBronze ?? 0,
                silver: stats?.tasksCompletedSilver ?? 0,
                gold: stats?.tasksCompletedGold ?? 0,
            };
        });
    } else {
        const rankedPeriodic = buildRankedPeriodicEntries(leaderboard.points);
        rankedEntries = rankedPeriodic.map(({ userId, points, rank }) => ({ userId, points, rank }));
        topEntries = rankedPeriodic.slice(0, 10).map((entry) => ({
            userId: entry.userId,
            points: entry.points,
            rank: entry.rank,
            streak: "-",
            bronze: leaderboard.tierCounts?.[entry.userId]?.bronze ?? 0,
            silver: leaderboard.tierCounts?.[entry.userId]?.silver ?? 0,
            gold: leaderboard.tierCounts?.[entry.userId]?.gold ?? 0,
        }));
    }

    const uniqueIds = [...new Set(topEntries.map((entry) => entry.userId))];
    const nameEntries = await Promise.all(
        uniqueIds.map(async (userId) => [userId, await getUserLabel(userId)] as const)
    );
    const nameMap = new Map(nameEntries);

    const MAX_NAME_LENGTH = 18;
    const rankCounts = new Map<number, number>();
    for (const entry of topEntries) {
        rankCounts.set(entry.rank, (rankCounts.get(entry.rank) ?? 0) + 1);
    }

    const formattedRows = topEntries.map((entry, index) => {
        const rawName = nameMap.get(entry.userId) ?? entry.userId;
        const name =
            rawName.length > MAX_NAME_LENGTH ? `${rawName.slice(0, MAX_NAME_LENGTH - 3)}...` : rawName;
        const baseRankLabel =
            entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : `${entry.rank}.`;
        const tiePrefix = (rankCounts.get(entry.rank) ?? 0) > 1 ? "=" : "";
        const rankLabel = `${tiePrefix}${baseRankLabel}`;
        return {
            rankLabel,
            name,
            points: String(entry.points),
            bronze: String(entry.bronze),
            silver: String(entry.silver),
            gold: String(entry.gold),
            streak: entry.streak,
        };
    });

    const showStreak = view === "lifetime";
    if (formattedRows.length > 0) {
        const rankWidth = Math.max("Rank".length, ...formattedRows.map((row) => row.rankLabel.length));
        const nameWidth = Math.max("Name".length, ...formattedRows.map((row) => row.name.length));
        const pointsWidth = Math.max("Pts".length, ...formattedRows.map((row) => row.points.length));
        const bronzeWidth = Math.max("B".length, ...formattedRows.map((row) => row.bronze.length));
        const silverWidth = Math.max("S".length, ...formattedRows.map((row) => row.silver.length));
        const goldWidth = Math.max("G".length, ...formattedRows.map((row) => row.gold.length));
        if (showStreak) {
            const streakWidth = Math.max("Streak".length, ...formattedRows.map((row) => row.streak.length));
            const header = `${"Rank".padEnd(rankWidth)}  ${"Name".padEnd(nameWidth)}  ${"Pts".padStart(pointsWidth)}  ${"B".padStart(bronzeWidth)}  ${"S".padStart(silverWidth)}  ${"G".padStart(goldWidth)}  ${"Streak".padStart(streakWidth)}`;
            const rows = formattedRows.map((row) =>
                `${row.rankLabel.padEnd(rankWidth)}  ${row.name.padEnd(nameWidth)}  ${row.points.padStart(pointsWidth)}  ${row.bronze.padStart(bronzeWidth)}  ${row.silver.padStart(silverWidth)}  ${row.gold.padStart(goldWidth)}  ${row.streak.padStart(streakWidth)}`
            );
            lines = ["```", header, ...rows, "```"];
        } else {
            const header = `${"Rank".padEnd(rankWidth)}  ${"Name".padEnd(nameWidth)}  ${"Pts".padStart(pointsWidth)}  ${"B".padStart(bronzeWidth)}  ${"S".padStart(silverWidth)}  ${"G".padStart(goldWidth)}`;
            const rows = formattedRows.map((row) =>
                `${row.rankLabel.padEnd(rankWidth)}  ${row.name.padEnd(nameWidth)}  ${row.points.padStart(pointsWidth)}  ${row.bronze.padStart(bronzeWidth)}  ${row.silver.padStart(silverWidth)}  ${row.gold.padStart(goldWidth)}`
            );
            lines = ["```", header, ...rows, "```"];
        }
    }

    const rank = getRankFromEntries(rankedEntries, viewerId);
    const viewerPoints = leaderboard.points[viewerId] ?? 0;
    const rankLabel = rank ? `#${rank}` : "Unranked";
    const periodicLabel = resolvePeriodicLabel(
        view === "periodic" ? leaderboard.period?.length ?? periodEvents : periodEvents
    );
    const viewLabel = view === "lifetime" ? "All Time" : periodicLabel;
    const periodicProgress =
        view === "periodic" && leaderboard.period
            ? await resolvePeriodicProgress(services, leaderboard.period)
            : null;

    const embed = new EmbedBuilder()
        .setTitle(`🏆 Task Leaderboard - ${viewLabel} 🏆`)
        .setColor(0xa60000)
        .addFields(
            {
                name: "Top 10",
                value: lines.length ? lines.join("\n") : "No points recorded yet.",
            },
            {
                name: "Your Rank",
                value: `${rankLabel} - ${viewerPoints} pts`,
            }
        );

    if (view === "periodic" && leaderboard.period) {
        embed.setFooter({
            text: `Task events elapsed: ${periodicProgress?.elapsed ?? 0}/${leaderboard.period.length}`,
        });
    } else if (view === "lifetime") {
        embed.setFooter({ text: "Longest streaks are displayed. Any streak with an * indicates this streak is active." });
    }

    const lifetimeButton = new ButtonBuilder()
        .setCustomId("task-leaderboard|lifetime")
        .setLabel("All Time")
        .setStyle(view === "lifetime" ? ButtonStyle.Primary : ButtonStyle.Secondary);

    const periodicButton = new ButtonBuilder()
        .setCustomId("task-leaderboard|periodic")
        .setLabel(periodicLabel)
        .setStyle(view === "periodic" ? ButtonStyle.Primary : ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        lifetimeButton,
        periodicButton
    );

    return {
        embeds: [embed],
        components: [row],
    };
}
