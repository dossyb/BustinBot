import { ApplicationCommandOptionType, InteractionResponseType, RESTJSONErrorCodes } from "discord-api-types/v10";
import { SnowflakeUtil } from "discord.js";
import assert from "node:assert";
import { DateTime } from "luxon";
import {
    addChampionRoles,
    describe,
    expect,
    vi,
    storeFinishedPeriod,
    storePeriodic,
    storeTaskWeek,
    storeWeeks,
    test,
    type StoringFactories,
} from "../fixtures.js";
import { firestoreUnavailable } from "../firestoreEmulator.js";
import { type ServiceContainer } from "../../src/core/services/ServiceContainer.js";
import { type DiscordHarness } from "../discord/harness.js";
import {
    AS,
    DiscordError,
    IDS,
    NAMES,
    apiGuildMember,
    apiUser,
    apiMember,
    chatInputInteraction,
    buttonInteraction,
    apiMessage,
    subcommand,
} from "../discord/payloads.js";
import { SubmissionStatus } from "../../src/models/TaskSubmission.js";
import {
    postPeriodicLeaderboardUpdate,
    warnPendingLeaderboardFinalization,
} from "../../src/modules/tasks/HandleLeaderboardUpdate.js";
import {
    ensureTaskLeaderboardsInitialized,
    incrementPeriodicPoints,
    registerPeriodicTaskEvent,
} from "../../src/modules/tasks/TaskLeaderboards.js";
import { periodicLeaderboardFactory } from "../factories.js";
import { TaskCategory } from "../../src/models/Task.js";

const [winner, runnerUp, third] = [
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
];

async function setUpChampions(discord: DiscordHarness, services: ServiceContainer, { configured = true } = {}) {
    const roles = await addChampionRoles(discord, services, { configured });
    const placed = (userId: string, name: string) => {
        const user = apiUser({ id: userId, username: name, global_name: name });
        discord.serveMember(IDS.guild, apiGuildMember({ user }));
        return discord.acceptDirectMessages(user);
    };
    const dms = {
        winner: placed(winner, "member1"),
        runnerUp: placed(runnerUp, "member2"),
        third: placed(third, "member3"),
    };
    return { roles, dms };
}

