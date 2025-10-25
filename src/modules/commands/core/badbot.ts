import type { Command } from '../../../models/Command';
import { CommandModule, CommandRole } from '../../../models/Command';
import { SlashCommandBuilder, TextChannel } from 'discord.js';

const badbot: Command = {
    name: 'badbot',
    description: 'Criticize BustinBot.',
    module: CommandModule.Core,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('badbot')
        .setDescription('Criticize BustinBot.'),

    async execute({ interaction, message, services }) {
        const emoji = '😞';
        await services?.botStats.incrementBadBot();
        const count = services?.botStats.getBadBotCount();

        const reply = `*BustinBot has been called a bad bot ${count} time${count !== 1 ? 's' : ''}!*`;

        if (message) {
            await message.reply(emoji);
            if (message.channel instanceof TextChannel) {
                await message.channel.send(reply);
            }
            console.log(`${message.author.username} made BustinBot feel bad!`);
        } else if (interaction) {
            await interaction.reply(`${emoji}\n${reply}`);
            console.log(`${interaction.user.username} made BustinBot feel bad!`);
        }
    },
};

export default badbot;