import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { describe, expect, vi, type StoringFactories, storeTaskWeek, test } from "../fixtures.js";
import { DiscordError, IDS, NAMES, apiUser, AS, chatInputInteraction, PRIVATE_DEFERRAL } from "../discord/payloads.js";
import { SubmissionStatus } from "../../src/models/TaskSubmission.js";
import {
    announcePrizeDrawWinner,
    generatePrizeDrawSnapshot,
    rollWinnerForSnapshot,
} from "../../src/modules/tasks/HandlePrizeDraw.js";
import { runPrizeDrawJob } from "../../src/modules/tasks/TaskScheduler.js";
import assert from "node:assert";
import { ApplicationCommandOptionType, RESTJSONErrorCodes } from "discord-api-types/v10";
import { TaskCategory } from "../../src/models/Task.js";
import type { TaskEvent } from "../../src/models/TaskEvent.js";

const [winner, second, third, fourth] = [
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
];

async function storeEvent(
    factories: StoringFactories,
    id: string,
    events: StoringFactories["taskEvent"],
    submissions: Array<{ userId: string; status: SubmissionStatus; submittedAt?: Date; reviewedAt?: Date }>,
) {
    await events.create({ id });
    for (const [index, submission] of submissions.entries()) {
        await factories.taskSubmission.create({ id: `${id}-${index}`, taskEventId: id, ...submission });
    }
}

const yesterdaysDraw = {
    id: "draw-1",
    start: DateTime.now().minus({ days: 14 }).toJSDate().toISOString(),
    end: DateTime.now().minus({ days: 1 }).toJSDate().toISOString(),
    snapshotTakenAt: DateTime.now().minus({ days: 1 }).toJSDate().toISOString(),
    participants: { [winner]: 2, [second]: 1 },
    entries: [winner, winner, second],
    totalEntries: 3,
    tierCounts: { bronze: 1, silver: 1, gold: 1 },
};

