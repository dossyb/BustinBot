import { DateTime } from "luxon";
import { describe, expect, storeWeeks, test, type StoringFactories } from "../fixtures.js";
import { IDS, chatInputInteraction, AS, apiUser } from "../discord/payloads.js";
import { SubmissionStatus } from "../../src/models/TaskSubmission.js";
import { calculateTaskStreakSummary } from "../../src/modules/tasks/TaskStreaks.js";
import { TimestampStyles, time, SnowflakeUtil } from "discord.js";
import { ApplicationCommandOptionType } from "discord-api-types/v10";

async function submit(
    factories: StoringFactories,
    eventId: string,
    submittedAt: Date,
    overrides: Parameters<StoringFactories["taskSubmission"]["build"]>[0] = {},
): Promise<void> {
    await factories.taskSubmission.create({
        id: `${eventId}-submission`,
        userId: IDS.user,
        taskEventId: eventId,
        status: SubmissionStatus.Bronze,
        createdAt: submittedAt,
        submittedAt,
        ...overrides,
    });
}

describe("task streaks", () => {
    test("start when the current week's task is completed", async ({ services, factories }) => {
        const start = DateTime.now().minus({ days: 2 });
        await storeWeeks(factories, start, ["week-1"]);
        await submit(factories, "week-1", start.plus({ days: 1 }).toJSDate());

        expect(await calculateTaskStreakSummary(IDS.user, services.repos.taskRepo)).toMatchObject({
            currentStreak: 1,
            longestStreak: 1,
            hasCompletedCurrentPeriod: true,
        });
    });

    test("continue across consecutive weeks", async ({ services, factories }) => {
        const start = DateTime.now().minus({ days: 8 });
        await storeWeeks(factories, start, ["week-1", "week-2"]);
        await submit(factories, "week-1", start.plus({ days: 1 }).toJSDate());
        await submit(factories, "week-2", start.plus({ days: 8 }).toJSDate());

        expect(await calculateTaskStreakSummary(IDS.user, services.repos.taskRepo)).toMatchObject({
            currentStreak: 2,
            longestStreak: 2,
            hasCompletedCurrentPeriod: true,
        });
    });

    test("break when a week with a task is missed", async ({ services, factories }) => {
        const start = DateTime.now().minus({ days: 16 });
        await storeWeeks(factories, start, ["week-1", "week-2", "week-3"]);
        await submit(factories, "week-1", start.plus({ days: 1 }).toJSDate());

        expect(await calculateTaskStreakSummary(IDS.user, services.repos.taskRepo)).toMatchObject({
            currentStreak: 0,
            longestStreak: 1,
            hasCompletedCurrentPeriod: false,
        });
    });

    test("survive a break in which no tasks ran", async ({ services, factories }) => {
        const start = DateTime.now().minus({ days: 36 });
        const afterBreak = start.plus({ days: 35 });
        await factories.taskEvent.create({
            id: "before-break",
            startTime: start.toJSDate(),
        });
        await factories.taskEvent.create({
            id: "after-break",
            startTime: afterBreak.toJSDate(),
        });
        await submit(factories, "before-break", start.plus({ days: 1 }).toJSDate());

        expect(await calculateTaskStreakSummary(IDS.user, services.repos.taskRepo)).toMatchObject({
            currentStreak: 1,
            longestStreak: 1,
            hasCompletedCurrentPeriod: false,
        });
    });

    test("treat a week as starting with its earliest completed task, so a task that started late keeps the streak", async ({
        services,
        factories,
    }) => {
        const start = DateTime.now().minus({ days: 8 });
        const weekTwo = start.plus({ days: 7 });
        await storeWeeks(factories, start, ["week-1", "week-2"]);
        await factories.taskEvent.create({
            id: "week-2-late",
            startTime: weekTwo.plus({ days: 2 }).toJSDate(),
            endTime: weekTwo.plus({ days: 7 }).toJSDate(),
        });
        await factories.taskEvent.create({
            id: "missed-between",
            startTime: weekTwo.toJSDate(),
            endTime: weekTwo.plus({ days: 1 }).toJSDate(),
        });
        await submit(factories, "week-1", start.plus({ days: 1 }).toJSDate());
        await submit(factories, "week-2-late", weekTwo.plus({ days: 3 }).toJSDate());
        await submit(factories, "week-2", weekTwo.plus({ days: 3 }).toJSDate());

        expect(await calculateTaskStreakSummary(IDS.user, services.repos.taskRepo)).toMatchObject({
            currentStreak: 2,
            longestStreak: 2,
        });
    });

    test("count a submission made before the week ended even if it was reviewed afterwards", async ({
        services,
        factories,
    }) => {
        const start = DateTime.now().minus({ days: 8 });
        await storeWeeks(factories, start, ["week-1"]);
        const end = start.plus({ days: 7 });
        await submit(factories, "week-1", end.minus({ hours: 2 }).toJSDate(), {
            status: SubmissionStatus.Gold,
            createdAt: end.plus({ hours: 2 }).toJSDate(),
        });

        expect(await calculateTaskStreakSummary(IDS.user, services.repos.taskRepo)).toMatchObject({
            currentStreak: 1,
            longestStreak: 1,
        });
    });

    test("ignore submissions that were rejected or are still pending", async ({ services, factories }) => {
        const start = DateTime.now().minus({ days: 9 });
        await storeWeeks(factories, start, ["week-1", "week-2"]);
        await submit(factories, "week-1", start.plus({ days: 1 }).toJSDate(), { status: SubmissionStatus.Rejected });
        await submit(factories, "week-2", start.plus({ days: 8 }).toJSDate(), { status: SubmissionStatus.Pending });

        expect(await calculateTaskStreakSummary(IDS.user, services.repos.taskRepo)).toMatchObject({
            currentStreak: 0,
            longestStreak: 0,
        });
    });
});

