import assert from "node:assert";
import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import cron from "node-cron";
import { ChannelType, RESTJSONErrorCodes } from "discord-api-types/v10";
import { beforeEach, describe, expect, storePollableTasks, test, vi } from "../fixtures.js";
import { firestoreUnavailable } from "../firestoreEmulator.js";
import { DiscordError, IDS, AS, chatInputInteraction, subcommand } from "../discord/payloads.js";
import { TaskCategory } from "../../src/models/Task.js";
import { configuredChannel } from "../../src/utils/ChannelUtils.js";
import {
    getNextEventDate,
    getNextPollDate,
    getNextPrizeDrawDate,
    initTaskScheduler,
    stopTaskScheduler,
    taskSchedulerJobs,
} from "../../src/modules/tasks/TaskScheduler.js";
import { guildFactory } from "../factories.js";

const atMinute = (minute: number): Date =>
    DateTime.now().set({ hour: 12, minute, second: 0, millisecond: 0 }).toJSDate();

describe("task scheduler", () => {
    test("keeps each guild's jobs separate, and scheduling again replaces a guild's jobs instead of adding more", async ({
        discord,
        services,
        otherGuild,
    }) => {
        await initTaskScheduler(discord.client, services);
        await initTaskScheduler(discord.client, otherGuild);
        await initTaskScheduler(discord.client, services);

        expect(taskSchedulerJobs(IDS.guild).size).toBe(5);
        expect(taskSchedulerJobs(IDS.otherGuild).size).toBe(5);
        expect(cron.getTasks().size).toBe(10);

        await stopTaskScheduler(IDS.guild);

        expect(taskSchedulerJobs(IDS.guild).size).toBe(0);
        expect(taskSchedulerJobs(IDS.otherGuild).size).toBe(5);
    });
    test("logs a job that fails under the job's name", async ({ discord, services }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        await initTaskScheduler(discord.client, services);
        const unavailable = firestoreUnavailable();
        vi.spyOn(services.guilds, "get").mockRejectedValueOnce(unavailable);

        const poll = taskSchedulerJobs(IDS.guild).get("poll");
        assert(poll);

        await expect(poll.execute()).rejects.toBe(unavailable);

        expect(error).toHaveBeenCalledWith(`[taskScheduler:${IDS.guild}:poll]`, unavailable);
    });
});

describe("the dev-mode task cycle", () => {
    beforeEach(() => {
        vi.stubEnv("BOT_MODE", "dev");
        vi.stubEnv("DISCORD_GUILD_ID_DEV", IDS.guild);
    });

    test("reports when its next poll, task start and prize draw come", async ({ discord, services }) => {
        vi.setSystemTime(atMinute(2));

        await initTaskScheduler(discord.client, services);

        expect([getNextPollDate(), getNextEventDate(), getNextPrizeDrawDate()]).toEqual([
            atMinute(6),
            atMinute(7),
            atMinute(15),
        ]);
    });

    test("posts the polls the minute before each 7-minute mark and starts their tasks on the mark", async ({
        discord,
        services,
        factories,
    }) => {
        await storePollableTasks(factories);
        await services.repos.keywordRepo.addKeyword("Bustin");
        discord.acceptMessages(IDS.channel);
        discord.acceptMessageEdits(IDS.channel);
        await initTaskScheduler(discord.client, services);
        const job = taskSchedulerJobs(IDS.guild).get("test");
        assert(job);

        vi.setSystemTime(atMinute(6));
        await job.execute();
        const categories = [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc];
        const polls = await Promise.all(
            categories.map((category) => services.repos.taskRepo.getActiveTaskPollByCategory(category)),
        );
        expect(polls).toEqual(categories.map((category) => expect.objectContaining({ category, isActive: true })));
        expect(await services.repos.taskRepo.getLatestTaskEvent()).toBeNull();

        vi.setSystemTime(atMinute(7));
        await job.execute();
        const started = await services.repos.taskRepo.getTaskEventsBetween(
            atMinute(7),
            DateTime.fromJSDate(atMinute(7)).plus({ weeks: 2 }).toJSDate(),
        );
        expect(started).toHaveLength(polls.length);
        expect(started.map((event) => event.task.id)).toEqual(
            expect.arrayContaining(polls.map((poll) => poll?.options[0]?.id)),
        );
    });

    test("draws the prize one minute after every other 7-minute mark", async ({ discord, services }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await initTaskScheduler(discord.client, services);
        const job = taskSchedulerJobs(IDS.guild).get("test");
        assert(job);

        vi.setSystemTime(atMinute(8));
        await job.execute();
        expect(await services.repos.prizeRepo.getAllPrizeDraws()).toEqual([]);

        vi.setSystemTime(atMinute(15));
        await job.execute();
        expect(await services.repos.prizeRepo.getAllPrizeDraws()).toEqual([
            expect.objectContaining({ totalEntries: 0 }),
        ]);
        expect(warn).toHaveBeenCalledWith("[PrizeDraw] No task events found in range for snapshot.");
    });

    test("does nothing on the other minutes", async ({ discord, services, factories }) => {
        await storePollableTasks(factories);
        await initTaskScheduler(discord.client, services);

        vi.setSystemTime(atMinute(2));
        const job = taskSchedulerJobs(IDS.guild).get("test");
        assert(job);
        await job.execute();

        expect(await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.PvM)).toBeNull();
        expect(await services.repos.prizeRepo.getAllPrizeDraws()).toEqual([]);
        expect(discord.requests).toEqual([]);
    });
});