describe("a prize draw snapshot", () => {
    test("gives one entry per task however many times the member upgraded their submission", async ({
        services,
        factories,
    }) => {
        await storeEvent(factories, "pvm", factories.taskEvent.ended(), [
            { userId: winner, status: SubmissionStatus.Bronze },
            { userId: winner, status: SubmissionStatus.Silver },
            { userId: winner, status: SubmissionStatus.Gold },
        ]);

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({
            participants: { [winner]: 1 },
            totalEntries: 1,
            tierCounts: { bronze: 0, silver: 0, gold: 1 },
        });
    });

    test("gives one entry for each task the member completed", async ({ services, factories }) => {
        for (const id of ["pvm", "skilling", "minigame"]) {
            await storeEvent(factories, id, factories.taskEvent.ended(), [
                { userId: winner, status: SubmissionStatus.Gold },
            ]);
        }

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({
            participants: { [winner]: 3 },
            totalEntries: 3,
        });
    });

    test("leaves out submissions that are pending or rejected", async ({ services, factories }) => {
        await storeEvent(factories, "pvm", factories.taskEvent.ended(), [
            { userId: winner, status: SubmissionStatus.Pending },
            { userId: second, status: SubmissionStatus.Rejected },
        ]);

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({
            participants: {},
            totalEntries: 0,
        });
    });

    test("leaves out a task event that is still running", async ({ services, factories }) => {
        await storeEvent(factories, "finished", factories.taskEvent.ended(), [
            { userId: winner, status: SubmissionStatus.Gold },
        ]);
        await storeEvent(factories, "running", factories.taskEvent.running(), [
            { userId: second, status: SubmissionStatus.Gold },
        ]);

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({
            participants: { [winner]: 1 },
            taskEventIds: ["finished"],
        });
    });

    test("carries over approvals the previous draw's snapshot missed", async ({ services, factories }) => {
        const previousEnd = DateTime.now().minus({ days: 21 });
        const previousSnapshot = previousEnd.plus({ days: 1 });
        await factories.prizeDraw.create({
            ...yesterdaysDraw,
            id: "previous",
            start: previousEnd.minus({ days: 14 }).toJSDate().toISOString(),
            end: previousEnd.toJSDate().toISOString(),
            snapshotTakenAt: previousSnapshot.toJSDate().toISOString(),
            rolledAt: previousSnapshot.plus({ days: 1 }).toJSDate().toISOString(),
            taskEventIds: ["previous-event"],
        });
        await storeEvent(factories, "previous-event", factories.taskEvent.params({ endTime: previousEnd.toJSDate() }), [
            {
                userId: second,
                status: SubmissionStatus.Silver,
                submittedAt: previousEnd.minus({ days: 1 }).toJSDate(),
                reviewedAt: previousSnapshot.plus({ hours: 1 }).toJSDate(),
            },
            {
                userId: third,
                status: SubmissionStatus.Gold,
                submittedAt: previousEnd.minus({ days: 1 }).toJSDate(),
                reviewedAt: previousEnd.minus({ hours: 1 }).toJSDate(),
            },
            {
                userId: fourth,
                status: SubmissionStatus.Bronze,
                submittedAt: previousEnd.plus({ days: 1 }).toJSDate(),
                reviewedAt: previousEnd.plus({ days: 2 }).toJSDate(),
            },
        ]);
        await storeEvent(factories, "current-event", factories.taskEvent.ended(), [
            { userId: winner, status: SubmissionStatus.Gold },
        ]);

        const draw = await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo);

        expect(draw.participants).toEqual({ [winner]: 1, [second]: 1 });
        expect(draw.taskEventIds).toEqual(expect.arrayContaining(["current-event", "previous-event"]));
    });

    test("carries over only from the most recent rolled draw", async ({ services, factories }) => {
        const members = { older: SnowflakeUtil.generate().toString(), latest: SnowflakeUtil.generate().toString() };
        for (const [id, endDaysAgo] of [
            ["older", 42],
            ["latest", 21],
        ] as const) {
            const end = DateTime.now().minus({ days: endDaysAgo });
            await factories.prizeDraw.create({
                ...yesterdaysDraw,
                id,
                start: end.minus({ days: 14 }).toJSDate().toISOString(),
                end: end.toJSDate().toISOString(),
                snapshotTakenAt: end.plus({ days: 1 }).toJSDate().toISOString(),
                rolledAt: end.plus({ days: 2 }).toJSDate().toISOString(),
                taskEventIds: [`${id}-event`],
            });
            await storeEvent(factories, `${id}-event`, factories.taskEvent.params({ endTime: end.toJSDate() }), [
                {
                    userId: members[id],
                    status: SubmissionStatus.Bronze,
                    submittedAt: end.minus({ days: 1 }).toJSDate(),
                    reviewedAt: end.plus({ hours: 36 }).toJSDate(),
                },
            ]);
        }
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(
            (await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).participants,
        ).toEqual({ [members.latest]: 1 });
        expect(warn).toHaveBeenCalledWith("[PrizeDraw] No task events found in range for snapshot.");
    });
});

