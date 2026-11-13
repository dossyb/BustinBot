import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    ComponentType,
    InteractionResponseType,
    MessageFlags,
    ApplicationCommandOptionType,
    ChannelType,
    RESTJSONErrorCodes,
} from "discord-api-types/v10";
import { describe, expect, test, vi } from "../fixtures.js";
import {
    AS,
    DiscordError,
    IDS,
    chatInputInteraction,
    apiResolvedChannel,
    PRIVATE_DEFERRAL,
} from "../discord/payloads.js";
import { packageVersion } from "../../src/utils/version.js";
import { SnowflakeUtil } from "discord.js";

const announcement = (
    JSON.parse(readFileSync(path.join(import.meta.dirname, "../../data/announcements.json"), "utf8")) as Record<
        string,
        { title: string }
    >
)[packageVersion];

describe("/announce", () => {
    test("posts this version's announcement in the announcement channel and confirms privately", async ({
        discord,
        interact,
    }) => {
        assert(announcement, `data/announcements.json has no announcement for ${packageVersion}`);
        discord.acceptMessages(IDS.channel);

        const interaction = await interact(chatInputInteraction("announce", [], AS.botAdmin));

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({
                flags: MessageFlags.IsComponentsV2,
                components: expect.arrayContaining([
                    expect.objectContaining({
                        type: ComponentType.Section,
                        components: [{ type: ComponentType.TextDisplay, content: announcement.title }],
                    }),
                ]),
            }),
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                content: `Announcement for **v${packageVersion}** posted in <#${IDS.channel}>.`,
            }),
        ]);
    });

    test("is refused to members who are not bot admins", async ({ discord, interact }) => {
        const interaction = await interact(chatInputInteraction("announce"));

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "You don't have permission to use this command.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
    });

    test("tells the admin when no announcement channel is configured", async ({ discord, interact, services }) => {
        await services.guilds.update(IDS.guild, { channels: { announcements: "" } });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const interaction = await interact(chatInputInteraction("announce", [], AS.botAdmin));

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Announcement channel not configured. Please run `/setup` first." }),
        ]);
        expect(warn).toHaveBeenCalledWith(
            `[Channels] The announcements channel (not set) of guild ${IDS.guild} isn't set or can't be reached.`,
        );
    });

    test("tells the admin when the configured channel can't be reached", async ({ discord, interact, services }) => {
        await services.guilds.update(IDS.guild, { channels: { announcements: IDS.missingChannel } });
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const interaction = await interact(chatInputInteraction("announce", [], AS.botAdmin));

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                content: `I can't reach the announcement channel <#${IDS.missingChannel}>. Check it still exists and that I can see it, or pick another with \`/setup\`.`,
            }),
        ]);
        expect(warn).toHaveBeenCalledWith(
            `[Channels] Discord refused the announcements channel ${IDS.missingChannel} of guild ${IDS.guild}:`,
            expect.objectContaining({ code: RESTJSONErrorCodes.UnknownChannel }),
        );
    });
});

describe("/sendas", () => {
    test("posts the message as the bot and confirms privately", async ({ discord, interact }) => {
        discord.acceptMessages(IDS.channel);

        const interaction = await interact(
            chatInputInteraction(
                "sendas",
                [
                    { type: ApplicationCommandOptionType.Channel, name: "channel", value: IDS.channel },
                    { type: ApplicationCommandOptionType.String, name: "message", value: "Hello, this is BustinBot!" },
                ],
                AS.botAdmin,
                { channels: { [IDS.channel]: apiResolvedChannel() } },
            ),
        );

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: "Hello, this is BustinBot!" }),
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: `Message sent in <#${IDS.channel}>.` }),
        ]);
    });

    test("is refused to members who are not bot admins", async ({ discord, interact }) => {
        const interaction = await interact(
            chatInputInteraction(
                "sendas",
                [
                    { type: ApplicationCommandOptionType.Channel, name: "channel", value: IDS.channel },
                    { type: ApplicationCommandOptionType.String, name: "message", value: "Hello" },
                ],
                {},
                { channels: { [IDS.channel]: apiResolvedChannel() } },
            ),
        );

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "You don't have permission to use this command.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
    });

    test("reports once when Discord won't post the message", async ({ discord, interact }) => {
        discord.refuse("POST", `/channels/${IDS.channel}/messages`, DiscordError.missingPermissions);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        const interaction = await interact(
            chatInputInteraction(
                "sendas",
                [
                    { type: ApplicationCommandOptionType.Channel, name: "channel", value: IDS.channel },
                    { type: ApplicationCommandOptionType.String, name: "message", value: "Hello" },
                ],
                AS.botAdmin,
                { channels: { [IDS.channel]: apiResolvedChannel() } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Failed to send message." }),
        ]);
        expect(error).toHaveBeenCalledWith(
            "Error sending message:",
            expect.objectContaining({ code: RESTJSONErrorCodes.MissingPermissions }),
        );
    });

    test("refuses a channel that can't hold messages", async ({ discord, interact }) => {
        const category = apiResolvedChannel({
            id: SnowflakeUtil.generate().toString(),
            type: ChannelType.GuildCategory,
            name: "Tasks",
        });

        const interaction = await interact(
            chatInputInteraction(
                "sendas",
                [
                    { type: ApplicationCommandOptionType.Channel, name: "channel", value: category.id },
                    { type: ApplicationCommandOptionType.String, name: "message", value: "Hello" },
                ],
                AS.botAdmin,
                { channels: { [category.id]: category } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Please select a valid text channel." }),
        ]);
    });
});
