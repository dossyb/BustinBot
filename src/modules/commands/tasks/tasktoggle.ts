import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionCallback } from 'discord.js';
import type { Command } from '../../../models/Command';
import { CommandRole } from '../../../models/Command';
import { initTaskScheduler, stopTaskScheduler } from '../../tasks/TaskScheduler';

let schedulerRunning = false;

const tasktoggle: Command = {
    name: 'tasktoggle',
    description: 'Toggle the task scheduler on and off.',
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('tasktoggle')
        .setDescription('Toggle the task scheduler on and off.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;

        if (schedulerRunning) {
            stopTaskScheduler();
            schedulerRunning = false;
            await interaction.reply({ content: 'Task scheduler stopped.', flags: 1 << 6 });
        } else {
            initTaskScheduler(interaction.client);
            schedulerRunning = true;
            await interaction.reply({ content: 'Task scheduler started with current config.', flags: 1 << 6 });
        }
    }
};

export default tasktoggle;