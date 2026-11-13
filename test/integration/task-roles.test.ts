import { RESTJSONErrorCodes, ApplicationCommandOptionType } from "discord-api-types/v10";
import { SnowflakeUtil } from "discord.js";
import { addChampionRoles, championRoles, describe, expect, test, vi } from "../fixtures.js";
import { type DiscordHarness } from "../discord/harness.js";
import { type ServiceContainer } from "../../src/core/services/ServiceContainer.js";
import {
    DiscordError,
    IDS,
    apiGuildMember,
    apiRole,
    apiUser,
    AS,
    chatInputInteraction,
    subcommand,
} from "../discord/payloads.js";
import { milestoneRoleFactory } from "../factories.js";
import { applyTaskMilestoneRoles } from "../../src/modules/tasks/TaskMilestones.js";
import { awardTaskChampionRoles } from "../../src/modules/tasks/TaskLeaderboards.js";

const member = SnowflakeUtil.generate().toString();
async function setUpMilestoneRoles(discord: DiscordHarness, services: ServiceContainer) {
    const participant = apiRole({ name: "Task Participant" });
    const enthusiast = apiRole({ name: "Task Enthusiast" });
    const expert = apiRole({ name: "Task Expert" });
    for (const role of [participant, enthusiast, expert]) await discord.addRole(IDS.guild, role);
    await services.guilds.update(IDS.guild, {
        taskSettings: {
            milestoneRoles: [
                milestoneRoleFactory.build({ roleId: participant.id, label: participant.name, requiredSubmissions: 5 }),
                milestoneRoleFactory.build({ roleId: enthusiast.id, label: enthusiast.name, requiredSubmissions: 25 }),
                milestoneRoleFactory.build({ roleId: expert.id, label: expert.name, requiredSubmissions: 50 }),
            ],
        },
    });
    return { participant, enthusiast, expert };
}

const NEUTRAL = 0x95a5a6;

describe("milestone roles", () => {
    test("give a member the highest milestone they have reached, take the lower one away and tell them", async ({
        discord,
        services,
        factories,
    }) => {
        const { participant, enthusiast } = await setUpMilestoneRoles(discord, services);
        await factories.userStats.create({ userId: member, tasksCompletedBronze: 20, legacyTasksCompleted: 10 });
        discord.serveMember(IDS.guild, apiGuildMember({ user: { id: member }, roles: [participant.id] }));
        const dm = discord.acceptDirectMessages(apiUser({ id: member }));

        await applyTaskMilestoneRoles(discord.client, services, member);

        expect(discord.memberRoleChanges("PUT")).toEqual([{ member, role: enthusiast.id }]);
        expect(discord.memberRoleChanges("DELETE")).toEqual([{ member, role: participant.id }]);
        expect(discord.messagesSentTo(dm)).toEqual([
            expect.objectContaining({
                content: "You have earned the **Task Enthusiast** role for completing 25 tasks!",
            }),
        ]);
    });

    test("still give the role to a member who doesn't accept DMs", async ({ discord, services, factories }) => {
        const { participant } = await setUpMilestoneRoles(discord, services);
        await factories.userStats.create({ userId: member, tasksCompletedGold: 6 });
        discord.serveMember(IDS.guild, apiGuildMember({ user: { id: member } }));
        discord.refuseDirectMessages(apiUser({ id: member }));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        await applyTaskMilestoneRoles(discord.client, services, member);

        expect(discord.memberRoleChanges("PUT")).toEqual([{ member, role: participant.id }]);
        expect(warn).toHaveBeenCalledWith(
            `[TaskMilestones] Granted Task Participant to ${member} but couldn't DM them:`,
            expect.objectContaining({ code: RESTJSONErrorCodes.CannotSendMessagesToThisUser }),
        );
    });
});

