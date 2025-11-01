import { appendBustinEmote } from "../../../utils/EmoteHelper.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { SlashCommandBuilder } from "discord.js";

const bustincount: Command = {
    name: 'bustincount',
    description: 'Check how many times someone made the bot feel good.',
    module: CommandModule.Core,
    allowedRoles: [CommandRole.Everyone],
    slashData: new SlashCommandBuilder()
        .setName('bustincount')
        .setDescription('Check how many times someone made the bot feel good.'),
    async execute({ interaction, message, services }) {
        const stats = services?.botStats.getStats();
        const count = stats?.funStats.bustinCount ?? 0;
        const baseResponse = `The \`/bustin\` command has been used ${count} time${count !== 1 ? 's' : ''}.`;

        const guild = message?.guild ?? interaction?.guild ?? null;
        const response = appendBustinEmote(baseResponse, guild);

        if (interaction) await interaction.reply({ content: response, flags: 1 << 6 });
        else if (message) await message.reply(response);
    }
};

export default bustincount;