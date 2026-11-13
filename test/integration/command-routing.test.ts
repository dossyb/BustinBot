import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test, vi } from "../fixtures.js";
import { handleInteraction } from "../../src/core/events/onInteraction.js";
import { CommandRole } from "../../src/models/Command.js";
import {
    AS,
    DiscordError,
    IDS,
    NAMES,
    chatInputInteraction,
    apiBotUser,
    messageCreate,
    PRIVATE_DEFERRAL,
} from "../discord/payloads.js";
import { commandFactory } from "../factories.js";
import { handleMessage } from "../../src/core/events/onMessage.js";

const failing = commandFactory.build({
    name: "fail",
    execute: async () => {
        throw new Error("boom");
    },
});

describe("slash command routing", () => {
    test("recognises a role configured by name for a member Discord sends as role ids", async ({
        discord,
        services,
        uncachedGuild,
    }) => {
        await services.guilds.update(IDS.uncachedGuild, { roles: { admin: NAMES.roles.admin } });
        const interaction = await discord.sendInteraction(
            chatInputInteraction("probe", [], { ...uncachedGuild, ...AS.botAdmin }),
        );
        const ran = commandFactory.build({
            allowedRoles: [CommandRole.BotAdmin],
            execute: async ({ interaction: probe }) => {
                await probe?.reply({ content: "ran" });
            },
        });

        await handleInteraction(interaction, new Map([["probe", ran]]), services);

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({ content: "ran" }),
            },
        ]);
    });

    test("lets a BustinBot Admin Discord sends as role ids run /setup", async ({
        discord,
        services,
        commands,
        uncachedGuild,
    }) => {
        await services.guilds.update(IDS.uncachedGuild, { roles: { admin: NAMES.roles.admin } });
        const interaction = await discord.sendInteraction(
            chatInputInteraction("setup", [], { ...uncachedGuild, ...AS.botAdmin }),
        );

        await handleInteraction(interaction, commands, services);

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
    });

    test("refuses /setup to a member without the BustinBot Admin role", async ({
        discord,
        services,
        commands,
        uncachedGuild,
    }) => {
        await services.guilds.update(IDS.uncachedGuild, { roles: { admin: NAMES.roles.admin } });
        const interaction = await discord.sendInteraction(
            chatInputInteraction("setup", [], { ...uncachedGuild, ...AS.taskAdmin }),
        );

        await handleInteraction(interaction, commands, services);

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content:
                        "Only members with the **BustinBot Admin** role can run `/setup`. Please have a server admin create and assign this role first.",
                }),
            },
        ]);
    });

    test("replies privately when the command is unknown", async ({ discord, services }) => {
        const interaction = await discord.sendInteraction(chatInputInteraction("missing"));

        await handleInteraction(interaction, new Map(), services);

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({ content: "Command not found.", flags: MessageFlags.Ephemeral }),
            },
        ]);
    });

    test("refuses a role-restricted command to members without the role", async ({ discord, services }) => {
        const interaction = await discord.sendInteraction(chatInputInteraction("probe"));
        const execute = vi.fn();

        await handleInteraction(
            interaction,
            new Map([["probe", commandFactory.build({ execute, allowedRoles: [CommandRole.TaskAdmin] })]]),
            services,
        );

        expect(execute).not.toHaveBeenCalled();
        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "You don't have permission to use this command.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });

    test("tells members to run /setup before the bot is configured", async ({ discord, services }) => {
        const execute = vi.fn();
        await services.guilds.update(IDS.guild, {
            setupComplete: { core: false, movie: false, task: false },
        });
        const interaction = await discord.sendInteraction(chatInputInteraction("probe"));

        await handleInteraction(interaction, new Map([["probe", commandFactory.build({ execute })]]), services);

        expect(execute).not.toHaveBeenCalled();

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: expect.stringContaining("run `/setup`"),
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });

    test("replies with a private error when a command fails before responding", async ({ discord, services }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const interaction = await discord.sendInteraction(chatInputInteraction("probe"));

        await handleInteraction(
            interaction,
            new Map([
                [
                    "probe",
                    commandFactory.build({
                        execute: async () => {
                            throw new Error("boom");
                        },
                    }),
                ],
            ]),
            services,
        );

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "There was an error executing that command.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        expect(error).toHaveBeenCalledWith(
            "[Slash Command Error]: probe",
            expect.objectContaining({ message: "boom" }),
        );
    });

    test("turns the deferred reply into the error when a command fails after deferring", async ({
        discord,
        services,
    }) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const interaction = await discord.sendInteraction(chatInputInteraction("probe"));

        await handleInteraction(
            interaction,
            new Map([
                [
                    "probe",
                    commandFactory.build({
                        execute: async ({ interaction: probe }) => {
                            await probe?.deferReply({ flags: MessageFlags.Ephemeral });
                            throw new Error("boom");
                        },
                    }),
                ],
            ]),
            services,
        );

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "There was an error executing that command." }),
        ]);
        expect(discord.followUps(interaction)).toEqual([]);
    });
});

describe("prefix commands", () => {
    test("!goodbot replies with an emoji then posts the praise count", async ({ discord, prefix }) => {
        discord.acceptMessages(IDS.channel);
        const message = await prefix("!goodbot");

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({
                content: "🥹",
                message_reference: expect.objectContaining({ message_id: message.id }),
            }),
            expect.objectContaining({ content: "*BustinBot has been called a good bot 1 time!*" }),
        ]);
    });

    test("ignores messages without the prefix, from bots, or for unknown commands", async ({ discord, prefix }) => {
        await prefix("goodbot");
        await prefix("!goodbot", { author: apiBotUser() });
        await prefix("!unknown");

        expect(discord.requests).toEqual([]);
    });

    test("refuses a restricted command to members without the role", async ({ discord, prefix }) => {
        discord.acceptMessages(IDS.channel);
        await prefix("!sendas");

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: "You don't have permission to use this command." }),
        ]);
    });

    test("runs a restricted command for members with the role", async ({ discord, prefix }) => {
        discord.acceptMessages(IDS.channel);
        await prefix("!sendas", AS.botAdmin);

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: expect.stringContaining("replaced with a slash command") }),
        ]);
    });

    test("tells the member when a command fails", async ({ discord, services }) => {
        discord.acceptMessages(IDS.channel);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const message = await discord.sendMessage(messageCreate("!fail"));

        await handleMessage(message, new Map([["fail", failing]]), services);

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: "There was an error executing that command." }),
        ]);
        expect(error).toHaveBeenCalledWith("[Command Error]: fail", expect.objectContaining({ message: "boom" }));
    });

    test("survives Discord rejecting the error reply", async ({ discord, services }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        discord.refuse("POST", `/channels/${IDS.channel}/messages`, DiscordError.missingPermissions);
        const message = await discord.sendMessage(messageCreate("!fail"));

        await expect(handleMessage(message, new Map([["fail", failing]]), services)).resolves.toBeUndefined();
        expect(error).toHaveBeenCalledWith("[Command Error]: fail", expect.any(Error));
        expect(error).toHaveBeenCalledWith(
            "[Command Error]: fail: could not send the error reply",
            expect.objectContaining({ status: 403 }),
        );
    });
});