describe("champion roles", () => {
    test("pass from last period's champions to this period's, and count each win", async ({
        discord,
        services,
        factories,
    }) => {
        const { first, second } = await addChampionRoles(discord, services);
        const previousChampion = SnowflakeUtil.generate().toString();
        const runnerUp = SnowflakeUtil.generate().toString();
        const endedPeriod = 3;
        await factories.periodicLeaderboard.create({
            period: { index: endedPeriod + 1 },
            champions: { first: [previousChampion] },
        });
        discord.serveMember(IDS.guild, apiGuildMember({ user: { id: previousChampion }, roles: [first.id] }));
        discord.serveMember(IDS.guild, apiGuildMember({ user: { id: member } }));
        discord.serveMember(IDS.guild, apiGuildMember({ user: { id: runnerUp } }));

        await awardTaskChampionRoles(
            discord.client,
            services,
            {
                first: [{ userId: member, points: 10 }],
                second: [{ userId: runnerUp, points: 8 }],
                third: [],
                winners: [
                    { userId: member, points: 10 },
                    { userId: runnerUp, points: 8 },
                ],
            },
            endedPeriod,
        );

        expect(discord.memberRoleChanges("DELETE")).toEqual([{ member: previousChampion, role: first.id }]);
        expect(discord.memberRoleChanges("PUT")).toEqual([
            { member, role: first.id },
            { member: runnerUp, role: second.id },
        ]);
        expect(await services.repos.userRepo.getUserById(member)).toMatchObject({ taskChampionFirsts: 1 });
        expect(await services.repos.userRepo.getUserById(runnerUp)).toMatchObject({ taskChampionSeconds: 1 });
        expect((await services.repos.taskLeaderboardRepo.getLeaderboard("periodic"))?.champions).toMatchObject({
            first: [member],
            second: [runnerUp],
            third: [],
            periodIndex: endedPeriod,
        });
    });
});

describe("/taskroles list", () => {
    test("shows the milestone thresholds and which champion roles are set", async ({ discord, interact }) => {
        discord.serveGuildRoles();

        const interaction = await interact(chatInputInteraction("taskroles", [subcommand("list")], AS.taskAdmin));

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "Task Roles",
                        description: [
                            "**Milestone Roles** (Enabled)",
                            "- Task Participant — 5 submissions",
                            "- Task Enthusiast — 25 submissions",
                            "- Task Expert — 50 submissions",
                            "- Task Master — 100 submissions",
                            "",
                            "**Champion Roles** (Enabled)",
                            "- 1st — Not set",
                            "- 2nd — Not set",
                            "- 3rd — Not set",
                        ].join("\n"),
                    }),
                ],
            }),
        ]);
    });
});

describe("/taskroles add", () => {
    test("creates a milestone role that doesn't exist yet and saves its threshold", async ({
        discord,
        interact,
        services,
    }) => {
        discord.serveGuildRoles();
        const legend = apiRole({ name: "Task Legend" });
        discord.acceptRoleCreation(IDS.guild, legend);

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [
                    subcommand("add", [
                        { type: ApplicationCommandOptionType.String, name: "role", value: "Task Legend" },
                        { type: ApplicationCommandOptionType.String, name: "type", value: "milestone" },
                        { type: ApplicationCommandOptionType.Integer, name: "value", value: 200 },
                    ]),
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Added milestone role **Task Legend** (200)." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.milestoneRoles).toContainEqual(
            milestoneRoleFactory.build({ roleId: legend.id, label: legend.name, requiredSubmissions: 200 }),
        );
    });

    test("rejects a milestone threshold of zero without creating a role", async ({ discord, interact }) => {
        discord.serveGuildRoles();

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [
                    subcommand("add", [
                        { type: ApplicationCommandOptionType.String, name: "role", value: "Task Legend" },
                        { type: ApplicationCommandOptionType.String, name: "type", value: "milestone" },
                        { type: ApplicationCommandOptionType.Integer, name: "value", value: 0 },
                    ]),
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Milestone thresholds must be greater than 0." }),
        ]);
        expect(discord.roleCreations(IDS.guild)).toEqual([]);
    });

    test("sets an existing role as a champion role", async ({ discord, interact, services }) => {
        const gold = apiRole({ name: "Gold Champion" });
        discord.serveGuildRoles([gold]);

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [
                    subcommand("add", [
                        { type: ApplicationCommandOptionType.String, name: "role", value: `<@&${gold.id}>` },
                        { type: ApplicationCommandOptionType.String, name: "type", value: "champion" },
                        { type: ApplicationCommandOptionType.Integer, name: "value", value: 1 },
                    ]),
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Set 1st place champion role to **Gold Champion**." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.roles.taskChampionFirst).toBe(gold.id);
    });

    test("rejects a champion placement other than 1 to 3 without creating a role", async ({ discord, interact }) => {
        discord.serveGuildRoles();

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [
                    subcommand("add", [
                        { type: ApplicationCommandOptionType.String, name: "role", value: "Fourth Place" },
                        { type: ApplicationCommandOptionType.String, name: "type", value: "champion" },
                        { type: ApplicationCommandOptionType.Integer, name: "value", value: 4 },
                    ]),
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Champion placement must be 1, 2, or 3." }),
        ]);
        expect(discord.roleCreations(IDS.guild)).toEqual([]);
    });
});

