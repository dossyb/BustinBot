import type { Client, Guild } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import type { TaskLeaderboard, TaskLeaderboardChampions, TaskLeaderboardEntry, TaskLeaderboardId, TaskLeaderboardPendingPeriod, TaskLeaderboardPeriod, TaskTierCounts } from "../../models/TaskLeaderboard.js";
import type { TaskEvent } from "../../models/TaskEvent.js";
import { TaskCategory } from "../../models/Task.js";
import type { ITaskRepository } from "../../core/database/interfaces/ITaskRepo.js";
import type { UserStats } from "../../models/UserStats.js";
import type { SubmissionStatus } from "../../models/TaskSubmission.js";
import table from "text-table";

const TIER_POINTS = {
    bronze: 1,
    silver: 3,
    gold: 6,
};

export function getTierPoints(tier: keyof typeof TIER_POINTS): number {
    return TIER_POINTS[tier];
}

type LeaderboardTier = keyof typeof TIER_POINTS;

function isTier(status: string | undefined): status is LeaderboardTier {
    return status !== undefined && Object.hasOwn(TIER_POINTS, status);
}

export function getStatusPoints(status?: SubmissionStatus): number {
    return isTier(status) ? TIER_POINTS[status] : 0;
}

function applyTierCountDelta(
    tierCounts: Record<string, TaskTierCounts> | undefined,
    userId: string,
    tier: LeaderboardTier | null,
    previousTier: LeaderboardTier | undefined
): Record<string, TaskTierCounts> {
    const updated = structuredClone(tierCounts ?? {});
    updated[userId] ??= { bronze: 0, silver: 0, gold: 0 };

    if (previousTier) {
        updated[userId][previousTier] = Math.max(0, updated[userId][previousTier] - 1);
    }
    if (tier) updated[userId][tier] += 1;

    return updated;
}

function incrementPendingPeriodPoints(
    pendingPeriod: TaskLeaderboardPendingPeriod,
    userId: string,
    amount: number,
    tier: LeaderboardTier | null,
    previousTier: LeaderboardTier | undefined
): TaskLeaderboardPendingPeriod {
    return {
        ...pendingPeriod,
        points: {
            ...pendingPeriod.points,
            [userId]: (pendingPeriod.points[userId] ?? 0) + amount,
        },
        tierCounts: applyTierCountDelta(pendingPeriod.tierCounts, userId, tier, previousTier),
    };
}

const DEFAULT_PERIOD_EVENTS = 4;

function resolvePeriodKey(event: TaskEvent): string {
    return `start:${event.startTime.toISOString().slice(0, 10)}`;
}

export async function weekRegularEvents(taskRepo: ITaskRepository, event: TaskEvent): Promise<TaskEvent[]> {
    const week = resolvePeriodKey(event);
    return (await taskRepo.getTaskEventsBetween(event.startTime, event.endTime))
        .filter((weekEvent) => weekEvent.category !== TaskCategory.MonisChoice && resolvePeriodKey(weekEvent) === week);
}

export function holdsEveryTask(events: TaskEvent[], userId: string): boolean {
    return events.every((event) => event.completedUserIds?.includes(userId));
}

export async function eventCountsForMember(taskRepo: ITaskRepository, event: TaskEvent, userId: string): Promise<boolean> {
    return event.category !== TaskCategory.MonisChoice || !holdsEveryTask(await weekRegularEvents(taskRepo, event), userId);
}

async function loadPeriodicEvents(services: ServiceContainer, eventIds: string[]): Promise<TaskEvent[]> {
    const taskRepo = services.repos.taskRepo;

    const events = await Promise.all(eventIds.map(async (eventId) => await taskRepo.getTaskEventById(eventId)));
    return events.filter((event): event is TaskEvent => !!event);
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

    const periodEndTimes = [...Map.groupBy(events, resolvePeriodKey).values()].map((periodEvents) =>
        Math.max(...periodEvents.map((event) => event.endTime.getTime()))
    );

    const started = periodEndTimes.length;
    const elapsed = periodEndTimes.filter((endTime) => endTime <= asOf.getTime()).length;
    return { started, elapsed, total: period.length };
}