describe("the weekly leaderboard update", () => {
    test("posts the current standings with the week of the period", async ({ discord, services, factories }) => {
        const events = await storeWeeks(factories, DateTime.now().minus({ weeks: 1, days: 1 }), ["week-1", "week-2"]);
        await storePeriodic(factories, {
            points: { [winner]: 6, [runnerUp]: 6 },
            tierCounts: {
                [winner]: { bronze: 0, silver: 0, gold: 1 },
                [runnerUp]: { bronze: 0, silver: 2, gold: 0 },
            },
            period: { length: 4, eventIds: events },
        });
        for (const { id, name } of [
            { id: winner, name: "member1" },
            { id: runnerUp, name: "a-very-long-member-name" },
        ]) {
            discord.serveMember(IDS.guild, apiGuildMember({ user: { id, username: name, global_name: name } }));
        }
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        const [posted] = discord.messagesSentTo(IDS.channel);
        const embed = posted?.embeds?.[0];
        expect(embed?.title).toBe("🏆 Current Leaderboard Standings");
        expect(embed?.fields).toEqual([
            {
                name: "Top 10",
                value: [
                    "```",
                    "Rank Name           Pts B S G",
                    "=🥇  member1          6 0 0 1",
                    "=🥇  a-very-long...   6 0 2 0",
                    "```",
                ].join("\n"),
            },
            { name: "Period Progress", value: "Week 2 of 4" },
        ]);
        expect(embed?.footer?.text).toBe("Task events elapsed: 1/4");
    });

    test("counts a week as elapsed only once its last category's task has ended", async ({
        discord,
        services,
        factories,
    }) => {
        const weekStart = DateTime.now().minus({ days: 6 }).toJSDate();
        await factories.taskEvent.create({
            id: "pvm",
            startTime: weekStart,
            endTime: DateTime.now().minus({ hours: 1 }).toJSDate(),
        });
        await factories.taskEvent.create({
            id: "skilling",
            startTime: weekStart,
            endTime: DateTime.now().plus({ days: 1 }).toJSDate(),
        });
        await storePeriodic(factories, { period: { length: 4, eventIds: ["pvm", "skilling"] } });
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        expect(discord.messagesSentTo(IDS.channel)[0]?.embeds?.[0]?.footer?.text).toBe("Task events elapsed: 0/4");
    });

    test("ends a finished period: champions, final standings and congratulations", async ({
        discord,
        services,
        factories,
    }) => {
        const period = { index: 3 };
        await storeFinishedPeriod(factories, { points: { [winner]: 9, [runnerUp]: 6, [third]: 1 }, period });
        const { roles, dms } = await setUpChampions(discord, services);
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(stored).toMatchObject({
            points: {},
            period: { index: period.index + 1, eventIds: [] },
            completedPeriod: {
                index: period.index,
                topThree: [
                    { userId: winner, points: 9 },
                    { userId: runnerUp, points: 6 },
                    { userId: third, points: 1 },
                ],
            },
            champions: { first: [winner], second: [runnerUp], third: [third], periodIndex: period.index },
        });
        expect(discord.memberRoleChanges("PUT")).toEqual([
            { member: winner, role: roles.first.id },
            { member: runnerUp, role: roles.second.id },
            { member: third, role: roles.third.id },
        ]);
        expect(await services.repos.userRepo.getUserById(winner)).toMatchObject({ taskChampionFirsts: 1 });
        const finals = discord
            .messagesSentTo(IDS.channel)
            .filter((message) => message.embeds?.[0]?.title === "🏆 Final Leaderboard Standings");
        expect(finals).toHaveLength(1);
        expect(finals[0]?.embeds?.[0]?.fields).toEqual([
            { name: "Our Task Champions", value: "🥇 member1\n🥈 member2\n🥉 member3" },
            {
                name: "Final Top 10",
                value: [
                    "```",
                    "Rank Name    Pts B S G",
                    "🥇   member1   9 0 0 0",
                    "🥈   member2   6 0 0 0",
                    "🥉   member3   1 0 0 0",
                    "```",
                ].join("\n"),
            },
        ]);
        expect(discord.messagesSentTo(dms.winner)).toEqual([
            expect.objectContaining({
                content: `🏆 Congratulations! You placed **1st** on the periodic task leaderboard in **${NAMES.guild}**.\nYou have been awarded the **Task Champion (1st)** role to flex.`,
            }),
        ]);
    });

    test.for([
        {
            tie: "first",
            points: { [winner]: 9, [runnerUp]: 9, [third]: 1 },
            places: { first: [winner, runnerUp], second: [], third: [third] },
        },
        {
            tie: "second",
            points: { [winner]: 12, [runnerUp]: 9, [third]: 9 },
            places: { first: [winner], second: [runnerUp, third], third: [] },
        },
    ])("a tie for $tie takes the places it spans", async ({ points, places }, { discord, services, factories }) => {
        await storeFinishedPeriod(factories, { points });
        const { roles } = await setUpChampions(discord, services);
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        const champions = {
            first: [...places.first].sort(),
            second: [...places.second].sort(),
            third: [...places.third].sort(),
        };
        expect(stored?.champions).toMatchObject(champions);
        expect(discord.memberRoleChanges("PUT")).toEqual([
            ...champions.first.map((member) => ({ member, role: roles.first.id })),
            ...champions.second.map((member) => ({ member, role: roles.second.id })),
            ...champions.third.map((member) => ({ member, role: roles.third.id })),
        ]);
    });

    test("awards the roles found by their default names when none are set, without naming them in the DM", async ({
        discord,
        services,
        factories,
    }) => {
        await storeFinishedPeriod(factories, { points: { [winner]: 9 } });
        const { roles, dms } = await setUpChampions(discord, services, { configured: false });
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        expect(discord.memberRoleChanges("PUT")).toEqual([{ member: winner, role: roles.first.id }]);
        expect(discord.messagesSentTo(dms.winner)).toEqual([
            expect.objectContaining({
                content: `🏆 Congratulations! You placed **1st** on the periodic task leaderboard in **${NAMES.guild}**.\nYour placement has been recorded by the task admins.`,
            }),
        ]);
    });

    test("awards a period once when its final post can't be made, so /taskboard final can post it", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await storeFinishedPeriod(factories, { points: { [winner]: 9 } });
        await setUpChampions(discord, services);
        await services.guilds.update(IDS.guild, { channels: { taskChannel: IDS.missingChannel } });
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel, { persist: true });

        await postPeriodicLeaderboardUpdate(discord.client, services);
        await postPeriodicLeaderboardUpdate(discord.client, services);

        expect(warn).toHaveBeenCalledWith(
            `[Channels] Discord refused the taskChannel channel ${IDS.missingChannel} of guild ${IDS.guild}:`,
            expect.objectContaining({ code: RESTJSONErrorCodes.UnknownChannel }),
        );
        expect(discord.memberRoleChanges("PUT")).toHaveLength(1);
        expect(await services.repos.userRepo.getUserById(winner)).toMatchObject({ taskChampionFirsts: 1 });

        await services.guilds.update(IDS.guild, { channels: { taskChannel: IDS.channel } });
        discord.acceptMessages(IDS.channel);
        const command = await interact(chatInputInteraction("taskboard", [subcommand("final")], AS.botAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Final leaderboard posted." }),
        ]);
        expect(discord.messagesSentTo(IDS.channel)[0]?.embeds?.[0]).toMatchObject({
            title: "🏆 Final Leaderboard Standings",
        });
    });
});

