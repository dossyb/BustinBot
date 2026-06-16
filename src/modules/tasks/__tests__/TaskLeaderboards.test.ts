import { describe, expect, it, vi } from "vitest";
import {
    buildRankedLifetimeEntries,
    buildRankedPeriodicEntries,
    resolvePeriodicPlacements,
    ensureTaskLeaderboardsInitialized,
    finalizePeriodicLeaderboard,
    incrementPeriodicPoints,
    registerPeriodicTaskEvent,
} from "../TaskLeaderboards.js";
import type { TaskLeaderboard } from "../../../models/TaskLeaderboard.js";
import type { TaskEvent } from "../../../models/TaskEvent.js";

function createLeaderboardRepo(initial?: TaskLeaderboard) {
    let leaderboard = initial;

    const repo = {
        getLeaderboard: vi.fn(async () => leaderboard ?? null),
        createLeaderboard: vi.fn(async (data: TaskLeaderboard) => {
            leaderboard = structuredClone(data);
        }),
        updateLeaderboard: vi.fn(async (_id: string, data: Partial<TaskLeaderboard>) => {
            if (!leaderboard) return;
            leaderboard = {
                ...leaderboard,
                ...structuredClone(data),
                period: data.period ? structuredClone(data.period) : leaderboard.period,
                completedPeriod: data.completedPeriod
                    ? structuredClone(data.completedPeriod)
                    : leaderboard.completedPeriod,
                pendingPeriod: data.pendingPeriod !== undefined
                    ? structuredClone(data.pendingPeriod)
                    : leaderboard.pendingPeriod,
                points: data.points ? structuredClone(data.points) : leaderboard.points,
                tierCounts: data.tierCounts ? structuredClone(data.tierCounts) : leaderboard.tierCounts,
            };
        }),
        incrementPoints: vi.fn(async (_id: string, userId: string, amount: number) => {
            if (!leaderboard) return;
            leaderboard.points[userId] = (leaderboard.points[userId] ?? 0) + amount;
        }),
        incrementTierCount: vi.fn(async (
            _id: string,
            userId: string,
            tier: "bronze" | "silver" | "gold",
            amount: number
        ) => {
            if (!leaderboard) return;
            leaderboard.tierCounts ??= {};
            leaderboard.tierCounts[userId] ??= { bronze: 0, silver: 0, gold: 0 };
            leaderboard.tierCounts[userId][tier] += amount;
        }),
        current: () => leaderboard,
    };

    return repo;
}

function createEvent(id: string, start: string, end: string): TaskEvent {
    return {
        id,
        task: { name: id } as any,
        startTime: new Date(start),
        endTime: new Date(end),
        keyword: id,
        completedUserIds: [],
    } as TaskEvent;
}

function createServices(taskLeaderboardRepo: ReturnType<typeof createLeaderboardRepo>, events: TaskEvent[]) {
    const eventsById = new Map(events.map((event) => [event.id, event]));
    return {
        guildId: "guild-1",
        guilds: {
            get: vi.fn().mockResolvedValue({ taskSettings: { periodEvents: 4 } }),
        },
        repos: {
            taskLeaderboardRepo,
            taskRepo: {
                getTaskEventById: vi.fn(async (id: string) => eventsById.get(id) ?? null),
            },
            userRepo: {
                getAllUsers: vi.fn().mockResolvedValue([]),
            },
        },
    };
}

describe("TaskLeaderboards ranking", () => {
    it("orders lifetime leaderboard by points then current streak", () => {
        const points = { alice: 10, bob: 10, carol: 8 };
        const streaks = { alice: 2, bob: 5, carol: 1 };

        const ranked = buildRankedLifetimeEntries(points, streaks);
        expect(ranked[0]?.userId).toBe("bob");
        expect(ranked[0]?.rank).toBe(1);
        expect(ranked[1]?.userId).toBe("alice");
        expect(ranked[1]?.rank).toBe(2);
    });

    it("assigns equal ranks when points and streak are tied", () => {
        const points = { alice: 10, bob: 10 };
        const streaks = { alice: 3, bob: 3 };

        const ranked = buildRankedLifetimeEntries(points, streaks);
        expect(ranked[0]?.rank).toBe(1);
        expect(ranked[1]?.rank).toBe(1);
    });

    it("assigns equal ranks for periodic ties", () => {
        const points = { alice: 10, bob: 10, carol: 8 };
        const ranked = buildRankedPeriodicEntries(points);

        expect(ranked[0]?.rank).toBe(1);
        expect(ranked[1]?.rank).toBe(1);
        expect(ranked[2]?.rank).toBe(3);
    });
});

