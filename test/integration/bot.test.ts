import assert from "node:assert";
import path from "node:path";
import cron from "node-cron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { InteractionResponseType, Routes } from "discord-api-types/v10";
import { SnowflakeUtil } from "discord.js";
import { COMMANDS_DIR, describe, expect, storeRunningEvent, test, vi } from "../fixtures.js";
import { startBot } from "../../src/bot.js";
import { DiscordHarness } from "../discord/harness.js";
import {
    DiscordError,
    IDS,
    apiAttachment,
    apiTextChannel,
    buttonInteraction,
    channelSelectInteraction,
    chatInputInteraction,
    directMessage,
    apiOtherGuild,
} from "../discord/payloads.js";
import { taskFactory, userStatsFactory } from "../factories.js";
import { getNextPollDate } from "../../src/modules/tasks/TaskScheduler.js";
import { createServiceContainer } from "../../src/core/services/ServiceFactory.js";
import { BotStatsService } from "../../src/core/services/BotStatsService.js";
import { BotRepository } from "../../src/core/database/BotRepo.js";

const run = promisify(execFile);
const guildCommands = Routes.applicationGuildCommands(IDS.application, IDS.guild);

describe("startBot", () => {
    test("answers slash commands that arrive through the gateway", async ({ db, http, services, onTestFinished }) => {
        const discord = new DiscordHarness(http);

        onTestFinished(
            await startBot(discord.client, { db, commandsDir: COMMANDS_DIR, fallbackGuildId: null, commandSync: null }),
        );
        await discord.connect();
        const interaction = await discord.sendInteraction(chatInputInteraction("bustin"));

        expect(await discord.originalEdit(interaction)).toEqual(
            expect.objectContaining({ content: "Bustin makes me feel good!" }),
        );
        expect(services.guildId).toBe(interaction.guildId);
    });

    test("syncs each slash command once to the primary guild when sync is enabled", async ({
        db,
        http,
        services,
        commands,
        onTestFinished,
    }) => {
        const discord = new DiscordHarness(http);
        discord.acceptCommandSync(guildCommands);

        onTestFinished(
            await startBot(discord.client, {
                db,
                commandsDir: COMMANDS_DIR,
                fallbackGuildId: null,
                commandSync: { token: "sync-token", clientId: IDS.application },
            }),
        );

        const [synced] = discord.commandUpdates(guildCommands);
        assert(synced);
        const expected = [...new Set([...commands.values()].map((command) => command.name))];
        expect(synced).toHaveLength(expected.length);
        expect(synced.map((command) => command.name)).toEqual(expect.arrayContaining(expected));
        expect(services.guildId).toBe(IDS.guild);
    });

    test("keeps starting when Discord rejects the command sync", async ({ db, http, services, onTestFinished }) => {
        const discord = new DiscordHarness(http);
        discord.refuse("PUT", guildCommands, DiscordError.missingAccess);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        onTestFinished(
            await startBot(discord.client, {
                db,
                commandsDir: COMMANDS_DIR,
                fallbackGuildId: null,
                commandSync: { token: "sync-token", clientId: IDS.application },
            }),
        );
        await discord.connect();
        const interaction = await discord.sendInteraction(chatInputInteraction("bustin"));

        expect(error).toHaveBeenCalledWith(
            "Failed to sync guild slash commands:",
            expect.objectContaining({ status: 403 }),
        );
        expect(await discord.originalEdit(interaction)).toEqual(
            expect.objectContaining({ content: "Bustin makes me feel good!" }),
        );
        expect(services.guildId).toBe(IDS.guild);
    });

    test("reports bot-wide praise counts the same in every guild", async ({
        db,
        http,
        services,
        otherGuild,
        onTestFinished,
    }) => {
        const discord = new DiscordHarness(http);

        onTestFinished(
            await startBot(discord.client, { db, commandsDir: COMMANDS_DIR, fallbackGuildId: null, commandSync: null }),
        );
        await discord.connect();
        await discord.addGuild(apiOtherGuild());
        const inOtherGuild = {
            guild_id: otherGuild.guildId,
            channel_id: IDS.otherGuildChannel,
            channel: apiTextChannel({ id: IDS.otherGuildChannel, guild_id: IDS.otherGuild }),
        };
        await discord.originalEdit(await discord.sendInteraction(chatInputInteraction("bustin", [], inOtherGuild)));
        await discord.originalEdit(await discord.sendInteraction(chatInputInteraction("goodbot")));
        const second = await discord.sendInteraction(chatInputInteraction("goodbot", [], inOtherGuild));

        expect(await discord.originalEdit(second)).toEqual(
            expect.objectContaining({ content: expect.stringContaining("good bot 2 times") }),
        );
        expect(services.guildId).toBe(IDS.guild);
    });

    test("keeps a guild's choices from one interaction to the next", async ({ db, http, services, onTestFinished }) => {
        const discord = new DiscordHarness(http);
        onTestFinished(
            await startBot(discord.client, { db, commandsDir: COMMANDS_DIR, fallbackGuildId: null, commandSync: null }),
        );
        await discord.connect();
        const channels = {
            announcements: SnowflakeUtil.generate().toString(),
            botLog: SnowflakeUtil.generate().toString(),
            botArchive: SnowflakeUtil.generate().toString(),
        };

        for (const [picker, channel] of [
            ["setup_announce", channels.announcements],
            ["setup_log", channels.botLog],
            ["setup_archive", channels.botArchive],
        ] as const) {
            await discord.callback(await discord.sendInteraction(channelSelectInteraction(picker, [channel])));
        }
        const confirm = await discord.sendInteraction(buttonInteraction("setup_confirm"));

        expect(await discord.callback(confirm)).toEqual({
            type: InteractionResponseType.UpdateMessage,
            data: expect.objectContaining({ content: expect.stringContaining("Setup complete!") }),
        });
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.channels).toMatchObject(channels);
    });

    test("stops every scheduled job and disconnects when shut down", async ({ db, http, services }) => {
        await services.guilds.update(IDS.guild, { toggles: { taskScheduler: true, leaguesEnabled: false } });
        const discord = new DiscordHarness(http);

        const shutdown = await startBot(discord.client, {
            db,
            commandsDir: COMMANDS_DIR,
            fallbackGuildId: null,
            commandSync: null,
        });
        await discord.connect();
        await shutdown();

        expect(getNextPollDate()).not.toBeNull();
        expect(cron.getTasks().size).toBe(0);
        expect(discord.client.isReady()).toBe(false);
    });

    test("lets a command that is already running finish when shut down", async ({ db, http, services }) => {
        const discord = new DiscordHarness(http);
        const shutdown = await startBot(discord.client, {
            db,
            commandsDir: COMMANDS_DIR,
            fallbackGuildId: null,
            commandSync: null,
        });
        await discord.connect();

        const interaction = await discord.sendInteraction(chatInputInteraction("bustin"));
        await shutdown();

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Bustin makes me feel good!" }),
        ]);
        expect(await services.repos.userRepo.getUserById(interaction.user.id)).toMatchObject({ commandsRun: 1 });
    });

    test("takes screenshots DMed after a restart for the task the member clicked Submit on", async ({
        db,
        http,
        services,
        factories,
    }) => {
        const event = await storeRunningEvent(factories);
        await factories.submissionDraft.create({ taskEventId: event.id });
        const discord = new DiscordHarness(http);
        const screenshot = apiAttachment();
        discord.serveAttachment(screenshot);
        discord.acceptMessages(IDS.channel);
        discord.acceptMessages(IDS.dm);

        const shutdown = await startBot(discord.client, {
            db,
            commandsDir: COMMANDS_DIR,
            fallbackGuildId: null,
            commandSync: null,
        });
        await discord.connect();
        await discord.addGuild(apiOtherGuild());
        await discord.sendMessage(directMessage("", { attachments: [screenshot] }));
        await shutdown();

        expect(discord.messagesSentTo(IDS.dm)).toEqual([
            expect.objectContaining({
                content: expect.stringContaining("received with 1 screenshot and sent for review!"),
            }),
        ]);
        expect(await services.repos.taskRepo.getSubmissionsByUser(IDS.user)).toEqual([
            expect.objectContaining({ taskEventId: event.id }),
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toHaveLength(2);
        expect(await services.repos.taskRepo.getSubmissionDraft(IDS.user)).toBeNull();
    });

    test("refuses to start when no guild is configured and no fallback is given", async ({
        db,
        http,
        onTestFinished,
    }) => {
        const discord = new DiscordHarness(http);
        onTestFinished(() => discord.client.destroy());

        await expect(
            startBot(discord.client, { db, commandsDir: COMMANDS_DIR, fallbackGuildId: null, commandSync: null }),
        ).rejects.toThrow("No guild ID available");
    });
});

