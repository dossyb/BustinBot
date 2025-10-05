import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../../models/Command";
import { CommandRole } from "../../../models/Command";
import { startTaskEvent } from "../../tasks/HandleTaskStart";

const taskstart: Command = {
    name: 'taskstart',
    description: 'Manually start a task event.',
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('taskstart')
        .setDescription('Manually start a task event.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: 1 << 6 });

        try {
            await startTaskEvent(interaction.client);
            await interaction.editReply('Task event started successfully.');
        } catch (error) {
            console.error('[TaskStart Command Error]', error);
            await interaction.editReply('Failed to start the task event. Check console for details.');
        }
    }
};

export default taskstart;