import { appendBustinEmote } from "../../../utils/EmoteHelper.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { SlashCommandBuilder } from "discord.js";

const bustin: Command = {
    name: 'bustin',
    description: 'Ping the bot to see if it is responsive.',
    module: CommandModule.Core,
    allowedRoles: [ CommandRole.Everyone ],
    slashData: new SlashCommandBuilder()
        .setName('bustin')
        .setDescription('Ping the bot to see if it is responsive (it makes him feel good).'),
    async execute({ message, interaction, services }) {
        const baseResponse = 'Bustin makes me feel good!';
        await services?.botStats.incrementBustin();
        
        const guild = message?.guild ?? interaction?.guild ?? null;
        const response = appendBustinEmote(baseResponse, guild);

        if (message) await message.reply(response);
        else if (interaction) await interaction.reply(response);
    },
};

export default bustin;