describe("settling Moni's Choice in the weekly leaderboard update", () => {
    const regular = [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc];
    const withLeagues = [...regular, TaskCategory.Leagues];
    const endedOnMonday = () => DateTime.now().minus({ weeks: 1, days: 2 }).toJSDate();

    async function storeWeek(
        factories: StoringFactories,
        {
            startTime = endedOnMonday(),
            completed,
            categories = regular,
            monisStatus = SubmissionStatus.Gold,
        }: {
            startTime?: Date;
            completed: TaskCategory[];
            categories?: TaskCategory[];
            monisStatus?: SubmissionStatus;
        },
    ) {
        const week = await storeTaskWeek(factories, {
            startTime,
            categories,
            completedBy: Object.fromEntries(completed.map((category) => [category, [IDS.user]])),
            monisChoice: { completedUserIds: [IDS.user] },
        });
        assert(week.monisChoice);
        await factories.taskSubmission.create({
            id: `${week.monisChoice.id}-${IDS.user}`,
            taskEventId: week.monisChoice.id,
            userId: IDS.user,
            status: monisStatus,
        });
        return [...week.regularEvents, week.monisChoice].map((event) => event.id);
    }

    async function storeTotals(
        factories: StoringFactories,
        eventIds: string[],
        points: number,
        tierCounts: Partial<Record<"bronze" | "silver" | "gold", number>>,
        period: { length?: number } = {},
    ) {
        await factories.userStats.create({
            userId: IDS.user,
            tasksCompletedBronze: tierCounts.bronze ?? 0,
            tasksCompletedSilver: tierCounts.silver ?? 0,
            tasksCompletedGold: tierCounts.gold ?? 0,
        });
        await factories.periodicLeaderboard.create({
            points: { [IDS.user]: points },
            tierCounts: { [IDS.user]: { bronze: 0, silver: 0, gold: 0, ...tierCounts } },
            period: { eventIds, ...period },
        });
        await factories.lifetimeLeaderboard.create({ points: { [IDS.user]: points } });
    }

    async function expectTotals(
        services: ServiceContainer,
        points: number,
        tierCounts: Partial<Record<"bronze" | "silver" | "gold", number>>,
    ) {
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({
            tasksCompletedBronze: tierCounts.bronze ?? 0,
            tasksCompletedSilver: tierCounts.silver ?? 0,
            tasksCompletedGold: tierCounts.gold ?? 0,
        });
        expect((await services.repos.taskLeaderboardRepo.getLeaderboard("lifetime"))?.points).toEqual({
            [IDS.user]: points,
        });
        const periodic = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(periodic?.points).toEqual({ [IDS.user]: points });
        expect(periodic?.tierCounts).toEqual({ [IDS.user]: { bronze: 0, silver: 0, gold: 0, ...tierCounts } });
    }

    test("takes Moni's Choice off a member who also holds every regular task of the week that ended", async ({
        discord,
        services,
        factories,
    }) => {
        const eventIds = await storeWeek(factories, { completed: regular });
        await storeTotals(factories, eventIds, 24, { gold: 4 });
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        await expectTotals(services, 18, { gold: 3 });
        expect(discord.messagesSentTo(IDS.channel)[0]?.embeds?.[0]?.fields?.[0]?.value).toContain(" 18 0 0 3");
    });

    test("settles a week once, however often the update runs", async ({ discord, services, factories }) => {
        const eventIds = await storeWeek(factories, { completed: regular });
        await storeTotals(factories, eventIds, 24, { gold: 4 });
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);
        await postPeriodicLeaderboardUpdate(discord.client, services);

        await expectTotals(services, 18, { gold: 3 });
        const monisChoiceId = eventIds.at(-1);
        assert(monisChoiceId);
        expect(await services.repos.taskRepo.getTaskEventById(monisChoiceId)).toMatchObject({
            settledAt: expect.any(Date),
        });
    });

    test.for([
        { tier: SubmissionStatus.Bronze, points: 1 },
        { tier: SubmissionStatus.Silver, points: 3 },
    ])("takes off the $tier Moni's Choice the member holds", async ({ tier, points }, {
        discord,
        services,
        factories,
    }) => {
        const eventIds = await storeWeek(factories, { completed: regular, monisStatus: tier });
        await storeTotals(factories, eventIds, 18 + points, { gold: 3, [tier]: 1 });
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        await expectTotals(services, 18, { gold: 3 });
    });

    test.for([
        { held: "none of the week's regular tasks", completed: [], points: 6, tierCounts: { gold: 1 } },
        {
            held: "two of the week's regular tasks",
            completed: [TaskCategory.PvM, TaskCategory.Skilling],
            points: 18,
            tierCounts: { gold: 3 },
        },
    ])("leaves Moni's Choice with a member holding $held", async ({ completed, points, tierCounts }, {
        discord,
        services,
        factories,
    }) => {
        const eventIds = await storeWeek(factories, { completed });
        await storeTotals(factories, eventIds, points, tierCounts);
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        await expectTotals(services, points, tierCounts);
    });

    test.for([
        { held: "three of the four regular tasks", completed: regular, after: 24 },
        { held: "all four regular tasks", completed: withLeagues, after: 18 },
    ])("with Leagues on, settles against all four regular tasks: $held", async ({ completed, after }, {
        discord,
        services,
        factories,
    }) => {
        const eventIds = await storeWeek(factories, { completed, categories: withLeagues });
        await storeTotals(factories, eventIds, 24, { gold: 4 });
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        await expectTotals(services, after, { gold: after / 6 });
    });

    test.for([
        { week: "the week before", startTime: () => DateTime.now().minus({ weeks: 2, days: 2 }).toJSDate() },
        { week: "the week still running", startTime: () => DateTime.now().minus({ days: 2 }).toJSDate() },
    ])("leaves Moni's Choice from $week alone", async ({ startTime }, { discord, services, factories }) => {
        const eventIds = await storeWeek(factories, { startTime: startTime(), completed: regular });
        await storeTotals(factories, eventIds, 24, { gold: 4 });
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        await expectTotals(services, 24, { gold: 4 });
    });

    test("leaves a member whose Moni's Choice holds no tier", async ({ discord, services, factories }) => {
        const eventIds = await storeWeek(factories, { completed: regular, monisStatus: SubmissionStatus.Rejected });
        await storeTotals(factories, eventIds, 18, { gold: 3 });
        const stats = await services.repos.userRepo.getUserById(IDS.user);
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        await expectTotals(services, 18, { gold: 3 });
        expect(await services.repos.userRepo.getUserById(IDS.user)).toEqual(stats);
    });

    test("settles before a finished period is awarded", async ({ discord, services, factories }) => {
        const eventIds = await storeWeek(factories, { completed: regular });
        await storeTotals(factories, eventIds, 24, { gold: 4 }, { length: 1 });
        discord.serveMember(IDS.guild, apiGuildMember());
        discord.acceptDirectMessages(apiUser());
        discord.acceptMessages(IDS.channel);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        expect((await services.repos.taskLeaderboardRepo.getLeaderboard("periodic"))?.completedPeriod).toMatchObject({
            topThree: [{ userId: IDS.user, points: 18 }],
            tierCounts: { [IDS.user]: { gold: 3 } },
        });
    });

    test("settles the member's stats and all-time points with the periodic leaderboard turned off", async ({
        discord,
        services,
        factories,
    }) => {
        const eventIds = await storeWeek(factories, { completed: regular });
        await storeTotals(factories, eventIds, 24, { gold: 4 });
        await services.guilds.updateToggle(IDS.guild, "taskLeaderboard", false, IDS.user);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({ tasksCompletedGold: 3 });
        expect((await services.repos.taskLeaderboardRepo.getLeaderboard("lifetime"))?.points).toEqual({
            [IDS.user]: 18,
        });
    });
});

