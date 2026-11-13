import { TimestampStyles, time } from "discord.js";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test, vi, storePollableTasks } from "../fixtures.js";
import { AS, IDS, chatInputInteraction } from "../discord/payloads.js";

describe("/suppress", () => {
    test("stops the bot pinging roles for the given minutes", async ({ discord, interact, factories }) => {
        await storePollableTasks(factories);
        discord.acceptMessages(IDS.channel);
        vi.setSystemTime(new Date("2026-03-05T12:00:00Z"));

        const command = await interact(
            chatInputInteraction(
                "suppress",
                [{ type: ApplicationCommandOptionType.Integer, name: "minutes", value: 30 }],
                AS.botAdmin,
            ),
        );
        await interact(chatInputInteraction("taskpoll", [], AS.botAdmin));

        const until = new Date("2026-03-05T12:30:00Z");
        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: `Mention suppression enabled for **30** minutes. It will expire ${time(until, TimestampStyles.RelativeTime)} (${time(until, TimestampStyles.LongDateTime)}).`,
            }),
        ]);
        const [announcement] = discord.messagesSentTo(IDS.channel);
        expect(announcement).toMatchObject({
            content: "**New task polls are live!** Cast your votes for each category below:",
            allowed_mentions: { parse: [], users: [], roles: [] },
        });
    });
});