export function calculateLifetimePoints(stats: UserStats): number {
    const legacy = stats.legacyTasksCompleted ?? 0;
    const bronze = stats.tasksCompletedBronze ?? 0;
    const silver = stats.tasksCompletedSilver ?? 0;
    const gold = stats.tasksCompletedGold ?? 0;

    return legacy + bronze * TIER_POINTS.bronze + silver * TIER_POINTS.silver + gold * TIER_POINTS.gold;
}

export type RankedEntry<T> = T & { rank: number };

type LifetimeEntry = TaskLeaderboardEntry & { currentStreak: number };

function buildEntries(points: Record<string, number>): TaskLeaderboardEntry[] {
    return Object.entries(points)
        .map(([userId, value]) => ({ userId, points: Number(value) || 0 }))
        .filter((entry) => entry.points > 0);
}

export function rankPeriodicEntries(entries: TaskLeaderboardEntry[]): RankedEntry<TaskLeaderboardEntry>[] {
    const sorted = entries.toSorted((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return a.userId.localeCompare(b.userId);
    });

    return applyRanks(sorted, (entry) => `${entry.points}`);
}

export function buildRankedPeriodicEntries(points: Record<string, number>): RankedEntry<TaskLeaderboardEntry>[] {
    return rankPeriodicEntries(buildEntries(points));
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
    const guildConfig = await services.guilds.get(guildId);
    const configured = guildConfig?.taskSettings?.periodEvents;
    return configured ?? DEFAULT_PERIOD_EVENTS;
}

export async function isPeriodicLeaderboardEnabled(services: ServiceContainer): Promise<boolean> {
    const guildId = services.guildId;
    const guildConfig = await services.guilds.get(guildId);
    return guildConfig?.toggles?.taskLeaderboard ?? true;
}

export async function ensureTaskLeaderboardsInitialized(services: ServiceContainer): Promise<Record<TaskLeaderboardId, TaskLeaderboard | null>> {
    const repo = services.repos.taskLeaderboardRepo;

    const now = new Date().toISOString();
    let [lifetime, periodic] = await Promise.all([
        repo.getLeaderboard("lifetime"),
        repo.getLeaderboard("periodic"),
    ]);

    if (!lifetime) {
        const points: Record<string, number> = {};
        const userRepo = services.repos.userRepo;

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
        lifetime = payload;
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
        periodic = payload;
    } else if (!periodic.period) {
        const periodLength = await resolvePeriodLength(services);
        const update = {
            period: {
                length: periodLength,
                eventIds: [],
                startedAt: now,
                index: 1,
            },
            tierCounts: periodic.tierCounts ?? {},
            updatedAt: now,
        };
        await repo.updateLeaderboard("periodic", update);
        periodic = { ...periodic, ...update };
    }

    return { lifetime, periodic };
}

export async function incrementLifetimePoints(
    services: ServiceContainer,
    userId: string,
    amount: number
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;

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
    tier: "bronze" | "silver" | "gold" | null,
    previousStatus?: SubmissionStatus
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;
    const previousTier = isTier(previousStatus) ? previousStatus : undefined;

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
                tier,
                previousTier
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
        await repo.incrementPoints("periodic", userId, amount, {
            ...(tier && { [tier]: 1 }),
            ...(previousTier && { [previousTier]: -1 }),
        });
    } catch (err) {
        console.warn(`[TaskLeaderboards] Failed to increment periodic points for ${userId}:`, err);
    }
}