describe("/taskboard", () => {
    test("update posts the current standings, as the weekly update does", async ({ discord, interact, factories }) => {
        await storePeriodic(factories, {});
        discord.acceptMessages(IDS.channel);

        const command = await interact(chatInputInteraction("taskboard", [subcommand("update")], AS.botAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Leaderboard update posted." }),
        ]);
        const embed = discord.messagesSentTo(IDS.channel)[0]?.embeds?.[0];
        expect(embed?.title).toBe("🏆 Current Leaderboard Standings");
        expect(embed?.fields).toEqual([
            { name: "Top 10", value: "No points recorded yet." },
            { name: "Period Progress", value: "Week 1 of 4" },
        ]);
        expect(embed?.footer?.text).toBe("Task events elapsed: 0/4");
    });

    test("says so when the task channel can't be reached", async ({ discord, interact, services, factories }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await storePeriodic(factories, {});
        await services.guilds.update(IDS.guild, { channels: { taskChannel: IDS.missingChannel } });
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel);

        const command = await interact(chatInputInteraction("taskboard", [subcommand("update")], AS.botAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: "Couldn't post the leaderboard: the task channel isn't set up or I can't reach it.",
            }),
        ]);
        expect(warn).toHaveBeenCalledExactlyOnceWith(
            `[Channels] Discord refused the taskChannel channel ${IDS.missingChannel} of guild ${IDS.guild}:`,
            expect.objectContaining({ code: RESTJSONErrorCodes.UnknownChannel }),
        );
    });
});

