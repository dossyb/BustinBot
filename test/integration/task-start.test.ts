import { SnowflakeUtil } from "discord.js";
import { Duration } from "luxon";
import { describe, expect, vi, type StoringFactories, storePollableTasks, test } from "../fixtures.js";
import { AS, IDS, chatInputInteraction } from "../discord/payloads.js";
import { taskEventFactory } from "../factories.js";
import { TaskCategory } from "../../src/models/Task.js";
import { type TaskPoll } from "../../src/models/TaskPoll.js";
import { startTaskEventForCategory } from "../../src/modules/tasks/HandleTaskStart.js";
import { runTaskStartJob } from "../../src/modules/tasks/TaskScheduler.js";
import assert from "node:assert";

async function storePoll(
    factories: StoringFactories,
    category: TaskCategory,
    votes: Record<string, string>,
    overrides: Partial<TaskPoll> = {},
): Promise<void> {
    await factories.taskPoll.ended().create({
        category,
        options: await storePollableTasks(factories, [category]),
        votes,
        ...overrides,
    });
}

async function storeThisWeeksPolls(factories: StoringFactories): Promise<void> {
    await storePoll(factories, TaskCategory.PvM, {
        [SnowflakeUtil.generate().toString()]: "PVM002",
        [SnowflakeUtil.generate().toString()]: "PVM002",
        [SnowflakeUtil.generate().toString()]: "PVM001",
    });
    await storePoll(factories, TaskCategory.Skilling, {
        [SnowflakeUtil.generate().toString()]: "SKL003",
    });
    await storePoll(factories, TaskCategory.MinigameMisc, {
        [SnowflakeUtil.generate().toString()]: "MIN001",
    });
}

describe("/taskstart", () => {
    test("announces the week's keyword and starts each category's most voted task", async ({
        discord,
        interact,
        services,
        db,
        factories,
    }) => {
        await services.repos.keywordRepo.addKeyword("Bustin");
        await storeThisWeeksPolls(factories);
        discord.acceptMessages(IDS.channel);

        const interaction = await interact(chatInputInteraction("taskstart", [], AS.botAdmin));

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Task event started successfully." }),
        ]);
        const [announcement, ...eventPosts] = discord.messagesSentTo(IDS.channel);
        expect(announcement?.content).toContain("Include the keyword **Bustin** in your screenshots");
        expect(eventPosts).toHaveLength(3);
        const events = (await db.collection(`guilds/${IDS.guild}/taskEvents`).get()).docs.map((doc) => doc.data());
        expect(events).toHaveLength(3);
        expect(events.map((event) => event.task.id)).toEqual(expect.arrayContaining(["MIN001", "PVM002", "SKL003"]));
        for (const event of events) {
            expect(event).toMatchObject({ keyword: "Bustin", channelId: IDS.channel, messageId: expect.any(String) });
            expect(event.endTime.toMillis() - event.startTime.toMillis()).toBe(
                Duration.fromObject({ days: 7 }).toMillis(),
            );
        }
        for (const category of [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc]) {
            expect(await services.repos.taskRepo.getActiveTaskPollByCategory(category)).toBeNull();
        }
    });
});

describe("the scheduled task start job", () => {
    test("starts nothing and uses up no keyword when no task channel is configured", async ({
        discord,
        services,
        factories,
    }) => {
        await services.repos.keywordRepo.addKeyword("Bustin");
        await storeThisWeeksPolls(factories);
        await services.guilds.update(IDS.guild, { channels: { taskChannel: "" } });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        await runTaskStartJob(discord.client, services);

        expect(warn).toHaveBeenCalledWith(
            `[Channels] The taskChannel channel (not set) of guild ${IDS.guild} isn't set or can't be reached.`,
        );

        expect(await services.repos.taskRepo.getLatestTaskEvent()).toBeNull();
        expect(await services.repos.keywordRepo.getKeywordById("bustin")).toMatchObject({ timesUsed: 0 });
    });
});

describe("starting a category's task", () => {
    test("breaks a tie in favour of the option listed first in the poll", async ({ discord, services, factories }) => {
        await storePoll(factories, TaskCategory.PvM, {
            [SnowflakeUtil.generate().toString()]: "PVM003",
            [SnowflakeUtil.generate().toString()]: "PVM002",
        });
        discord.acceptMessages(IDS.channel);

        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "Bustin");

        expect((await services.repos.taskRepo.getLatestTaskEvent())?.task.id).toBe("PVM002");
    });

    test("uses the poll that has just been closed, which is the usual case when polls end as tasks start", async ({
        discord,
        services,
        factories,
    }) => {
        await storePoll(
            factories,
            TaskCategory.PvM,
            { [SnowflakeUtil.generate().toString()]: "PVM003" },
            { isActive: false },
        );
        discord.acceptMessages(IDS.channel);

        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "Bustin");

        expect((await services.repos.taskRepo.getLatestTaskEvent())?.task.id).toBe("PVM003");
    });

    test("keeps both events when the same task starts twice in a day", async ({ discord, services, db, factories }) => {
        await storePoll(factories, TaskCategory.PvM, {
            [SnowflakeUtil.generate().toString()]: "PVM001",
        });
        discord.acceptMessages(IDS.channel);

        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "Bustin");
        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "Bustin");

        const events = (await db.collection(`guilds/${IDS.guild}/taskEvents`).get()).docs;
        expect(events).toHaveLength(2);
        expect(new Set(events.map((doc) => doc.data().messageId)).size).toBe(2);
    });

    test("posts nothing for a category without a poll", async ({ discord, services }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "Bustin");

        expect(warn).toHaveBeenCalledWith(`[TaskStart] No active poll found for ${TaskCategory.PvM}.`);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
    });
});

describe("/testtask", () => {
    test("posts a week-long test task event in the channel and stores it", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const task = await factories.task.create();
        discord.acceptMessages(IDS.channel);

        const command = await interact(chatInputInteraction("testtask", [], AS.botAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Test task event posted!" }),
        ]);
        const event = await services.repos.taskRepo.getLatestTaskEvent();
        assert(event);
        expect(event.id).toMatch(new RegExp(`^test-${task.id}-\\d+$`));
        expect(event.endTime.getTime() - event.startTime.getTime()).toBe(Duration.fromObject({ days: 7 }).toMillis());
        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        footer: { text: `Ends ${event.endTime.toUTCString()} • ${event.id}` },
                    }),
                ],
            }),
        ]);
    });
});

describe("TaskRepository events", () => {
    test("stores events and finds the latest and those ending in a range", async ({ services }) => {
        await services.repos.taskRepo.createTaskEvent(
            taskEventFactory.build({
                id: "week-1",
                createdAt: new Date("2026-01-05T00:00:00.000Z"),
                endTime: new Date("2026-01-12T00:00:00.000Z"),
            }),
        );
        await services.repos.taskRepo.createTaskEvent(
            taskEventFactory.build({
                id: "week-2",
                createdAt: new Date("2026-01-12T00:00:00.000Z"),
                endTime: new Date("2026-01-19T00:00:00.000Z"),
            }),
        );

        expect(await services.repos.taskRepo.getTaskEventById("week-1")).toMatchObject({ id: "week-1" });
        expect((await services.repos.taskRepo.getLatestTaskEvent())?.id).toBe("week-2");
        expect(
            (
                await services.repos.taskRepo.getTaskEventsBetween(
                    new Date("2026-01-13T00:00:00.000Z"),
                    new Date("2026-01-31T00:00:00.000Z"),
                )
            ).map((event) => event.id),
        ).toEqual(["week-2"]);
    });
});