describe("the task channel", () => {
    test("is missing when the configured channel is not a text channel", async ({ discord, services }) => {
        const category = SnowflakeUtil.generate().toString();
        await services.guilds.update(IDS.guild, { channels: { taskChannel: category } });
        discord.serveChannel({
            id: category,
            type: ChannelType.GuildCategory,
            guild_id: IDS.guild,
            name: "Tasks",
            position: 0,
            permission_overwrites: [],
        });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(await configuredChannel(discord.client, services, "taskChannel")).toBeNull();
        expect(warn).toHaveBeenCalledWith(
            `[Channels] The taskChannel channel ${category} of guild ${IDS.guild} isn't set or can't be reached.`,
        );
    });

    test("is reported missing when the configured channel no longer exists", async ({ discord, services }) => {
        await services.guilds.update(IDS.guild, { channels: { taskChannel: IDS.missingChannel } });
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(await configuredChannel(discord.client, services, "taskChannel")).toBeNull();
        expect(warn).toHaveBeenCalledWith(
            `[Channels] Discord refused the taskChannel channel ${IDS.missingChannel} of guild ${IDS.guild}:`,
            expect.objectContaining({ code: RESTJSONErrorCodes.UnknownChannel }),
        );
    });
});

describe("/tasktoggle schedule", () => {
    test("starts this guild's task jobs and saves the toggle", async ({ discord, interact, services }) => {
        const interaction = await interact(chatInputInteraction("tasktoggle", [subcommand("schedule")], AS.botAdmin));

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "✅ Task scheduler **enabled** and started for this guild." }),
        ]);
        expect(taskSchedulerJobs(IDS.guild).size).toBe(5);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.taskScheduler).toBe(true);
    });

    test("stops only this guild's task jobs when switched off", async ({ discord, interact, otherGuild, services }) => {
        await initTaskScheduler(discord.client, otherGuild);
        await interact(chatInputInteraction("tasktoggle", [subcommand("schedule")], AS.botAdmin));

        const interaction = await interact(chatInputInteraction("tasktoggle", [subcommand("schedule")], AS.botAdmin));

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "⏹️ Task scheduler **disabled** and stopped for this guild." }),
        ]);
        expect(taskSchedulerJobs(IDS.guild).size).toBe(0);
        expect(taskSchedulerJobs(IDS.otherGuild).size).toBe(5);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.taskScheduler).toBe(false);
    });

    test("works for a guild stored without any toggles", async ({ discord, interact, db }) => {
        const { toggles: _toggles, ...withoutToggles } = guildFactory.build();
        await db.doc(`guilds/${IDS.guild}`).set(withoutToggles);

        const interaction = await interact(chatInputInteraction("tasktoggle", [subcommand("schedule")], AS.botAdmin));

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "✅ Task scheduler **enabled** and started for this guild." }),
        ]);
        expect(taskSchedulerJobs(IDS.guild).size).toBe(5);
    });
});

describe("/tasktoggle leaderboard", () => {
    test("switches periodic leaderboard automation off and back on", async ({ discord, interact, services }) => {
        await services.guilds.updateToggle(IDS.guild, "taskLeaderboard", true, IDS.user);

        const off = await interact(chatInputInteraction("tasktoggle", [subcommand("leaderboard")], AS.botAdmin));
        expect(discord.originalEdits(off)).toEqual([
            expect.objectContaining({ content: "🧊 Periodic leaderboard automation **disabled** (read-only mode)." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.taskLeaderboard).toBe(false);

        const on = await interact(chatInputInteraction("tasktoggle", [subcommand("leaderboard")], AS.botAdmin));
        expect(discord.originalEdits(on)).toEqual([
            expect.objectContaining({ content: "🏆 Periodic leaderboard automation **enabled**." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.taskLeaderboard).toBe(true);
    });
});
