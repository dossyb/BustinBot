import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { TaskCategory, TaskType } from "../../../models/Task.js";
import { buildTaskEventEmbed } from "../../tasks/TaskEmbeds.js";
import { isTextChannel } from "../../../utils/ChannelUtils.js";

const updatetask: Command = {
    name: 'updatetask',
    description: 'Update an existing task and its embed if currently active.',
    module: CommandModule.Task,
    allowedRoles: [CommandRole.TaskAdmin],

    slashData: new SlashCommandBuilder()
        .setName('updatetask')
        .setDescription('Update an existing task and its embed if currently active.')
        .addStringOption(opt =>
            opt.setName('id')
                .setDescription('The ID of the task to update (e.g. MIN001)')
                .setRequired(true)
        ),

    async execute({ interaction, services }) {
        if (!interaction) return;

        const taskId = interaction.options.getString('id', true);
        const repo = services.repos?.taskRepo;
        if (!repo) {
            await interaction.reply('Task repository unavailable.');
            return;
        }

        const task = await repo.getTaskById(taskId);
        if (!task) {
            await interaction.reply(`No task found with ID **${taskId}**.`);
            return;
        }

        // Build modal
        const modal = new ModalBuilder()
            .setCustomId(`update_task_modal_${task.id}`)
            .setTitle(`Update task: ${task.shortName ?? task.id}`);

        const nameInput = new TextInputBuilder()
            .setCustomId('taskName')
            .setLabel('Task Name')
            .setStyle(TextInputStyle.Short)
            .setValue(task.taskName)
            .setRequired(true);

        const typeInput = new TextInputBuilder()
            .setCustomId('type')
            .setLabel('Verification Type (XP, KC, Drop, etc.)')
            .setStyle(TextInputStyle.Short)
            .setValue(task.type)
            .setRequired(true);

        const bronzeInput = new TextInputBuilder()
            .setCustomId('bronze')
            .setLabel('Bronze Amount')
            .setStyle(TextInputStyle.Short)
            .setValue(task.amtBronze.toString() ?? '0')
            .setRequired(true);

        const silverInput = new TextInputBuilder()
            .setCustomId('silver')
            .setLabel('Silver Amount')
            .setStyle(TextInputStyle.Short)
            .setValue(task.amtSilver?.toString() ?? '0')
            .setRequired(true);

        const goldInput = new TextInputBuilder()
            .setCustomId('gold')
            .setLabel('Gold Amount')
            .setStyle(TextInputStyle.Short)
            .setValue(task.amtGold?.toString() ?? '0')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(typeInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(bronzeInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(silverInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(goldInput)
        );

        await interaction.showModal(modal);
    }
}

export default updatetask;