export async function registerPeriodicTaskEvent(
    services: ServiceContainer,
    taskEventId: string
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;

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

    const registeredEvents = await loadPeriodicEvents(services, [
        ...leaderboard.period.eventIds,
        taskEventId,
    ]);
    const taskEvent = registeredEvents.find((event) => event.id === taskEventId);
    const currentPeriodEvents = registeredEvents.filter((event) => event.id !== taskEventId);
    const currentPeriodKeys = new Set(
        currentPeriodEvents.map(resolvePeriodKey)
    );

    // A weekly task period contains multiple category event IDs. Once the first
    // category fills the final week, the remaining categories must stay with it.
    if (taskEvent && currentPeriodKeys.has(resolvePeriodKey(taskEvent))) {
        await repo.updateLeaderboard("periodic", {
            period: {
                ...leaderboard.period,
                eventIds: [...leaderboard.period.eventIds, taskEventId],
            },
            updatedAt: new Date().toISOString(),
        });
        return;
    }

    const uniqueCount = currentPeriodEvents.length > 0
        ? currentPeriodKeys.size
        : leaderboard.period.eventIds.length;
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
    period: TaskLeaderboardPeriod,
    asOf: Date = new Date()
): Promise<boolean> {
    const progress = await resolvePeriodicProgress(services, period, asOf);
    if (progress.started < period.length) {
        return false;
    }
    if (progress.elapsed < period.length) {
        return false;
    }

    return true;
}

export async function finalizePeriodicLeaderboard(
    services: ServiceContainer,
    leaderboard: TaskLeaderboard,
    winners: TaskLeaderboardEntry[]
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;
    if (!leaderboard.period) return;

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

const CHAMPION_PLACES = [
    { place: "first", role: "taskChampionFirst", fallbackRoleName: "Task Champion (1st)", stat: "taskChampionFirsts" },
    { place: "second", role: "taskChampionSecond", fallbackRoleName: "Task Champion (2nd)", stat: "taskChampionSeconds" },
    { place: "third", role: "taskChampionThird", fallbackRoleName: "Task Champion (3rd)", stat: "taskChampionThirds" },
] as const;

export type PeriodicPlacements = {
    first: TaskLeaderboardEntry[];
    second: TaskLeaderboardEntry[];
    third: TaskLeaderboardEntry[];
    winners: TaskLeaderboardEntry[];
};

export function resolvePeriodicPlacements(entries: TaskLeaderboardEntry[]): PeriodicPlacements {
    if (entries.length === 0) {
        return { first: [], second: [], third: [], winners: [] };
    }

    const groups: TaskLeaderboardEntry[][] = [];
    for (const entry of entries) {
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
    periodIndex: number,
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;

    const leaderboard = await repo.getLeaderboard("periodic");
    if (!leaderboard) return;

    const guildId = services.guildId;
    const guildConfig = await services.guilds.get(guildId);
    if (!guildConfig) return;

    const guild = await client.guilds.fetch(guildId);

    const championSettings = {
        first: true,
        second: true,
        third: true,
        ...(guildConfig.taskSettings?.championRoles ?? {}),
    };

    const places = CHAMPION_PLACES.map((place) => ({
        ...place,
        roleId: resolveChampionRoleId(guild, guildConfig.roles?.[place.role], place.fallbackRoleName),
        enabled: championSettings[place.place],
    }));

    const previous = leaderboard.champions ?? {};
    const normaliseIds = (value?: string[] | string | null) => {
        if (!value) return [];
        return Array.isArray(value) ? value : [value];
    };

    for (const { place, roleId } of places) {
        if (!roleId) continue;
        for (const userId of normaliseIds(previous[place])) {
            if (!userId) continue;
            try {
                const member = await guild.members.fetch(userId);
                if (member.roles.cache.has(roleId)) {
                    await member.roles.remove(roleId);
                }
            } catch (err) {
                console.warn(`[TaskLeaderboards] Failed to remove champion role from ${userId}:`, err);
            }
        }
    }

    for (const { place, roleId, enabled } of places) {
        if (!roleId || !enabled) continue;
        for (const winner of placements[place]) {
            if (!winner?.userId) continue;
            try {
                const member = await guild.members.fetch(winner.userId);
                if (!member.roles.cache.has(roleId)) {
                    await member.roles.add(roleId);
                }
            } catch (err) {
                console.warn(`[TaskLeaderboards] Failed to assign champion role to ${winner.userId}:`, err);
            }
        }
    }

    const userRepo = services.repos.userRepo;
    for (const { place, stat } of places) {
        for (const winner of placements[place]) {
            if (!winner?.userId) continue;
            try {
                await userRepo.incrementStat(winner.userId, stat, 1);
            } catch (err) {
                console.warn(`[TaskLeaderboards] Failed to update champion stats for ${winner.userId}:`, err);
            }
        }
    }

    const championsUpdate: TaskLeaderboardChampions = {
        first: placements.first.map((entry) => entry.userId),
        second: placements.second.map((entry) => entry.userId),
        third: placements.third.map((entry) => entry.userId),
        awardedAt: new Date().toISOString(),
        periodIndex,
    };

    await repo.updateLeaderboard("periodic", {
        champions: championsUpdate,
    });
}

export function resolvePeriodicLabel(events?: number): string {
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
}

export async function getUserLabel(userId: string, context?: { client?: Client; guild?: Guild | null }): Promise<string> {
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
}

export async function buildTopTenTableLines(
    entries: RankedEntry<TaskLeaderboardEntry>[],
    context?: { client?: Client; guild?: Guild | null },
    tierCounts?: Record<string, TaskTierCounts>,
    streaks?: Record<string, string>
): Promise<string[]> {
    if (entries.length === 0) return [];

    const uniqueIds = [...new Set(entries.map((entry) => entry.userId))];
    const nameEntries = await Promise.all(
        uniqueIds.map(async (userId) => [userId, await getUserLabel(userId, context)] as const)
    );
    const nameMap = new Map(nameEntries);

    const showStreak = streaks !== undefined;
    const MAX_NAME_LENGTH = showStreak ? 10 : 14;
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
        const counts = tierCounts?.[entry.userId];
        return [
            `${tiePrefix}${baseRankLabel}`,
            name,
            String(entry.points),
            String(counts?.bronze ?? 0),
            String(counts?.silver ?? 0),
            String(counts?.gold ?? 0),
            ...(streaks ? [streaks[entry.userId] ?? "0"] : []),
        ];
    });

    const header = ["Rank", "Name", "Pts", "B", "S", "G", ...(showStreak ? ["Str"] : [])];
    return ["```", table([header, ...rows], { align: ["l", "l", "r", "r", "r", "r", "r"], hsep: " " }), "```"];
}