describe("entry point", () => {
    const entry = path.join(import.meta.dirname, "../../src/index.ts");
    const options = {
        cwd: import.meta.dirname,
        env: { PATH: process.env.PATH, DOTENV_CONFIG_QUIET: "true", TMDB_API_KEY: "test" },
    };

    test("loads every command and stops in dry-run mode", async () => {
        const { stdout } = await run("npx", ["tsx", entry, "--dry-run"], options);

        expect(stdout).toMatch(/Loaded \d+ commands\./);
        expect(stdout).toContain("[DryRun] Startup preflight passed.");
    }, 30_000);

    test("exits with an error when the TMDb API key is missing", async () => {
        const { TMDB_API_KEY: _, ...withoutTmdb } = options.env;
        await expect(run("npx", ["tsx", entry, "--dry-run"], { ...options, env: withoutTmdb })).rejects.toMatchObject({
            code: 1,
            stderr: expect.stringContaining("TMDB_API_KEY is not set"),
        });
    }, 30_000);

    test("exits with an error when no bot token is configured", async () => {
        await expect(run("npx", ["tsx", entry], options)).rejects.toMatchObject({
            code: 1,
            stderr: expect.stringContaining("No Discord bot token available"),
        });
    }, 30_000);
});

describe("createServiceContainer", () => {
    test("scopes every repository to its guild and shares the bot-wide stats", async ({ db }) => {
        const botStats = new BotStatsService(new BotRepository(db));
        const first = createServiceContainer(db, IDS.guild, botStats);
        const second = createServiceContainer(db, IDS.otherGuild, botStats);

        await first.repos.taskRepo.createTask(taskFactory.build({ id: "PVM001" }));
        await first.repos.userRepo.createUser(userStatsFactory.build({ userId: IDS.user }));

        expect(first.guildId).toBe(IDS.guild);
        expect((await db.doc(`guilds/${IDS.guild}/tasks/PVM001`).get()).exists).toBe(true);
        expect((await db.doc(`guilds/${IDS.guild}/userStats/${IDS.user}`).get()).exists).toBe(true);
        expect(await second.repos.taskRepo.getTaskById("PVM001")).toBeNull();
        expect(second.botStats).toBe(first.botStats);
    });
});