describe("TaskLeaderboards placements", () => {
    it("skips second place when there is a tie for first", () => {
        const placements = resolvePeriodicPlacements([
            { userId: "a", points: 10 },
            { userId: "b", points: 10 },
            { userId: "c", points: 8 },
        ]);

        expect(placements.first.map((entry) => entry.userId)).toEqual(["a", "b"]);
        expect(placements.second).toHaveLength(0);
        expect(placements.third.map((entry) => entry.userId)).toEqual(["c"]);
    });

    it("skips third place when there is a tie for second", () => {
        const placements = resolvePeriodicPlacements([
            { userId: "a", points: 12 },
            { userId: "b", points: 9 },
            { userId: "c", points: 9 },
            { userId: "d", points: 7 },
        ]);

        expect(placements.first.map((entry) => entry.userId)).toEqual(["a"]);
        expect(placements.second.map((entry) => entry.userId)).toEqual(["b", "c"]);
        expect(placements.third).toHaveLength(0);
    });
});

describe("TaskLeaderboards initialisation", () => {
    it("throws when user stats are unavailable", async () => {
        const taskLeaderboardRepo = {
            getLeaderboard: vi.fn().mockResolvedValue(null),
            createLeaderboard: vi.fn(),
            updateLeaderboard: vi.fn(),
        };

        const services = {
            guildId: "guild-1",
            guilds: { get: vi.fn().mockResolvedValue({ taskSettings: { periodEvents: 4 } }) },
            repos: { taskLeaderboardRepo },
        };

        await expect(
            ensureTaskLeaderboardsInitialized(services as any)
        ).rejects.toThrow("Leaderboard initialisation failed");
    });
});

describe("TaskLeaderboards periodic submissions", () => {
    it("carries approved submissions from the 48-hour overlap into the following monthly leaderboard", async () => {
        const events = [
            createEvent("week-1", "2026-01-05T00:00:00.000Z", "2026-01-12T00:00:00.000Z"),
            createEvent("week-2", "2026-01-12T00:00:00.000Z", "2026-01-19T00:00:00.000Z"),
            createEvent("week-3", "2026-01-19T00:00:00.000Z", "2026-01-26T00:00:00.000Z"),
            createEvent("week-4", "2026-01-26T00:00:00.000Z", "2026-02-02T00:00:00.000Z"),
            createEvent("week-5", "2026-02-02T00:00:00.000Z", "2026-02-09T00:00:00.000Z"),
        ];
        const taskLeaderboardRepo = createLeaderboardRepo();
        const services = createServices(taskLeaderboardRepo, events);

        await ensureTaskLeaderboardsInitialized(services as any);
        for (const event of events.slice(0, 4)) {
            await registerPeriodicTaskEvent(services as any, event.id);
        }

        await incrementPeriodicPoints(services as any, "old-period-user", 6, "week-4", "gold");
        await registerPeriodicTaskEvent(services as any, "week-5");
        await incrementPeriodicPoints(services as any, "overlap-user", 3, "week-5", "silver");

        const finalisingLeaderboard = taskLeaderboardRepo.current();
        expect(finalisingLeaderboard?.points).toEqual({ "old-period-user": 6 });

        await finalizePeriodicLeaderboard(
            services as any,
            finalisingLeaderboard!,
            [{ userId: "old-period-user", points: 6 }]
        );

        expect(taskLeaderboardRepo.current()?.completedPeriod?.topTen).toEqual([
            { userId: "old-period-user", points: 6 },
        ]);
        expect(taskLeaderboardRepo.current()?.period?.eventIds).toEqual(["week-5"]);
        expect(taskLeaderboardRepo.current()?.points).toEqual({ "overlap-user": 3 });
        expect(taskLeaderboardRepo.current()?.tierCounts).toEqual({
            "overlap-user": { bronze: 0, silver: 1, gold: 0 },
        });
    });

    it("moves tier counts when approved submissions are upgraded", async () => {
        const events = [
            createEvent("week-1", "2026-01-05T00:00:00.000Z", "2026-01-12T00:00:00.000Z"),
            createEvent("week-2", "2026-01-12T00:00:00.000Z", "2026-01-19T00:00:00.000Z"),
        ];
        const taskLeaderboardRepo = createLeaderboardRepo();
        const services = createServices(taskLeaderboardRepo, events);

        await ensureTaskLeaderboardsInitialized(services as any);
        await registerPeriodicTaskEvent(services as any, "week-1");
        await registerPeriodicTaskEvent(services as any, "week-2");

        await incrementPeriodicPoints(services as any, "upgraded-user", 1, "week-1", "bronze");
        await incrementPeriodicPoints(services as any, "upgraded-user", 2, "week-1", "silver");
        await incrementPeriodicPoints(services as any, "upgraded-user", 3, "week-1", "gold");

        await incrementPeriodicPoints(services as any, "upgraded-user", 1, "week-2", "bronze");
        await incrementPeriodicPoints(services as any, "upgraded-user", 2, "week-2", "silver");
        await incrementPeriodicPoints(services as any, "upgraded-user", 3, "week-2", "gold");

        expect(taskLeaderboardRepo.current()?.points).toEqual({ "upgraded-user": 12 });
        expect(taskLeaderboardRepo.current()?.tierCounts).toEqual({
            "upgraded-user": { bronze: 0, silver: 0, gold: 2 },
        });
    });
});