describe("a prize draw snapshot with Moni's Choice", () => {
    const regular = [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc];

    async function storeEndedWeek(
        factories: StoringFactories,
        endedDaysAgo: number,
        completed: Record<string, TaskCategory[]>,
        categories: TaskCategory[] = regular,
    ): Promise<{ regularEvents: TaskEvent[]; monisChoice: TaskEvent }> {
        const completedBy = Object.fromEntries(
            categories.map((category) => [
                category,
                Object.keys(completed).filter((userId) => completed[userId]?.includes(category)),
            ]),
        );
        const week = await storeTaskWeek(factories, {
            startTime: DateTime.now().minus({ days: endedDaysAgo, weeks: 1 }).toJSDate(),
            categories,
            completedBy,
        });
        assert(week.monisChoice);
        for (const event of week.regularEvents) {
            for (const userId of completedBy[event.category] ?? []) {
                await factories.taskSubmission.create({
                    id: `${event.id}-${userId}`,
                    taskEventId: event.id,
                    userId,
                    status: SubmissionStatus.Gold,
                });
            }
        }
        return { regularEvents: week.regularEvents, monisChoice: week.monisChoice };
    }

    async function storeMonisChoiceApprovals(factories: StoringFactories, monisChoice: TaskEvent, userIds: string[]) {
        for (const userId of userIds) {
            await factories.taskSubmission.create({
                id: `${monisChoice.id}-${userId}`,
                taskEventId: monisChoice.id,
                userId,
                status: SubmissionStatus.Gold,
            });
        }
    }

    test("gives Moni's Choice an entry to a member missing a regular task of its week, and none to one holding them all", async ({
        services,
        factories,
    }) => {
        const { monisChoice } = await storeEndedWeek(factories, 1, {
            [winner]: regular,
            [second]: [TaskCategory.PvM, TaskCategory.Skilling],
        });
        await storeMonisChoiceApprovals(factories, monisChoice, [winner, second]);

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({
            participants: { [winner]: 3, [second]: 3 },
            totalEntries: 6,
            tierCounts: { bronze: 0, silver: 0, gold: 6 },
        });
    });

    test("gives Moni's Choice an entry to a member holding none of the week's regular tasks", async ({
        services,
        factories,
    }) => {
        const { monisChoice } = await storeEndedWeek(factories, 1, {});
        await storeMonisChoiceApprovals(factories, monisChoice, [winner]);

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({
            participants: { [winner]: 1 },
            totalEntries: 1,
        });
    });

    test("with Leagues on, gives Moni's Choice an entry to a member holding three of the four regular tasks only", async ({
        services,
        factories,
    }) => {
        const withLeagues = [...regular, TaskCategory.Leagues];
        const { monisChoice } = await storeEndedWeek(factories, 1, { [winner]: regular, [second]: withLeagues }, withLeagues);
        await storeMonisChoiceApprovals(factories, monisChoice, [winner, second]);

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({
            participants: { [winner]: 4, [second]: 4 },
            totalEntries: 8,
        });
    });

    test("judges each Moni's Choice by its own week", async ({ services, factories }) => {
        const earlier = await storeEndedWeek(factories, 8, { [winner]: regular });
        const later = await storeEndedWeek(factories, 1, {});
        await storeMonisChoiceApprovals(factories, earlier.monisChoice, [winner]);
        await storeMonisChoiceApprovals(factories, later.monisChoice, [winner]);

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({
            participants: { [winner]: 4 },
            totalEntries: 4,
        });
    });

    test("gives no Moni's Choice entry to a member holding its week's regular tasks but not the week before's, which ends as it starts", async ({
        services,
        factories,
    }) => {
        await storeEndedWeek(factories, 8, {});
        const { monisChoice } = await storeEndedWeek(factories, 1, { [winner]: regular });
        await storeMonisChoiceApprovals(factories, monisChoice, [winner]);

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({
            participants: { [winner]: 3 },
            totalEntries: 3,
        });
    });

    test("judges a carried-over Moni's Choice by its week too", async ({ services, factories }) => {
        const { monisChoice } = await storeEndedWeek(factories, 21, { [winner]: regular, [second]: [TaskCategory.PvM] });
        const previousEnd = DateTime.fromJSDate(monisChoice.endTime);
        const previousSnapshot = previousEnd.plus({ days: 1 });
        await factories.prizeDraw.create({
            ...yesterdaysDraw,
            id: "previous",
            start: previousEnd.minus({ days: 14 }).toJSDate().toISOString(),
            end: previousEnd.toJSDate().toISOString(),
            snapshotTakenAt: previousSnapshot.toJSDate().toISOString(),
            rolledAt: previousSnapshot.plus({ days: 1 }).toJSDate().toISOString(),
            taskEventIds: [monisChoice.id],
        });
        for (const userId of [winner, second]) {
            await factories.taskSubmission.create({
                id: `carried-${userId}`,
                taskEventId: monisChoice.id,
                userId,
                status: SubmissionStatus.Gold,
                submittedAt: previousEnd.minus({ days: 1 }).toJSDate(),
                reviewedAt: previousSnapshot.plus({ hours: 1 }).toJSDate(),
            });
        }
        await storeEvent(factories, "current-event", factories.taskEvent.ended(), [
            { userId: third, status: SubmissionStatus.Gold },
        ]);

        expect((await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).participants).toEqual({
            [second]: 1,
            [third]: 1,
        });
    });
});

