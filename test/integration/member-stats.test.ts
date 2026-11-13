import { SnowflakeUtil, TimestampStyles, time } from "discord.js";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../fixtures.js";
import { IDS, apiUser, chatInputInteraction } from "../discord/payloads.js";

describe("/stats", () => {
    test("shows a member's stats, with dates each viewer reads in their own timezone", async ({
        discord,
        interact,
        factories,
    }) => {
        const member = apiUser({ id: SnowflakeUtil.generate().toString(), username: "member" });
        const joinedAt = new Date("2026-02-03T04:05:06.000Z");
        const lastActiveAt = new Date("2026-03-04T05:06:07.000Z");
        await factories.userStats.create({
            userId: member.id,
            joinedAt,
            lastActiveAt,
            commandsRun: 12,
            moviesAdded: 3,
            tasksCompletedGold: 2,
            taskStreak: 4,
        });

        const command = await interact(
            chatInputInteraction(
                "stats",
                [{ type: ApplicationCommandOptionType.User, name: "user", value: member.id }],
                {},
                { users: { [member.id]: member } },
            ),
        );

        const [reply] = discord.originalEdits(command);
        expect(reply?.embeds?.[0]).toMatchObject({ author: { name: "member's Stats" } });
        expect(reply?.embeds?.[0]?.fields?.slice(0, 3)).toEqual([
            { name: "🕧 First Active", value: time(joinedAt, TimestampStyles.LongDate), inline: true },
            { name: "💬 Last Active", value: time(lastActiveAt, TimestampStyles.LongDate), inline: true },
            { name: "🕹️ Commands Run", value: "12", inline: true },
        ]);
        expect(reply?.embeds?.[0]?.fields?.[3]?.value).toContain("🎞️ Movies Added: **3**");
        expect(reply?.embeds?.[0]?.fields?.[4]?.value).toContain("🥇 Gold Tasks: **2**");
        expect(reply?.embeds?.[0]?.fields?.[4]?.value).toContain("🔥 Current Task Streak: **4**");
    });

    test("shows Unknown for the dates a legacy import didn't store", async ({ discord, interact, db }) => {
        const member = apiUser({ id: SnowflakeUtil.generate().toString(), username: "member" });
        await db.doc(`guilds/${IDS.guild}/userStats/${member.id}`).set({
            userId: member.id,
            legacyTasksCompleted: 7,
            createdAt: new Date("2025-06-01T00:00:00.000Z"),
        });

        const command = await interact(
            chatInputInteraction(
                "stats",
                [{ type: ApplicationCommandOptionType.User, name: "user", value: member.id }],
                {},
                { users: { [member.id]: member } },
            ),
        );

        const [reply] = discord.originalEdits(command);
        expect(reply?.embeds?.[0]?.fields?.slice(0, 2)).toEqual([
            { name: "🕧 First Active", value: "Unknown", inline: true },
            { name: "💬 Last Active", value: "Unknown", inline: true },
        ]);
    });

    test("says so when the member has no stats", async ({ discord, interact }) => {
        const member = apiUser({ id: SnowflakeUtil.generate().toString(), username: "member" });

        const command = await interact(
            chatInputInteraction(
                "stats",
                [{ type: ApplicationCommandOptionType.User, name: "user", value: member.id }],
                {},
                { users: { [member.id]: member } },
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: "No stats found for member. They may not have interacted with me yet.",
            }),
        ]);
    });

    test("counts itself, so a member's first command shows their stats", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("stats"));

        const [reply] = discord.originalEdits(command);
        expect(reply?.embeds?.[0]?.fields).toContainEqual({ name: "🕹️ Commands Run", value: "1", inline: true });
    });
});
