import {
    SlashCommandBuilder,
    ChatInputCommandInteraction
} from 'discord.js';
import type { Command } from '../../../models/Command.js';
import { CommandModule, CommandRole } from '../../../models/Command.js';
import {
    initTaskScheduler,
    stopTaskScheduler
} from '../../tasks/TaskScheduler.js';
import type { ServiceContainer } from '../../../core/services/ServiceContainer.js';

const tasktoggle: Command = {
    name: 'tasktoggle',
    description: 'Toggle the task scheduler on and off.',
    module: CommandModule.Task,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('tasktoggle')
        .setDescription('Toggle the task scheduler on and off.'),

    async execute({
        interaction,
        services,
    }: {
        interaction?: ChatInputCommandInteraction;
        services?: ServiceContainer;
    }) {
        if (!interaction || !services) return;

        const guildId = interaction.guildId!;
        const guildService = services.guilds;

        // Fetch the latest guild config from Firestore
        const guildConfig = await guildService.get(guildId);
        const currentState = guildConfig?.toggles.taskScheduler ?? false;

        const newState = !currentState;

        await guildService.updateToggle(
            guildId,
            "toggles.taskScheduler",
            newState,
            interaction.user.id
        );

        if (newState) {
            // Enable scheduler
            initTaskScheduler(interaction.client, services);
            await interaction.reply({
                content: `✅ Task scheduler **enabled** and started for this guild.`,
                flags: 1 << 6,
            });
        } else {
            // Disable scheduler
            stopTaskScheduler();
            await interaction.reply({
                content: `⏹️ Task scheduler **disabled** and stopped for this guild.`,
                flags: 1 << 6,
            });
        }
    },
};

export default tasktoggle;
