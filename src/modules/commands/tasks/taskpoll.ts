import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../../models/Command';
import { CommandRole } from '../../../models/Command';
import { postTaskPoll } from '../../tasks/HandleTaskPoll';

const taskpoll: Command = {
    name: 'taskpoll',
    description: 'Manually trigger a task poll.',
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('taskpoll')
        .setDescription('Manually trigger the weekly task poll.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: 1 << 6 });

        try {
            await postTaskPoll(interaction.client);
            await interaction.editReply('Task poll posted successfully.');
        } catch (error) {
            console.error('[TaskPoll Command Error]', error);
            await interaction.editReply('Failed to post the task poll. Check console for details.');
        }
    }
};

export default taskpoll;