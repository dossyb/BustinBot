import type { Command } from '../../../models/Command';
import { CommandRole } from '../../../models/Command';
import { SlashCommandBuilder, TextChannel } from 'discord.js';

const goodbot: Command = {
    name: 'goodbot',
    description: 'Praise BustinBot.',
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('goodbot')
        .setDescription('Praise BustinBot.'),

    async execute({ interaction, message, services }) {
        const emoji = '🥹';
        await services?.botStats.incrementGoodBot();
        const count = services?.botStats.getGoodBotCount();

        const reply = `*BustinBot has been called a good bot ${count} time${count !== 1 ? 's' : ''}!*`;

        if (message) {
            await message.reply(emoji);
            if (message.channel instanceof TextChannel) {
                await message.channel.send(reply);
            }
            console.log(`${message.author.username} made BustinBot feel good!`);
        } else if (interaction) {
            await interaction.reply(`${emoji}\n${reply}`);
            console.log(`${interaction.user.username} made BustinBot feel good!`);
        }
    },
};

export default goodbot;