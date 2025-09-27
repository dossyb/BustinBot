import type { Command } from "../../../models/Command";
import { CommandRole } from "../../../models/Command";
import { SlashCommandBuilder } from "discord.js";
import { BotStatsService } from "../../../core/services/BotStatsService";

const bustin: Command = {
    name: 'bustin',
    description: 'Ping the bot to see if it is responsive.',
    allowedRoles: [ CommandRole.Everyone ],
    slashData: new SlashCommandBuilder()
        .setName('bustin')
        .setDescription('Ping the bot to see if it is responsive (it makes him feel good).'),
    async execute({ message, interaction }) {
        const response = 'Bustin makes me feel good!';
        BotStatsService.incrementBustin();
        if (message) await message.reply(response);
        else if (interaction) await interaction.reply(response);
    },
};

export default bustin;