export async function buildLeaderboardMessage(
    services: ServiceContainer,
    view: TaskLeaderboardId,
    viewerId: string,
    context?: { client?: Client; guild?: Guild | null }
): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] }> {
    const leaderboard = (await ensureTaskLeaderboardsInitialized(services))[view];

    if (!leaderboard) {
        const embed = new EmbedBuilder()
            .setTitle("Task Leaderboard")
            .setDescription("Leaderboard data is unavailable.")
            .setColor(0xa60000);
        return { embeds: [embed], components: [] };
    }

    const userRepo = services.repos.userRepo;
    const guildConfig = await services.guilds.get(services.guildId);
    const periodEvents = guildConfig?.taskSettings?.periodEvents ?? DEFAULT_PERIOD_EVENTS;

    let rankedEntries: RankedEntry<TaskLeaderboardEntry>[];
    let lines: string[];

    if (view === "lifetime") {
        const users = await userRepo.getAllUsers();
        const tierCounts: Record<string, TaskTierCounts> = {};
        const currentStreaks: Record<string, number> = {};
        const streaks: Record<string, string> = {};

        for (const stats of users) {
            const longest = stats.longestTaskStreak ?? 0;
            const current = stats.taskStreak ?? 0;
            tierCounts[stats.userId] = {
                bronze: stats.tasksCompletedBronze ?? 0,
                silver: stats.tasksCompletedSilver ?? 0,
                gold: stats.tasksCompletedGold ?? 0,
            };
            currentStreaks[stats.userId] = current;
            streaks[stats.userId] = `${longest}${longest > 0 && current === longest ? "*" : ""}`;
        }

        rankedEntries = buildRankedLifetimeEntries(leaderboard.points, currentStreaks);
        lines = await buildTopTenTableLines(rankedEntries.slice(0, 10), context, tierCounts, streaks);
    } else {
        rankedEntries = buildRankedPeriodicEntries(leaderboard.points);
        lines = await buildTopTenTableLines(rankedEntries.slice(0, 10), context, leaderboard.tierCounts);
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
        embed.setDescription("Leaderboard points are tallied from approved task submissions for the current period.");
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
