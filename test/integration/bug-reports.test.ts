import { SnowflakeUtil } from "discord.js";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../fixtures.js";
import { IDS, NAMES, apiGuild, apiTextChannel, chatInputInteraction } from "../discord/payloads.js";

const DEV_SERVER = "1289517693313220699";

describe("/reportbug", () => {
    test("posts the report in the dev server's bug channel and thanks the member", async ({ discord, interact }) => {
        const bugReports = apiTextChannel({
            id: SnowflakeUtil.generate().toString(),
            guild_id: DEV_SERVER,
            name: "bug-reports",
        });
        discord.serveGuild(apiGuild({ id: DEV_SERVER }));
        discord.serveGuildChannels(DEV_SERVER, [
            apiTextChannel({ id: SnowflakeUtil.generate().toString(), guild_id: DEV_SERVER, name: "general" }),
            bugReports,
        ]);
        discord.acceptMessages(bugReports.id);

        const command = await interact(
            chatInputInteraction("reportbug", [
                { type: ApplicationCommandOptionType.String, name: "message", value: "/bustin didn't reply" },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Bug report sent. Thank you!" }),
        ]);
        const [report] = discord.messagesSentTo(bugReports.id);
        expect(report?.content).toMatch(
            new RegExp(
                [
                    "^🐞 \\*\\*New Bug Report\\*\\* 🐞",
                    "\\*\\*Bug ID:\\*\\* `BUG-[0-9A-Z]+-[0-9A-Z]{4}`",
                    "\\*\\*Timestamp:\\*\\* \\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z",
                    `\\*\\*Reporter:\\*\\* ${NAMES.username} \\(\\*${IDS.user}\\*\\)`,
                    `\\*\\*Server:\\*\\* ${NAMES.guild} \\(\\*${IDS.guild}\\*\\)`,
                    `\\*\\*Channel:\\*\\* #${NAMES.channel} \\(\\*${IDS.channel}\\*\\)`,
                    "\\*\\*Message:\\*\\* /bustin didn't reply$",
                ].join("\\n"),
            ),
        );
    });

    test("says so when the dev server has no bug channel", async ({ discord, interact }) => {
        discord.serveGuild(apiGuild({ id: DEV_SERVER }));
        discord.serveGuildChannels(DEV_SERVER, []);

        const command = await interact(
            chatInputInteraction("reportbug", [
                { type: ApplicationCommandOptionType.String, name: "message", value: "/bustin didn't reply" },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Bug report channel not found." }),
        ]);
    });
});
