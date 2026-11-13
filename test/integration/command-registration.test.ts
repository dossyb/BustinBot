import assert from "node:assert";
import { Routes } from "discord-api-types/v10";
import { describe, expect, test } from "../fixtures.js";
import { IDS } from "../discord/payloads.js";
import { commandFactory } from "../factories.js";
import type { Command } from "../../src/models/Command.js";
import { registerGlobalCommands } from "../../src/utils/registerCommands.js";

const globalCommands = Routes.applicationCommands(IDS.application);
const guildCommands = Routes.applicationGuildCommands(IDS.application, IDS.guild);

describe("registering the slash commands globally", () => {
    test("sends every command to Discord's global list and clears the guild's own copies", async ({
        discord,
        commands,
    }) => {
        discord.acceptCommandSync(globalCommands);
        discord.acceptCommandSync(guildCommands);

        await registerGlobalCommands(discord.client.rest, IDS.application, commands, IDS.guild);

        const [sent] = discord.commandUpdates(globalCommands);
        assert(sent);
        const expected = [...new Set([...commands.values()].map((command) => command.name))];
        expect(sent).toHaveLength(expected.length);
        expect(sent.map((command) => command.name)).toEqual(expect.arrayContaining(expected));
        expect(discord.commandUpdates(guildCommands)).toEqual([[]]);
    });

    test("leaves guild commands alone when no guild is given", async ({ discord, commands }) => {
        discord.acceptCommandSync(globalCommands);

        await registerGlobalCommands(discord.client.rest, IDS.application, commands, null);

        expect(discord.commandUpdates(globalCommands)).toHaveLength(1);
        expect(discord.commandUpdates(guildCommands)).toEqual([]);
    });

    test("sends a command registered under aliases only once", async ({ discord }) => {
        const bustin = commandFactory.build({ name: "bustin", aliases: ["ping"] });
        const commands = new Map([
            ["bustin", bustin],
            ["ping", bustin],
            ["goodbot", commandFactory.build({ name: "goodbot" })],
        ]);
        discord.acceptCommandSync(globalCommands);

        await registerGlobalCommands(discord.client.rest, IDS.application, commands, null);

        expect(discord.commandUpdates(globalCommands).map((sent) => sent.map((command) => command.name))).toEqual([
            ["bustin", "goodbot"],
        ]);
    });

    test("leaves out prefix-only commands", async ({ discord }) => {
        const { slashData: _, ...legacy } = commandFactory.build({ name: "legacy" });
        discord.acceptCommandSync(globalCommands);

        await registerGlobalCommands(
            discord.client.rest,
            IDS.application,
            new Map<string, Command>([["legacy", legacy]]),
            null,
        );

        expect(discord.commandUpdates(globalCommands)).toEqual([[]]);
    });
});
