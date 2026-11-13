import { SnowflakeUtil } from "discord.js";
import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test as base, beforeEach, vi } from "../fixtures.js";
import { routeInteraction } from "../../src/core/events/routeInteraction.js";
import {
    AS,
    IDS,
    NAMES,
    buttonInteraction,
    channelSelectInteraction,
    modalSubmitInteraction,
    roleSelectInteraction,
    stringSelectInteraction,
    chatInputInteraction,
    PRIVATE_DEFERRAL,
} from "../discord/payloads.js";
import { guildFactory } from "../factories.js";
import { GuildService } from "../../src/core/services/GuildService.js";
import { GuildRepository } from "../../src/core/database/GuildRepo.js";

const CHANNELS = {
    announce: SnowflakeUtil.generate().toString(),
    log: SnowflakeUtil.generate().toString(),
    archive: SnowflakeUtil.generate().toString(),
};
const MOVIE_ADMIN_ROLE = SnowflakeUtil.generate().toString();
const MOVIE_USER_ROLE = SnowflakeUtil.generate().toString();
const MOVIE_CHANNEL = SnowflakeUtil.generate().toString();
const MOVIE_VOICE_CHANNEL = SnowflakeUtil.generate().toString();
const TASK_ADMIN_ROLE = SnowflakeUtil.generate().toString();
const TASK_USER_ROLE = SnowflakeUtil.generate().toString();
const TASK_CHANNEL = SnowflakeUtil.generate().toString();
const TASK_VERIFICATION_CHANNEL = SnowflakeUtil.generate().toString();

const test = base
    .extend("repo", ({ db }) => new GuildRepository(db))
    .extend("guilds", ({ repo }) => new GuildService(repo));

const guildId = IDS.guild;
const admin = SnowflakeUtil.generate().toString();
const newGuild = SnowflakeUtil.generate().toString();

describe("the setup commands", () => {
    test("/setup acknowledges privately first, then offers the channel pickers showing the current channels", async ({
        discord,
        interact,
    }) => {
        const interaction = await interact(chatInputInteraction("setup", [], AS.botAdmin));

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(interaction)[0]?.components).toMatchObject([
            {
                components: [
                    {
                        custom_id: "setup_announce",
                        placeholder: `Channel for bot announcements (Current: #${NAMES.channel})`,
                    },
                ],
            },
            { components: [{ custom_id: "setup_log", placeholder: "Channel for errors and logs (Current: None)" }] },
            {
                components: [{ custom_id: "setup_archive", placeholder: "Channel for archived posts (Current: None)" }],
            },
            {
                components: [
                    { custom_id: "setup_timezone" },
                    { custom_id: "setup_confirm" },
                    { custom_id: "setup_cancel" },
                ],
            },
        ]);
    });

    test("/moviesetup acknowledges privately first, then offers the role and channel pickers showing the current choices", async ({
        discord,
        interact,
    }) => {
        const interaction = await interact(chatInputInteraction("moviesetup", [], AS.botAdmin));

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(interaction)[0]?.components).toMatchObject([
            {
                components: [
                    {
                        custom_id: "moviesetup_admin_role",
                        placeholder: `Role for movie admin commands (Current: @${NAMES.roles.movieAdmin})`,
                    },
                ],
            },
            {
                components: [
                    {
                        custom_id: "moviesetup_user_role",
                        placeholder: "Role notified for movie nights (Current: None)",
                    },
                ],
            },
            {
                components: [
                    {
                        custom_id: "moviesetup_channel",
                        placeholder: `Channel for movie night announcements (Current: #${NAMES.channel})`,
                    },
                ],
            },
            {
                components: [
                    {
                        custom_id: "moviesetup_voice_channel",
                        placeholder: "Voice channel for movie nights (Current: None)",
                    },
                ],
            },
            { components: [{ custom_id: "moviesetup_confirm" }, { custom_id: "moviesetup_cancel" }] },
        ]);
    });

    test("/tasksetup acknowledges privately first, then offers the role and channel pickers showing the current choices", async ({
        discord,
        interact,
    }) => {
        const interaction = await interact(chatInputInteraction("tasksetup", [], AS.botAdmin));

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(interaction)[0]?.components).toMatchObject([
            {
                components: [
                    {
                        custom_id: "tasksetup_admin_role",
                        placeholder: `Role for approving submissions (Current: @${NAMES.roles.taskAdmin})`,
                    },
                ],
            },
            {
                components: [
                    {
                        custom_id: "tasksetup_user_role",
                        placeholder: `Role notified about tasks (Current: @${NAMES.roles.taskUser})`,
                    },
                ],
            },
            {
                components: [
                    {
                        custom_id: "tasksetup_channel",
                        placeholder: `Channel for task posts (Current: #${NAMES.channel})`,
                    },
                ],
            },
            {
                components: [
                    {
                        custom_id: "tasksetup_verification_channel",
                        placeholder: `Channel for managing submissions (Current: #${NAMES.channel})`,
                    },
                ],
            },
            { components: [{ custom_id: "tasksetup_confirm" }, { custom_id: "tasksetup_cancel" }] },
        ]);
    });
});

