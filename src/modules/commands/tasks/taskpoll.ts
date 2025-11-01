import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../../models/Command';
import { CommandModule, CommandRole } from '../../../models/Command';
import { postAllTaskPolls } from '../../tasks/HandleTaskPoll';
import type { ServiceContainer } from '../../../core/services/ServiceContainer';

const taskpoll: Command = {
    name: 'taskpoll',
    description: 'Manually trigger a task poll.',
    module: CommandModule.Task,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('taskpoll')
        .setDescription('Manually trigger the weekly task poll.'),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction, services: ServiceContainer }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: 1 << 6 });

        try {
            await postAllTaskPolls(interaction.client, services);
            await interaction.editReply('Task poll posted successfully.');
        } catch (error) {
            console.error('[TaskPoll Command Error]', error);
            await interaction.editReply('Failed to post the task poll. Check console for details.');
        }
    }
};

export default taskpoll;