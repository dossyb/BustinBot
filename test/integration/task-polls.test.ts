import assert from "node:assert";
import { SnowflakeUtil } from "discord.js";
import { Duration } from "luxon";
import { describe, expect, type StoringFactories, storePollableTasks, test, vi } from "../fixtures.js";
import { IDS, apiMessage, buttonInteraction, AS, chatInputInteraction } from "../discord/payloads.js";
import { taskFactory, taskPollFactory } from "../factories.js";
import { TaskCategory } from "../../src/models/Task.js";
import { type TaskPoll } from "../../src/models/TaskPoll.js";
import { postAllTaskPolls } from "../../src/modules/tasks/HandleTaskPoll.js";
import { runTaskPollJob } from "../../src/modules/tasks/TaskScheduler.js";
import { startTaskEventForCategory } from "../../src/modules/tasks/HandleTaskStart.js";
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from "../firestoreEmulator.js";

async function storeOpenPoll(factories: StoringFactories, overrides: Partial<TaskPoll> = {}): Promise<TaskPoll> {
    return factories.taskPoll.open().create({
        options: [
            taskFactory.build({ id: "PVM001", shortName: "Zulrah" }),
            taskFactory.build({ id: "PVM002", shortName: "Vorkath" }),
            taskFactory.build({ id: "PVM003", shortName: "Hydra" }),
        ],
        ...overrides,
    });
}

describe("posting the weekly task polls", () => {
    test("announces them and posts one open poll per category, each stored with its options", async ({
        discord,
        services,
        factories,
    }) => {
        await storePollableTasks(factories);
        discord.acceptMessages(IDS.channel);

        await postAllTaskPolls(discord.client, services);

        const [announcement, ...polls] = discord.messagesSentTo(IDS.channel);
        expect(announcement?.content).toContain("**New task polls are live!**");
        expect(polls).toHaveLength(3);
        for (const poll of polls) {
            expect(poll.components).toMatchObject([{ components: [{}, {}, {}] }]);
            expect(poll.files).toEqual(["category_icon.png"]);
        }
        for (const category of [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc]) {
            const stored = await services.repos.taskRepo.getActiveTaskPollByCategory(category);
            assert(stored);
            expect(stored.options).toHaveLength(3);
            expect(stored).toMatchObject({ isActive: true, channelId: IDS.channel, id: stored.messageId });
            expect(stored.endsAt.getTime() - stored.createdAt.getTime()).toBe(
                Duration.fromObject({ hours: 24 }).toMillis(),
            );
        }
    });

    test("announces them without a mention when no task role is configured", async ({
        discord,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await services.guilds.update(IDS.guild, { roles: { taskUser: "" } });
        await storePollableTasks(factories);
        discord.acceptMessages(IDS.channel);

        await postAllTaskPolls(discord.client, services);

        expect(discord.messagesSentTo(IDS.channel)[0]?.content).toBe(
            "**New task polls are live!** Cast your votes for each category below:",
        );
        expect(warn).toHaveBeenCalledWith("[Tasks] Task user role not configured or not found.");
    });
});

describe("the scheduled task poll job", () => {
    test("posts nothing when no task channel is configured", async ({ discord, services, factories }) => {
        await storePollableTasks(factories);
        await services.guilds.update(IDS.guild, { channels: { taskChannel: "" } });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        await runTaskPollJob(discord.client, services);

        expect(warn).toHaveBeenCalledWith(
            `[Channels] The taskChannel channel (not set) of guild ${IDS.guild} isn't set or can't be reached.`,
        );

        expect(await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.PvM)).toBeNull();
    });
});

describe("voting in a task poll", () => {
    test("records the vote, redraws the poll with it and thanks the member", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const poll = await storeOpenPoll(factories);
        discord.acceptMessageEdits(IDS.channel);

        const click = await interact(
            buttonInteraction(`vote_${poll.category}_PVM002`, apiMessage({ id: poll.messageId })),
        );

        expect(discord.originalEdits(click)).toEqual([
            expect.objectContaining({ content: "Thank you for your vote!" }),
        ]);
        expect((await services.repos.taskRepo.getTaskPollById(poll.id))?.votes).toEqual({ [IDS.user]: "PVM002" });
        const [redrawn] = discord.messageEdits(IDS.channel, poll.messageId);
        expect(redrawn?.embeds?.[0]?.description).toContain("**1 vote**");
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({ taskPollsVoted: 1 });
    });

    test("lets a member change their vote without counting them twice", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const poll = await storeOpenPoll(factories);
        discord.acceptMessageEdits(IDS.channel);

        await interact(buttonInteraction(`vote_${poll.category}_PVM001`, apiMessage({ id: poll.messageId })));
        await interact(buttonInteraction(`vote_${poll.category}_PVM003`, apiMessage({ id: poll.messageId })));

        expect((await services.repos.taskRepo.getTaskPollById(poll.id))?.votes).toEqual({ [IDS.user]: "PVM003" });
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({ taskPollsVoted: 1 });
    });

    test("keeps counting every vote on a poll posted before the bot restarted", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const poll = await storeOpenPoll(factories);
        discord.acceptMessageEdits(IDS.channel);
        const voters = [
            SnowflakeUtil.generate().toString(),
            SnowflakeUtil.generate().toString(),
            SnowflakeUtil.generate().toString(),
        ];

        for (const voter of voters) {
            const click = await interact(
                buttonInteraction(`vote_${poll.category}_PVM001`, apiMessage({ id: poll.messageId }), {
                    member: { user: { id: voter } },
                }),
            );
            expect(discord.originalEdits(click)).toEqual([
                expect.objectContaining({ content: "Thank you for your vote!" }),
            ]);
        }

        expect(Object.keys((await services.repos.taskRepo.getTaskPollById(poll.id))?.votes ?? {})).toEqual(voters);
    });

    test("refuses votes once the poll has closed or its time is up", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const closed = await storeOpenPoll(factories, { isActive: false });
        const expired = await factories.taskPoll.ended().create();

        for (const poll of [closed, expired]) {
            const click = await interact(
                buttonInteraction(`vote_${poll.category}_PVM001`, apiMessage({ id: poll.messageId })),
            );
            expect(discord.originalEdits(click)).toEqual([
                expect.objectContaining({ content: "This poll has closed." }),
            ]);
            expect((await services.repos.taskRepo.getTaskPollById(poll.id))?.votes).toEqual({});
        }
    });

    test("refuses a vote from an outdated button or for an option the poll doesn't have", async ({
        discord,
        interact,
        factories,
    }) => {
        const poll = await storeOpenPoll(factories);

        const outdated = await interact(
            buttonInteraction(`vote_${TaskCategory.Skilling}_PVM001`, apiMessage({ id: poll.messageId })),
        );
        const unknown = await interact(
            buttonInteraction(`vote_${poll.category}_PVM999`, apiMessage({ id: poll.messageId })),
        );

        expect(discord.originalEdits(outdated)).toEqual([
            expect.objectContaining({ content: "This poll message is outdated." }),
        ]);
        expect(discord.originalEdits(unknown)).toEqual([expect.objectContaining({ content: "Invalid vote option." })]);
    });
});

