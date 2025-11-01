import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { startAllTaskEvents } from "../../tasks/HandleTaskStart.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";

const taskstart: Command = {
    name: 'taskstart',
    description: 'Manually start a task event.',
    module: CommandModule.Task,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('taskstart')
        .setDescription('Manually start a task event.'),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction, services: ServiceContainer }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: 1 << 6 });

        try {
            await startAllTaskEvents(interaction.client, services);
            await interaction.editReply('Task event started successfully.');
        } catch (error) {
            console.error('[TaskStart Command Error]', error);
            await interaction.editReply('Failed to start the task event. Check console for details.');
        }
    }
};

export default taskstart;