describe("the warning before a period ends", () => {
    test("tells the task admins how many submissions still need reviewing", async ({
        discord,
        services,
        factories,
    }) => {
        await storeFinishedPeriod(factories);
        for (const [index, eventId] of ["week-1", "week-4", "week-4"].entries()) {
            await factories.taskSubmission.create({
                id: `pending-${index}`,
                taskEventId: eventId,
                status: SubmissionStatus.Pending,
            });
        }
        await factories.taskSubmission.create({ id: "reviewed", taskEventId: "week-4", status: SubmissionStatus.Gold });
        discord.acceptMessages(IDS.channel);

        await warnPendingLeaderboardFinalization(discord.client, services);

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({
                content: `<@&${IDS.roles.taskAdmin}> There are 3 pending task submissions and the periodic leaderboard will finalise in ~24 hours. Please review before the update.`,
            }),
        ]);
    });

    test("is skipped with a warning when the verification channel is gone", async ({
        discord,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await storeFinishedPeriod(factories);
        await factories.taskSubmission.create({ taskEventId: "week-4", status: SubmissionStatus.Pending });
        await services.guilds.update(IDS.guild, { channels: { taskVerification: IDS.missingChannel } });
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel);

        await warnPendingLeaderboardFinalization(discord.client, services);

        expect(warn).toHaveBeenCalledWith(
            `[Channels] Discord refused the taskVerification channel ${IDS.missingChannel} of guild ${IDS.guild}:`,
            expect.objectContaining({ code: RESTJSONErrorCodes.UnknownChannel }),
        );
    });
});