describe("closing a task poll", () => {
    test("happens when its winning task starts, and its message stops offering votes", async ({
        discord,
        services,
        factories,
    }) => {
        const poll = await storeOpenPoll(factories, { votes: { [SnowflakeUtil.generate().toString()]: "PVM002" } });
        for (const task of poll.options) await factories.task.create(task);
        discord.acceptMessages(IDS.channel);
        discord.acceptMessageEdits(IDS.channel);
        discord.serveMessage(apiMessage({ id: poll.messageId }));

        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "keyword");

        expect((await services.repos.taskRepo.getTaskPollById(poll.id))?.isActive).toBe(false);
        const [closedMessage] = discord.messageEdits(IDS.channel, poll.messageId);
        expect(closedMessage?.components).toEqual([]);
    });
});

describe("/taskpoll", () => {
    test("posts the task polls now", async ({ discord, interact, services, factories }) => {
        await storePollableTasks(factories);
        discord.acceptMessages(IDS.channel);

        const command = await interact(chatInputInteraction("taskpoll", [], AS.botAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Task poll posted successfully." }),
        ]);
        expect(await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.PvM)).toMatchObject({
            isActive: true,
            channelId: IDS.channel,
        });
    });
});

describe("/leagues", () => {
    test("switching Leagues on adds a Leagues poll to the next task polls", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await services.guilds.updateToggle(IDS.guild, "leaguesEnabled", false, IDS.user);
        await storePollableTasks(factories, Object.values(TaskCategory));
        discord.acceptMessages(IDS.channel);

        const command = await interact(chatInputInteraction("leagues", [], AS.taskAdmin));
        await postAllTaskPolls(discord.client, services);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Leagues tasks have been **enabled**." }),
        ]);
        expect(await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.Leagues)).toMatchObject({
            isActive: true,
        });
    });

    test("switches Leagues back off", async ({ discord, interact, services }) => {
        await services.guilds.updateToggle(IDS.guild, "leaguesEnabled", true, IDS.user);

        const command = await interact(chatInputInteraction("leagues", [], AS.taskAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Leagues tasks have been **disabled**." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.leaguesEnabled).toBe(false);
    });
});

describe("TaskRepository polls", () => {
    test("finds the active poll and the latest poll for a category", async ({ services }) => {
        await services.repos.taskRepo.createTaskPoll(
            taskPollFactory.build({ id: "old", createdAt: new Date("2026-01-04T00:00:00.000Z"), isActive: false }),
        );
        await services.repos.taskRepo.createTaskPoll(
            taskPollFactory.build({ id: "new", createdAt: new Date("2026-01-11T00:00:00.000Z") }),
        );
        await services.repos.taskRepo.createTaskPoll(
            taskPollFactory.build({ id: "skilling", category: TaskCategory.Skilling }),
        );

        expect((await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.PvM))?.id).toBe("new");
        expect((await services.repos.taskRepo.getLatestTaskPollByCategory(TaskCategory.PvM))?.id).toBe("new");
        expect(await services.repos.taskRepo.getTaskPollById("old")).toMatchObject({ id: "old", isActive: false });
        expect(await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.MinigameMisc)).toBeNull();
    });

    test(
        "counts every vote when voters vote at the same time",
        async ({ services }) => {
            const poll = taskPollFactory.build();
            await services.repos.taskRepo.createTaskPoll(poll);

            await Promise.all(
                Array.from({ length: 5 }, () =>
                    services.repos.taskRepo.voteInPollOnce(poll.id, SnowflakeUtil.generate().toString(), "PVM001"),
                ),
            );

            expect(Object.keys((await services.repos.taskRepo.getTaskPollById(poll.id))?.votes ?? {})).toHaveLength(5);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );
});