describe("rolling a prize draw", () => {
    test("keeps the winner already rolled", async ({ services, factories }) => {
        await factories.prizeDraw.create({
            ...yesterdaysDraw,
            winnerId: second,
            rolledAt: DateTime.now().minus({ days: 1 }).toJSDate().toISOString(),
        });

        expect(await rollWinnerForSnapshot(services.repos.prizeRepo, "draw-1", services)).toBe(second);
    });

    test("picks a winner by entries, stores them and counts the win", async ({ services, factories }) => {
        vi.spyOn(Math, "random").mockReturnValue(0);
        await factories.prizeDraw.create(yesterdaysDraw);

        expect(await rollWinnerForSnapshot(services.repos.prizeRepo, "draw-1", services)).toBe(winner);
        expect(await services.repos.prizeRepo.getPrizeDrawById("draw-1")).toMatchObject({
            winnerId: winner,
            rolledAt: expect.any(String),
        });
        expect(await services.repos.userRepo.getUserById(winner)).toMatchObject({ taskPrizesWon: 1 });
    });
});

describe("announcing a prize draw winner", () => {
    test("posts one message mentioning the task role with the winner's embed, and congratulates the winner", async ({
        discord,
        services,
        factories,
    }) => {
        await factories.prizeDraw.create({ ...yesterdaysDraw, winnerId: winner });
        discord.acceptMessages(IDS.channel);
        const dm = discord.acceptDirectMessages(apiUser({ id: winner, username: "lucky" }));

        expect(await announcePrizeDrawWinner(discord.client, services, services.repos.prizeRepo, "draw-1")).toBe(true);

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({
                content: `<@&${IDS.roles.taskUser}>`,
                embeds: [expect.objectContaining({ thumbnail: { url: "attachment://task_prize.png" } })],
                files: ["task_prize.png"],
            }),
        ]);
        expect(discord.messagesSentTo(dm)).toEqual([
            expect.objectContaining({
                content: expect.stringContaining(
                    `You've won the latest OSRS community tasks prize draw in **${NAMES.guild}**`,
                ),
            }),
        ]);
    });

    test("still posts the winner's embed when no task role is configured", async ({ discord, services, factories }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await services.guilds.update(IDS.guild, { roles: { taskUser: "" } });
        await factories.prizeDraw.create({ ...yesterdaysDraw, winnerId: winner });
        discord.acceptMessages(IDS.channel);
        discord.acceptDirectMessages(apiUser({ id: winner, username: "lucky" }));

        expect(await announcePrizeDrawWinner(discord.client, services, services.repos.prizeRepo, "draw-1")).toBe(true);

        const [posted] = discord.messagesSentTo(IDS.channel);
        expect(posted?.embeds).toHaveLength(1);
        expect(posted?.content).toBeUndefined();
        expect(warn).toHaveBeenCalledWith("[PrizeDraw] Task user role not configured or not found.");
    });

    test("reports that the task channel can't be reached instead of posting anywhere else", async ({
        discord,
        services,
        factories,
    }) => {
        await services.guilds.update(IDS.guild, { channels: { taskChannel: IDS.missingChannel } });
        await factories.prizeDraw.create({ ...yesterdaysDraw, winnerId: winner });
        discord.serveUser(apiUser({ id: winner, username: "lucky" }));
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(await announcePrizeDrawWinner(discord.client, services, services.repos.prizeRepo, "draw-1")).toBe(false);

        expect(warn).toHaveBeenCalledWith(
            `[Channels] Discord refused the taskChannel channel ${IDS.missingChannel} of guild ${IDS.guild}:`,
            expect.objectContaining({ code: RESTJSONErrorCodes.UnknownChannel }),
        );
        expect(discord.requests.filter((request) => request.method === "POST")).toEqual([]);
    });
});

describe("the scheduled prize draw job", () => {
    const drawTuesday = DateTime.fromISO("2026-10-13T00:00:00Z", { zone: "utc" });

    test("draws and announces a winner on a prize draw week", async ({ discord, services, factories }) => {
        vi.setSystemTime(drawTuesday.toJSDate());
        await storeEvent(factories, "pvm", factories.taskEvent.ended(), [
            { userId: winner, status: SubmissionStatus.Gold },
        ]);
        discord.acceptMessages(IDS.channel);
        const dm = discord.acceptDirectMessages(apiUser({ id: winner, username: "lucky" }));

        await runPrizeDrawJob(discord.client, services);

        const [draw] = await services.repos.prizeRepo.getAllPrizeDraws();
        expect(draw).toMatchObject({ winnerId: winner, totalEntries: 1 });
        expect(discord.messagesSentTo(IDS.channel)).toHaveLength(1);
        expect(discord.messagesSentTo(dm)).toHaveLength(1);
    });

    test("does nothing on the weeks between draws", async ({ discord, services, factories }) => {
        vi.setSystemTime(drawTuesday.plus({ weeks: 1 }).toJSDate());
        await storeEvent(factories, "pvm", factories.taskEvent.ended(), [
            { userId: winner, status: SubmissionStatus.Gold },
        ]);

        await runPrizeDrawJob(discord.client, services);

        expect(await services.repos.prizeRepo.getAllPrizeDraws()).toEqual([]);
    });
});