describe("TaskLeaderboards initialisation", () => {
    test("builds the lifetime leaderboard from stored user stats", async ({ services, factories }) => {
        const firstPeriod = 1;
        await factories.userStats.create({ userId: IDS.user, tasksCompletedGold: 1, tasksCompletedBronze: 2 });

        await ensureTaskLeaderboardsInitialized(services);

        expect(await services.repos.taskLeaderboardRepo.getLeaderboard("lifetime")).toMatchObject({
            points: { [IDS.user]: 8 },
        });
        expect(await services.repos.taskLeaderboardRepo.getLeaderboard("periodic")).toMatchObject({
            points: {},
            period: { length: 4, eventIds: [], index: firstPeriod },
        });
    });
});

describe("the leaderboard buttons", () => {
    test("log why the leaderboard couldn't be built and tell the member", async ({ discord, interact, services }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const unavailable = firestoreUnavailable();
        vi.spyOn(services.repos.taskLeaderboardRepo, "getLeaderboard").mockRejectedValueOnce(unavailable);

        const click = await interact(buttonInteraction("task-leaderboard|lifetime"));

        expect(discord.originalEdits(click)).toEqual([
            expect.objectContaining({
                content: "Leaderboard initialisation failed. Please use /reportbug if it continues.",
            }),
        ]);
        expect(error).toHaveBeenCalledWith("[TaskInteractions] Failed to build the leaderboard:", unavailable);
    });
});

describe("TaskLeaderboards periodic submissions", () => {
    test("keeps every category event from the fourth week in the completing period", async ({
        services,
        factories,
    }) => {
        const eventIds: string[] = [];
        for (const week of [1, 2, 3]) {
            for (const category of ["pvm", "skilling", "minigame"]) {
                eventIds.push(
                    (
                        await factories.taskEvent.create({
                            id: `week-${week}-${category}`,
                            startTime: new Date(`2026-01-${String(week * 7 - 2).padStart(2, "0")}T00:00:00.000Z`),
                        })
                    ).id,
                );
            }
        }
        for (const category of ["pvm", "skilling", "minigame"]) {
            eventIds.push(
                (
                    await factories.taskEvent.create({
                        id: `week-4-${category}`,
                        startTime: new Date("2026-01-26T00:00:00.000Z"),
                    })
                ).id,
            );
        }
        eventIds.push(
            (await factories.taskEvent.create({ id: "week-5-pvm", startTime: new Date("2026-02-02T00:00:00.000Z") }))
                .id,
        );

        await ensureTaskLeaderboardsInitialized(services);
        for (const eventId of eventIds) {
            await registerPeriodicTaskEvent(services, eventId);
        }

        const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(stored?.period?.eventIds).toEqual(eventIds.slice(0, 12));
        expect(stored?.pendingPeriod?.period.eventIds).toEqual(["week-5-pvm"]);
    });

    test("carries approved submissions from the overlap into the following period", async ({
        discord,
        services,
        factories,
    }) => {
        const weeks = await storeWeeks(factories, DateTime.fromISO("2026-01-05T00:00:00Z"), [
            "week-1",
            "week-2",
            "week-3",
            "week-4",
            "week-5",
        ]);
        const { dms } = await setUpChampions(discord, services);
        discord.acceptMessages(IDS.channel);

        await ensureTaskLeaderboardsInitialized(services);
        for (const id of weeks.slice(0, 4)) {
            await registerPeriodicTaskEvent(services, id);
        }
        await incrementPeriodicPoints(services, winner, 6, "week-4", SubmissionStatus.Gold);
        await registerPeriodicTaskEvent(services, "week-5");
        await incrementPeriodicPoints(services, runnerUp, 3, "week-5", SubmissionStatus.Silver);

        const finalising = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(finalising?.points).toEqual({ [winner]: 6 });
        const firstPeriod = 1;
        expect(finalising?.period?.index).toBe(firstPeriod);

        await postPeriodicLeaderboardUpdate(discord.client, services);

        const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(stored?.champions).toMatchObject({ first: [winner], periodIndex: firstPeriod });
        expect(stored?.completedPeriod?.topThree).toEqual([{ userId: winner, points: 6 }]);
        expect(stored?.completedPeriod?.topTen).toEqual([{ userId: winner, points: 6 }]);
        expect(stored?.period?.eventIds).toEqual(["week-5"]);
        expect(stored?.points).toEqual({ [runnerUp]: 3 });
        expect(stored?.tierCounts).toEqual({ [runnerUp]: { bronze: 0, silver: 1, gold: 0 } });

        await postPeriodicLeaderboardUpdate(discord.client, services);

        expect((await services.repos.taskLeaderboardRepo.getLeaderboard("periodic"))?.period?.index).toBe(
            firstPeriod + 1,
        );
        expect(discord.messagesSentTo(dms.winner)).toHaveLength(1);
    });
});