describe("/taskstreak", () => {
    test("shows a streak kept for this week once the week's task is approved", async ({
        discord,
        interact,
        factories,
    }) => {
        const event = await factories.taskEvent.running().create({
            id: "week-1",
        });
        await factories.taskSubmission.create({
            taskEventId: event.id,
            userId: IDS.user,
            status: SubmissionStatus.Bronze,
            submittedAt: DateTime.now().minus({ hours: 1 }).toJSDate(),
        });
        await factories.userStats.create({ userId: IDS.user, taskStreak: 1, longestTaskStreak: 1 });

        const command = await interact(chatInputInteraction("taskstreak"));

        expect(discord.originalEdits(command)[0]?.embeds?.[0]?.fields).toEqual([
            { name: "🔥 Current Streak", value: "1", inline: true },
            { name: "🏅 Longest Streak", value: "1", inline: true },
            {
                name: "⏰ Deadline",
                value: expect.stringMatching(
                    new RegExp(
                        `^✅ Streak kept active for this period\\. Period ends ${time(event.endTime, TimestampStyles.LongDateTime)}`,
                    ),
                ),
                inline: false,
            },
        ]);
    });

    test("tells a member who hasn't submitted this week when the period ends", async ({
        discord,
        interact,
        factories,
    }) => {
        const event = await factories.taskEvent.running().create({
            id: "week-1",
        });

        const command = await interact(chatInputInteraction("taskstreak"));

        expect(discord.originalEdits(command)[0]?.embeds?.[0]?.fields?.[2]?.value).toMatch(
            new RegExp(`^⏳ Submit before ${time(event.endTime, TimestampStyles.LongDateTime)}`),
        );
    });

    test("shows the streak stored for the member, and no deadline outside a task period", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.userStats.create({ userId: IDS.user, taskStreak: 7, longestTaskStreak: 9 });

        const command = await interact(chatInputInteraction("taskstreak"));

        expect(discord.originalEdits(command)[0]?.embeds?.[0]?.fields).toEqual([
            { name: "🔥 Current Streak", value: "7", inline: true },
            { name: "🏅 Longest Streak", value: "9", inline: true },
            { name: "⏰ Deadline", value: "No active task period right now.", inline: false },
        ]);
    });
});

describe("/setstreak", () => {
    test("sets the member's streak and raises their longest streak to match", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const member = apiUser({ id: SnowflakeUtil.generate().toString(), username: "streaker" });
        await factories.userStats.create({ userId: member.id, taskStreak: 2, longestTaskStreak: 3 });

        const command = await interact(
            chatInputInteraction(
                "setstreak",
                [
                    { type: ApplicationCommandOptionType.User, name: "user", value: member.id },
                    { type: ApplicationCommandOptionType.Integer, name: "streak", value: 5 },
                ],
                AS.taskAdmin,
                { users: { [member.id]: member } },
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "✅ Updated task streak for **streaker** to **5**." }),
        ]);
        expect(await services.repos.userRepo.getUserById(member.id)).toMatchObject({
            taskStreak: 5,
            longestTaskStreak: 5,
        });
    });

    test("keeps a longer longest streak when lowering the current one", async ({ interact, services, factories }) => {
        const member = apiUser({ id: SnowflakeUtil.generate().toString() });
        await factories.userStats.create({ userId: member.id, taskStreak: 4, longestTaskStreak: 9 });

        await interact(
            chatInputInteraction(
                "setstreak",
                [
                    { type: ApplicationCommandOptionType.User, name: "user", value: member.id },
                    { type: ApplicationCommandOptionType.Integer, name: "streak", value: 1 },
                ],
                AS.taskAdmin,
                { users: { [member.id]: member } },
            ),
        );

        expect(await services.repos.userRepo.getUserById(member.id)).toMatchObject({
            taskStreak: 1,
            longestTaskStreak: 9,
        });
    });

    test("creates stats for a member who has none", async ({ interact, services }) => {
        const member = apiUser({ id: SnowflakeUtil.generate().toString() });

        await interact(
            chatInputInteraction(
                "setstreak",
                [
                    { type: ApplicationCommandOptionType.User, name: "user", value: member.id },
                    { type: ApplicationCommandOptionType.Integer, name: "streak", value: 3 },
                ],
                AS.taskAdmin,
                { users: { [member.id]: member } },
            ),
        );

        expect(await services.repos.userRepo.getUserById(member.id)).toMatchObject({
            taskStreak: 3,
            longestTaskStreak: 3,
        });
    });
});