describe("/setup choices", () => {
    test("saves the chosen channels and marks the core setup complete", async ({ discord, interact, services }) => {
        await interact(channelSelectInteraction("setup_announce", [CHANNELS.announce]));
        await interact(channelSelectInteraction("setup_log", [CHANNELS.log]));
        await interact(channelSelectInteraction("setup_archive", [CHANNELS.archive]));

        const confirm = await interact(buttonInteraction("setup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([
            {
                type: InteractionResponseType.UpdateMessage,
                data: expect.objectContaining({ content: expect.stringContaining("Setup complete!"), components: [] }),
            },
        ]);
        expect(await services.repos.guildRepo.getGuild(IDS.guild)).toMatchObject({
            channels: {
                announcements: CHANNELS.announce,
                botLog: CHANNELS.log,
                botArchive: CHANNELS.archive,
                taskChannel: IDS.channel,
            },
            setupComplete: { core: true, movie: true, task: true },
        });
    });

    test("lists what is still missing when confirmed too early", async ({ discord, interact }) => {
        await interact(channelSelectInteraction("setup_announce", [CHANNELS.announce]));

        const confirm = await interact(buttonInteraction("setup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "Please select: botLog, botArchive",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });

    test("discards the choices when cancelled", async ({ discord, interact }) => {
        await interact(channelSelectInteraction("setup_announce", [CHANNELS.announce]));

        const cancel = await interact(buttonInteraction("setup_cancel"));
        const confirm = await interact(buttonInteraction("setup_confirm"));

        expect(discord.callbacks(cancel)).toEqual([
            {
                type: InteractionResponseType.UpdateMessage,
                data: expect.objectContaining({ content: "Setup cancelled. No changes were made.", components: [] }),
            },
        ]);
        expect(discord.callbacks(confirm)).toEqual([
            expect.objectContaining({
                data: expect.objectContaining({ content: "Please select: announcements, botLog, botArchive" }),
            }),
        ]);
    });

    test("keeps one guild's choices separate from another's", async ({ discord, interact, otherGuild, commands }) => {
        await interact(channelSelectInteraction("setup_announce", [CHANNELS.announce]));

        const confirmElsewhere = await discord.sendInteraction(
            buttonInteraction("setup_confirm", undefined, { guild_id: IDS.otherGuild }),
        );
        await routeInteraction(confirmElsewhere, commands, otherGuild);

        expect(discord.callbacks(confirmElsewhere)).toEqual([
            expect.objectContaining({
                data: expect.objectContaining({ content: "Please select: announcements, botLog, botArchive" }),
            }),
        ]);
    });

    test("opens the timezone form and saves a recognised zone", async ({ discord, interact, services }) => {
        const button = await interact(buttonInteraction("setup_timezone"));
        expect(discord.modal(button)?.custom_id).toBe("setup_timezone_modal");

        const submit = await interact(
            modalSubmitInteraction("setup_timezone_modal", { timezone_input: "Australia/Melbourne" }),
        );

        expect(discord.callbacks(submit)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: expect.stringContaining("Timezone set to **Australia/Melbourne**"),
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        expect(await services.repos.guildRepo.getGuild(IDS.guild)).toMatchObject({
            timezone: "Australia/Melbourne",
            channels: guildFactory.build().channels,
        });
    });

    test("rejects a timezone it does not recognise", async ({ discord, interact, services }) => {
        const submit = await interact(modalSubmitInteraction("setup_timezone_modal", { timezone_input: "not a zone" }));

        expect(discord.callbacks(submit)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: expect.stringContaining("Could not recognise that timezone"),
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.timezone).toBe(guildFactory.build().timezone);
    });
});

describe("/moviesetup choices", () => {
    test("saves the movie roles and channels without touching other settings", async ({
        discord,
        interact,
        services,
    }) => {
        await interact(roleSelectInteraction("moviesetup_admin_role", [MOVIE_ADMIN_ROLE]));
        await interact(roleSelectInteraction("moviesetup_user_role", [MOVIE_USER_ROLE]));
        await interact(channelSelectInteraction("moviesetup_channel", [MOVIE_CHANNEL]));
        await interact(channelSelectInteraction("moviesetup_voice_channel", [MOVIE_VOICE_CHANNEL]));

        const confirm = await interact(buttonInteraction("moviesetup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([
            {
                type: InteractionResponseType.UpdateMessage,
                data: expect.objectContaining({
                    content: expect.stringContaining("Movie module setup complete!"),
                    components: [],
                }),
            },
        ]);
        expect(await services.repos.guildRepo.getGuild(IDS.guild)).toMatchObject({
            roles: guildFactory.build({ roles: { movieAdmin: MOVIE_ADMIN_ROLE, movieUser: MOVIE_USER_ROLE } }).roles,
            channels: guildFactory.build({ channels: { movieNight: MOVIE_CHANNEL, movieVC: MOVIE_VOICE_CHANNEL } })
                .channels,
        });
    });

    test("lists what is still missing when confirmed too early", async ({ discord, interact }) => {
        await interact(channelSelectInteraction("moviesetup_channel", [MOVIE_CHANNEL]));

        const confirm = await interact(buttonInteraction("moviesetup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "Please select: movieAdmin, movieUser, movieVC before confirming.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });
});

describe("/tasksetup choices", () => {
    test("saves the task roles, channels and leaderboard period", async ({ discord, interact, services }) => {
        await interact(roleSelectInteraction("tasksetup_admin_role", [TASK_ADMIN_ROLE]));
        await interact(roleSelectInteraction("tasksetup_user_role", [TASK_USER_ROLE]));
        await interact(channelSelectInteraction("tasksetup_channel", [TASK_CHANNEL]));
        await interact(channelSelectInteraction("tasksetup_verification_channel", [TASK_VERIFICATION_CHANNEL]));
        await interact(stringSelectInteraction("tasksetup_period_events", ["6"]));

        const confirm = await interact(buttonInteraction("tasksetup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([
            {
                type: InteractionResponseType.UpdateMessage,
                data: expect.objectContaining({
                    content: expect.stringContaining("Task module setup complete!"),
                    components: [],
                }),
            },
        ]);
        expect(await services.repos.guildRepo.getGuild(IDS.guild)).toMatchObject({
            roles: guildFactory.build({ roles: { taskAdmin: TASK_ADMIN_ROLE, taskUser: TASK_USER_ROLE } }).roles,
            channels: guildFactory.build({
                channels: { taskChannel: TASK_CHANNEL, taskVerification: TASK_VERIFICATION_CHANNEL },
            }).channels,
            taskSettings: { periodEvents: 6 },
        });
    });

    test("cancels without saving anything", async ({ discord, interact, services }) => {
        await interact(roleSelectInteraction("tasksetup_admin_role", [TASK_ADMIN_ROLE]));

        const cancel = await interact(buttonInteraction("tasksetup_cancel"));

        expect(discord.callbacks(cancel)).toEqual([
            {
                type: InteractionResponseType.UpdateMessage,
                data: expect.objectContaining({
                    content: "Task setup cancelled. No changes were made.",
                    components: [],
                }),
            },
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.roles).toEqual(guildFactory.build().roles);
    });
});

describe("GuildService", () => {
    test("serves a guild from its cache after the first read", async ({ repo, guilds, db }) => {
        await repo.initGuild(guildId, guildFactory.build({ timezone: "UTC" }));
        await guilds.get(guildId);

        await db.doc(`guilds/${guildId}`).update({ timezone: "Europe/London" });

        expect((await guilds.get(guildId))?.timezone).toBe("UTC");
        expect((await guilds.refresh(guildId))?.timezone).toBe("Europe/London");
    });

    test("merges an update onto the stored guild when it is not cached", async ({ repo, guilds }) => {
        await repo.initGuild(guildId, guildFactory.build());

        await guilds.update(guildId, { timezone: "Australia/Melbourne" });

        expect(await repo.getGuild(guildId)).toMatchObject({
            timezone: "Australia/Melbourne",
            roles: guildFactory.build().roles,
            channels: guildFactory.build().channels,
            setupComplete: guildFactory.build().setupComplete,
        });
    });

    test("keeps every other toggle and setting when one toggle changes", async ({ repo, guilds }) => {
        await repo.initGuild(
            guildId,
            guildFactory.build({
                toggles: { taskScheduler: false, leaguesEnabled: true, taskLeaderboard: false },
                timezone: "Australia/Melbourne",
            }),
        );
        await guilds.get(guildId);

        await guilds.updateToggle(guildId, "taskScheduler", true, admin);

        const expected = {
            toggles: { taskScheduler: true, leaguesEnabled: true, taskLeaderboard: false },
            timezone: "Australia/Melbourne",
        };
        expect(await guilds.get(guildId)).toMatchObject({ ...expected, updatedBy: admin });
        expect(await repo.getGuild(guildId)).toMatchObject(expected);
    });

    test("keeps existing toggles when other settings are updated", async ({ repo, guilds }) => {
        await repo.initGuild(
            guildId,
            guildFactory.build({ toggles: { taskScheduler: true, leaguesEnabled: false, taskLeaderboard: false } }),
        );

        await guilds.update(guildId, { timezone: "Europe/London" });

        expect((await repo.getGuild(guildId))?.toggles).toEqual({
            taskScheduler: true,
            leaguesEnabled: false,
            taskLeaderboard: false,
        });
    });

    test("loads every guild into the cache", async ({ repo, guilds, db }) => {
        await repo.initGuild(IDS.guild, guildFactory.build({ id: IDS.guild }));
        await repo.initGuild(IDS.otherGuild, guildFactory.build({ id: IDS.otherGuild }));

        const stored = (await guilds.getAll()).map((guild) => guild.id);
        expect(stored).toHaveLength(2);
        expect(stored).toEqual(expect.arrayContaining([IDS.guild, IDS.otherGuild]));
        await db.doc(`guilds/${IDS.guild}`).delete();
        expect(await guilds.get(IDS.guild)).toMatchObject({ id: IDS.guild });
    });

    test("creates a guild record only when one does not exist", async ({ repo, guilds }) => {
        await guilds.ensureExists(newGuild, admin);
        expect(await repo.getGuild(newGuild)).toMatchObject({
            id: newGuild,
            updatedBy: admin,
            setupComplete: { core: false },
        });

        await repo.initGuild(guildId, guildFactory.build({ timezone: "Australia/Melbourne" }));
        await guilds.ensureExists(guildId, IDS.user);
        expect(await repo.getGuild(guildId)).toMatchObject({
            timezone: "Australia/Melbourne",
            setupComplete: { core: true },
        });
    });
});

describe("GuildRepository", () => {
    beforeEach(() => {
        vi.stubEnv("BOT_MODE", "production");
    });

    test("only reads and writes the dev guild in dev mode", async ({ repo }) => {
        await repo.initGuild(IDS.guild, guildFactory.build({ timezone: "UTC" }));
        await repo.initGuild(IDS.otherGuild, guildFactory.build({ id: IDS.otherGuild }));
        vi.stubEnv("BOT_MODE", "dev");
        vi.stubEnv("DISCORD_GUILD_ID_DEV", IDS.otherGuild);

        expect((await repo.getAllGuilds()).map((guild) => guild.id)).toEqual([IDS.otherGuild]);
        expect(await repo.getGuild(IDS.guild)).toBeNull();

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await repo.updateGuild(IDS.guild, { timezone: "Australia/Melbourne" });
        expect(warn).toHaveBeenCalledWith(`[GuildRepository] Skipping update for guild ${IDS.guild} in dev mode.`);
        vi.stubEnv("BOT_MODE", "production");
        expect(await repo.getGuild(IDS.guild)).toMatchObject({ timezone: "UTC" });
    });

    test("reads the time of the last change back as a date", async ({ repo }) => {
        await repo.initGuild(IDS.guild, guildFactory.build());

        await repo.updateGuild(IDS.guild, { timezone: "Australia/Melbourne" });

        expect((await repo.getGuild(IDS.guild))?.updatedAt).toBeInstanceOf(Date);
    });
});