describe("TaskLeaderboards taking a tier back off", () => {
    test.for([
        { period: "the current period", eventId: "week-4", board: "period", tierCounts: { bronze: 1, gold: 0 } },
        {
            period: "the following period",
            eventId: "week-5",
            board: "pendingPeriod",
            tierCounts: { bronze: 1, silver: 0, gold: 0 },
        },
    ])("takes a tier's points and count off a member in $period", async ({ eventId, board, tierCounts }, {
        services,
        factories,
    }) => {
        const weeks = await storeWeeks(factories, DateTime.fromISO("2026-01-05T00:00:00Z"), [
            "week-1",
            "week-2",
            "week-3",
            "week-4",
            "week-5",
        ]);
        await ensureTaskLeaderboardsInitialized(services);
        for (const id of weeks) await registerPeriodicTaskEvent(services, id);
        await incrementPeriodicPoints(services, winner, 6, eventId, SubmissionStatus.Gold);
        await incrementPeriodicPoints(services, winner, 1, eventId, SubmissionStatus.Bronze);

        await incrementPeriodicPoints(services, winner, -6, eventId, null, SubmissionStatus.Gold);

        const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        const scores = board === "period" ? stored : stored?.pendingPeriod;
        expect(scores?.points).toEqual({ [winner]: 1 });
        expect(scores?.tierCounts).toEqual({ [winner]: tierCounts });
    });
});