describe("/taskroles edit", () => {
    test("renames a milestone role and changes its threshold", async ({ discord, interact, services }) => {
        const expert = apiRole({ name: "Task Expert" });
        discord.serveGuildRoles([expert]);
        await services.guilds.update(IDS.guild, {
            taskSettings: {
                milestoneRoles: [
                    milestoneRoleFactory.build({ roleId: expert.id, label: expert.name, requiredSubmissions: 50 }),
                ],
            },
        });
        discord.acceptRoleEdit(IDS.guild, { ...expert, name: "Task Pro" });

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [
                    subcommand("edit", [
                        { type: ApplicationCommandOptionType.String, name: "role", value: `<@&${expert.id}>` },
                        { type: ApplicationCommandOptionType.String, name: "newrole", value: "Task Pro" },
                        { type: ApplicationCommandOptionType.Integer, name: "value", value: 60 },
                    ]),
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Updated milestone role **Task Pro** (60)." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.milestoneRoles).toEqual([
            {
                ...milestoneRoleFactory.build({ roleId: expert.id, label: expert.name, requiredSubmissions: 60 }),
                label: "Task Pro",
            },
        ]);
    });

    test("moves a champion role to another placement", async ({ discord, interact, services }) => {
        const gold = apiRole({ name: "Gold Champion" });
        discord.serveGuildRoles([gold]);
        await services.guilds.update(IDS.guild, { roles: { taskChampionFirst: gold.id } });

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [
                    subcommand("edit", [
                        { type: ApplicationCommandOptionType.String, name: "role", value: `<@&${gold.id}>` },
                        { type: ApplicationCommandOptionType.String, name: "newrole", value: "Gold Champion" },
                        { type: ApplicationCommandOptionType.Integer, name: "value", value: 2 },
                    ]),
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Updated champion role **Gold Champion** to 2nd place." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.roles).toMatchObject({
            taskChampionFirst: "",
            taskChampionSecond: gold.id,
        });
    });
});

describe("/taskroles delete", () => {
    test("removes a milestone role from the settings and deletes it from the server", async ({
        discord,
        interact,
        services,
    }) => {
        const expert = apiRole({ name: "Task Expert" });
        const master = apiRole({ name: "Task Master" });
        discord.serveGuildRoles([expert, master]);
        await services.guilds.update(IDS.guild, {
            taskSettings: {
                milestoneRoles: [
                    milestoneRoleFactory.build({ roleId: expert.id, label: expert.name, requiredSubmissions: 50 }),
                    milestoneRoleFactory.build({ roleId: master.id, label: master.name, requiredSubmissions: 100 }),
                ],
            },
        });
        discord.acceptRoleDeletion(IDS.guild, expert.id);

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [
                    subcommand("delete", [
                        { type: ApplicationCommandOptionType.String, name: "role", value: `<@&${expert.id}>` },
                    ]),
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Deleted milestone role **Task Expert**." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.milestoneRoles).toEqual([
            milestoneRoleFactory.build({ roleId: master.id, label: master.name, requiredSubmissions: 100 }),
        ]);
    });

    test("says so when Discord won't delete the role it stopped using", async ({ discord, interact, services }) => {
        const gold = apiRole({ name: "Gold Champion" });
        discord.serveGuildRoles([gold]);
        await services.guilds.update(IDS.guild, { roles: { taskChampionFirst: gold.id } });
        discord.refuse("DELETE", `/guilds/${IDS.guild}/roles/${gold.id}`, DiscordError.missingPermissions);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [
                    subcommand("delete", [
                        { type: ApplicationCommandOptionType.String, name: "role", value: `<@&${gold.id}>` },
                    ]),
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                content:
                    "Removed champion role **Gold Champion** (1st). It is no longer a task role, but I couldn't delete it from the server. Check my permissions, or delete it yourself.",
            }),
        ]);
        expect(warn).toHaveBeenCalledWith(
            "[TaskRoles] Failed to delete task role:",
            expect.objectContaining({ code: RESTJSONErrorCodes.MissingPermissions }),
        );
    });
});

