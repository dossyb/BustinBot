import type { Command } from "../../../models/Command";
import { CommandRole } from "../../../models/Command";
import { SlashCommandBuilder } from "discord.js";

const bustincount: Command = {
    name: 'bustincount',
    description: 'Check how many times someone made the bot feel good.',
    allowedRoles: [CommandRole.Everyone],
    slashData: new SlashCommandBuilder()
        .setName('bustincount')
        .setDescription('Check how many times someone made the bot feel good.'),
    async execute({ interaction, message, services }) {
        const stats = services?.botStats.getStats();
        const count = stats?.funStats.bustinCount ?? 0;
        const response = `The bustin command has been used ${count} time${count !== 1 ? 's' : ''}.`;

        if (interaction) await interaction.reply(response);
        else if (message) await message.reply(response);
    }
};

export default bustincount;