describe("/leaderboard", () => {
    test("shows the all-time leaderboard with the member's rank, and switches to the period's", async ({
        discord,
        interact,
        factories,
    }) => {
        const ann = { member: { user: { id: SnowflakeUtil.generate().toString(), global_name: "Ann" } } };
        await factories.userStats.create({
            userId: ann.member.user.id,
            tasksCompletedBronze: 2,
            tasksCompletedGold: 1,
            taskStreak: 3,
            longestTaskStreak: 3,
        });

        const command = await interact(chatInputInteraction("leaderboard", [], ann));
        const periodic = await interact(buttonInteraction("task-leaderboard|periodic", apiMessage(), ann));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "🏆 Task Leaderboard - All Time 🏆",
                        fields: [
                            {
                                name: "Top 10",
                                value: ["```", "Rank Name Pts B S G Str", "🥇   Ann    8 2 0 1  3*", "```"].join("\n"),
                            },
                            { name: "Your Rank", value: "#1 - 8 pts" },
                        ],
                    }),
                ],
            }),
        ]);
        expect(discord.callbacks(periodic)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        expect(discord.originalEdits(periodic)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "🏆 Task Leaderboard - Monthly 🏆",
                        fields: [
                            { name: "Top 10", value: "No points recorded yet." },
                            { name: "Your Rank", value: "Unranked - 0 pts" },
                        ],
                        footer: { text: "Task events elapsed: 0/4" },
                    }),
                ],
            }),
        ]);
    });

    test("orders equal points by the longer current streak, and members tied on both share a rank", async ({
        discord,
        interact,
        factories,
    }) => {
        const members = ["Ann", "Bob", "Cat"].map((name) =>
            apiMember({ user: { id: SnowflakeUtil.generate().toString(), global_name: name } }),
        );
        const [ann, bob, cat] = members;
        assert(ann && bob && cat);
        for (const member of members) discord.serveMember(IDS.guild, apiGuildMember({ user: member.user }));
        await factories.userStats.create({
            userId: bob.user.id,
            tasksCompletedSilver: 1,
            taskStreak: 5,
            longestTaskStreak: 5,
        });
        await factories.userStats.create({
            userId: ann.user.id,
            tasksCompletedSilver: 1,
            taskStreak: 2,
            longestTaskStreak: 2,
        });
        await factories.userStats.create({
            userId: cat.user.id,
            tasksCompletedSilver: 1,
            taskStreak: 2,
            longestTaskStreak: 2,
        });

        const command = await interact(chatInputInteraction("leaderboard", [], { member: ann }));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        fields: [
                            {
                                name: "Top 10",
                                value: [
                                    "```",
                                    "Rank Name Pts B S G Str",
                                    "🥇   Bob    3 0 1 0  5*",
                                    "=🥈  Ann    3 0 1 0  2*",
                                    "=🥈  Cat    3 0 1 0  2*",
                                    "```",
                                ].join("\n"),
                            },
                            { name: "Your Rank", value: "#2 - 3 pts" },
                        ],
                    }),
                ],
            }),
        ]);
    });
});

describe("/taskperiod", () => {
    test("set saves the number of task events per period", async ({ discord, interact, services }) => {
        const command = await interact(
            chatInputInteraction(
                "taskperiod",
                [subcommand("set", [{ type: ApplicationCommandOptionType.Integer, name: "events", value: 8 }])],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content:
                    "Periodic leaderboard length set to **8** task events. This will apply after the current period ends.",
            }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.periodEvents).toBe(8);
    });

    test("start begins a fresh period without points, keeping the period number", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await factories.periodicLeaderboard.create({
            points: { [IDS.user]: 6 },
            tierCounts: { [IDS.user]: { gold: 1 } },
            period: { eventIds: ["week-1", "week-2"], index: 3 },
        });

        const command = await interact(chatInputInteraction("taskperiod", [subcommand("start")], AS.taskAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content:
                    "Periodic leaderboard reset. The next task event will be counted as the first event of the new period.",
            }),
        ]);
        expect(await services.repos.taskLeaderboardRepo.getLeaderboard("periodic")).toMatchObject({
            points: {},
            tierCounts: {},
            period: { eventIds: [], index: 3 },
        });
    });
});

describe("TaskLeaderboardRepository", () => {
    test("replaces whole score maps on update so stale scores are cleared", async ({ services }) => {
        await services.repos.taskLeaderboardRepo.createLeaderboard(
            periodicLeaderboardFactory.build({ points: { [SnowflakeUtil.generate().toString()]: 6, [IDS.user]: 1 } }),
        );

        await services.repos.taskLeaderboardRepo.updateLeaderboard("periodic", {
            points: { [IDS.user]: 3 },
            pendingPeriod: null,
        });

        const stored = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        expect(stored?.points).toEqual({ [IDS.user]: 3 });
        expect(stored?.pendingPeriod).toBeNull();
    });

    test("keeps a leaderboard that already exists when asked to create it", async ({ services }) => {
        await services.repos.taskLeaderboardRepo.createLeaderboard(
            periodicLeaderboardFactory.build({ points: { [IDS.user]: 3 } }),
        );

        await services.repos.taskLeaderboardRepo.createLeaderboard(periodicLeaderboardFactory.build());

        expect(await services.repos.taskLeaderboardRepo.getLeaderboard("periodic")).toMatchObject({
            points: { [IDS.user]: 3 },
        });
    });
});
