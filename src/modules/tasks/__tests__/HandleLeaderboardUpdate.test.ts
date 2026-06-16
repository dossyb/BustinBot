import { describe, expect, it, vi } from "vitest";
import { postPeriodicLeaderboardUpdate } from "../HandleLeaderboardUpdate.js";

describe("HandleLeaderboardUpdate periodic updates", () => {
    it("shows the current week as elapsed task events plus one", async () => {
        const send = vi.fn();
        const channel = { name: "weekly-task", send, isTextBased: () => true };
        const guild = {
            channels: {
                fetch: vi.fn().mockResolvedValue(channel),
            },
        };
        const client = {
            guilds: {
                fetch: vi.fn().mockResolvedValue(guild),
            },
            users: {
                cache: new Map(),
                fetch: vi.fn(),
            },
            channels: {
                cache: new Map(),
            },
        };
        const leaderboard = {
            id: "periodic",
            points: {},
            tierCounts: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            period: {
                length: 4,
                eventIds: ["week-1"],
                startedAt: "2026-01-01T00:00:00.000Z",
                index: 1,
            },
        };
        const services = {
            guildId: "guild-1",
            guilds: {
                get: vi.fn().mockResolvedValue({
                    toggles: { taskLeaderboard: true },
                    channels: { taskChannel: "task-channel" },
                    taskSettings: { periodEvents: 4 },
                }),
            },
            repos: {
                taskLeaderboardRepo: {
                    getLeaderboard: vi.fn().mockResolvedValue(leaderboard),
                    createLeaderboard: vi.fn(),
                    updateLeaderboard: vi.fn(),
                },
                taskRepo: {
                    getTaskEventById: vi.fn().mockResolvedValue({
                        id: "week-1",
                        keyword: "week-1",
                        startTime: new Date("2099-01-05T00:00:00.000Z"),
                        endTime: new Date("2099-01-12T00:00:00.000Z"),
                    }),
                },
                userRepo: {
                    getAllUsers: vi.fn().mockResolvedValue([]),
                },
            },
        };

        await postPeriodicLeaderboardUpdate(client as any, services as any);

        const embed = send.mock.calls[0]?.[0]?.embeds?.[0];
        const progressField = embed?.data?.fields?.find((field: { name: string }) => field.name === "Period Progress");
        expect(progressField?.value).toBe("Week 1 of 4");
        expect(embed?.data?.footer?.text).toBe("Task events elapsed: 0/4");
    });
});