describe("/taskdraw", () => {
    test("acknowledges privately before anything else, then asks for the snapshot to roll", async ({
        discord,
        interact,
    }) => {
        const interaction = await interact(
            chatInputInteraction(
                "taskdraw",
                [{ type: ApplicationCommandOptionType.String, name: "action", value: "roll" }],
                AS.botAdmin,
            ),
        );

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "You must provide a snapshot ID to roll a winner." }),
        ]);
    });

    test("snapshots the entries of the last fortnight's finished tasks", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeEvent(factories, "pvm", factories.taskEvent.ended(), [
            { userId: IDS.user, status: SubmissionStatus.Gold },
        ]);

        const interaction = await interact(
            chatInputInteraction(
                "taskdraw",
                [{ type: ApplicationCommandOptionType.String, name: "action", value: "snapshot" }],
                AS.botAdmin,
            ),
        );

        const [draw] = await services.repos.prizeRepo.getAllPrizeDraws();
        assert(draw);
        expect(draw).toMatchObject({ participants: { [IDS.user]: 1 }, totalEntries: 1 });
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: `Snapshot created for period **${draw.id}** with **1** entries.` }),
        ]);
    });

    test("rolls the winner of a snapshot", async ({ discord, interact, factories }) => {
        const draw = await factories.prizeDraw.create({
            participants: { [IDS.user]: 1 },
            entries: [IDS.user],
            totalEntries: 1,
        });

        const interaction = await interact(
            chatInputInteraction(
                "taskdraw",
                [
                    { type: ApplicationCommandOptionType.String, name: "action", value: "roll" },
                    { type: ApplicationCommandOptionType.String, name: "snapshot_id", value: draw.id },
                ],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: `Winner rolled for **${draw.id}**: <@${IDS.user}>` }),
        ]);
    });

    test("says so when a snapshot has no entries to roll", async ({ discord, interact, factories }) => {
        const draw = await factories.prizeDraw.create({ participants: {}, entries: [], totalEntries: 0 });

        const interaction = await interact(
            chatInputInteraction(
                "taskdraw",
                [
                    { type: ApplicationCommandOptionType.String, name: "action", value: "roll" },
                    { type: ApplicationCommandOptionType.String, name: "snapshot_id", value: draw.id },
                ],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: `No eligible entries found for **${draw.id}**.` }),
        ]);
    });

    test("announces a rolled winner", async ({ discord, interact, factories }) => {
        const draw = await factories.prizeDraw.create({ entries: [IDS.user], totalEntries: 1, winnerId: IDS.user });
        discord.acceptMessages(IDS.channel);
        const dm = discord.acceptDirectMessages(apiUser({ id: IDS.user }));

        const interaction = await interact(
            chatInputInteraction(
                "taskdraw",
                [
                    { type: ApplicationCommandOptionType.String, name: "action", value: "announce" },
                    { type: ApplicationCommandOptionType.String, name: "snapshot_id", value: draw.id },
                ],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: `Announcement sent for **${draw.id}**.` }),
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toHaveLength(1);
        expect(discord.messagesSentTo(dm)).toHaveLength(1);
    });

    test("says so when the winner can't be announced", async ({ discord, interact, factories }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const draw = await factories.prizeDraw.create({
            participants: { [IDS.user]: 1 },
            entries: [IDS.user],
            totalEntries: 1,
        });

        const interaction = await interact(
            chatInputInteraction(
                "taskdraw",
                [
                    { type: ApplicationCommandOptionType.String, name: "action", value: "announce" },
                    { type: ApplicationCommandOptionType.String, name: "snapshot_id", value: draw.id },
                ],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                content: `Unable to announce winner for **${draw.id}**. Ensure a winner has been rolled and the announcement channel exists.`,
            }),
        ]);
        expect(warn).toHaveBeenCalledWith("[PrizeDraw] Cannot announce winner - snapshot or winner not found.");
    });
});