describe("/taskroles toggle", () => {
    test("disables milestone roles", async ({ discord, interact, services }) => {
        discord.serveGuildRoles();

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [
                    subcommand("toggle", [
                        { type: ApplicationCommandOptionType.String, name: "type", value: "milestone" },
                        { type: ApplicationCommandOptionType.Boolean, name: "enabled", value: false },
                    ]),
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Disabled milestone roles." }),
        ]);
        expect(
            (await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.milestoneRoles?.every(
                (role) => !role.enabled,
            ),
        ).toBe(true);
    });

    test("disables champion roles and takes them off the current champions", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const gold = apiRole({ name: "Gold Champion" });
        discord.serveGuildRoles([gold]);
        await services.guilds.update(IDS.guild, { roles: { taskChampionFirst: gold.id } });
        await factories.periodicLeaderboard.create({ champions: { first: [member] } });
        discord.serveMember(IDS.guild, apiGuildMember({ user: { id: member, username: "champ" }, roles: [gold.id] }));

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [
                    subcommand("toggle", [
                        { type: ApplicationCommandOptionType.String, name: "type", value: "champion" },
                        { type: ApplicationCommandOptionType.Boolean, name: "enabled", value: false },
                    ]),
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Disabled champion roles." }),
        ]);
        expect(discord.memberRoleChanges("DELETE")).toEqual([{ member, role: gold.id }]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.taskSettings?.championRoles).toEqual({
            first: false,
            second: false,
            third: false,
        });
    });
});

describe("/taskroles grant", () => {
    test("gives a member a role", async ({ discord, interact }) => {
        const gold = apiRole({ name: "Gold Champion" });
        discord.serveGuildRoles([gold]);
        const target = apiUser({ id: member, username: "champ" });
        discord.serveMember(IDS.guild, apiGuildMember({ user: target }));

        const interaction = await interact(
            chatInputInteraction(
                "taskroles",
                [
                    subcommand("grant", [
                        { type: ApplicationCommandOptionType.User, name: "user", value: member },
                        { type: ApplicationCommandOptionType.Role, name: "role", value: gold.id },
                    ]),
                ],
                AS.taskAdmin,
                { users: { [member]: target }, roles: { [gold.id]: gold } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Granted **Gold Champion** to champ." }),
        ]);
        expect(discord.memberRoleChanges("PUT")).toEqual([{ member, role: gold.id }]);
    });
});

describe("/taskroles init", () => {
    test("creates the missing task roles and gives members the milestone role they have earned", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        discord.serveGuildRoles();
        const enthusiast = apiRole({ name: "Task Enthusiast" });
        const milestones = [
            apiRole({ name: "Task Participant" }),
            enthusiast,
            apiRole({ name: "Task Expert" }),
            apiRole({ name: "Task Master" }),
        ];
        const champions = championRoles();
        const created = [...milestones, champions.first, champions.second, champions.third];
        for (const role of created) discord.acceptRoleCreation(IDS.guild, role);
        await factories.userStats.create({ userId: member, tasksCompletedBronze: 20, legacyTasksCompleted: 10 });
        discord.serveMember(IDS.guild, apiGuildMember({ user: { id: member, username: "regular" } }));

        const interaction = await interact(chatInputInteraction("taskroles", [subcommand("init")], AS.taskAdmin));

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Task roles synced and granted to eligible users." }),
        ]);
        expect(discord.roleCreations(IDS.guild).map((role) => [role.name, role.colors?.primary_color])).toEqual([
            ["Task Participant", NEUTRAL],
            ["Task Enthusiast", NEUTRAL],
            ["Task Expert", NEUTRAL],
            ["Task Master", NEUTRAL],
            ["Task Champion (1st)", 0xffd700],
            ["Task Champion (2nd)", 0xc0c0c0],
            ["Task Champion (3rd)", 0xcd7f32],
        ]);
        expect(discord.memberRoleChanges("PUT")).toEqual([{ member, role: enthusiast.id }]);
        const stored = await services.repos.guildRepo.getGuild(IDS.guild);
        expect(stored?.taskSettings?.milestoneRoles?.map((role) => role.roleId)).toEqual(
            milestones.map((role) => role.id),
        );
        expect(stored?.roles).toMatchObject({
            taskChampionFirst: champions.first.id,
            taskChampionSecond: champions.second.id,
            taskChampionThird: champions.third.id,
        });
    });
});

describe("/taskroles with an option it doesn't know", () => {
    test("answers instead of leaving the reply pending", async ({ discord, interact }) => {
        discord.serveGuildRoles();

        const interaction = await interact(chatInputInteraction("taskroles", [subcommand("rename")], AS.taskAdmin));

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Unknown taskroles option." }),
        ]);
    });
});
