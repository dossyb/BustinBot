import type { ModalSubmitInteraction, TextChannel } from "discord.js";
import { buildTaskEventEmbed } from "./TaskEmbeds";
import { isTextChannel } from "utils/ChannelUtils";
import { TaskType } from "models/Task";
import { normaliseFirestoreDates } from "utils/DateUtils";
import type { ServiceContainer } from "core/services/ServiceContainer";

export async function handleUpdateTaskModal(interaction: ModalSubmitInteraction, services: ServiceContainer) {
    const repo = services.repos?.taskRepo;
    if (!repo) {
        await interaction.reply({ content: 'Task repository unavailable.', flags: 1 << 6 });
        return;
    }

    const taskId = interaction.customId.replace('update_task_modal_', '');
    const task = await repo.getTaskById(taskId);
    if (!task) {
        await interaction.reply({ content: `Could not find task with ID **${taskId}**.`, flags: 1 << 6 });
        return;
    }

    task.taskName = interaction.fields.getTextInputValue('taskName');
    task.type = interaction.fields.getTextInputValue('type') as TaskType;
    task.amtBronze = parseInt(interaction.fields.getTextInputValue('bronze')) || 0;
    task.amtSilver = parseInt(interaction.fields.getTextInputValue('silver')) || 0;
    task.amtGold = parseInt(interaction.fields.getTextInputValue('gold')) || 0;

    await repo.createTask(task);

    const activeEvent = await repo.getLatestTaskEvent();
    if (activeEvent && activeEvent.task.id === task.id && activeEvent.messageId && activeEvent.channelId) {
        activeEvent.task = task;
        activeEvent.amounts = {
            bronze: task.amtBronze,
            silver: task.amtSilver,
            gold: task.amtGold,
        }
        const event = normaliseFirestoreDates(activeEvent);

        const { embeds, components, files } = buildTaskEventEmbed(event);

        const channel = interaction.client.channels.cache.get(activeEvent.channelId) as TextChannel;
        if (channel && isTextChannel(channel)) {
            try {
                const message = await channel.messages.fetch(activeEvent.messageId);
                if (message) await message.edit({ embeds, components, files });
            } catch (err) {
                console.error('[HandleUpdateTaskModal] Failed to update active task event embed:', err);
            }
        }

        await repo.createTaskEvent(activeEvent);
    }

    await interaction.reply({
        content: `Task **${taskId}** updated successfully.`,
        flags: 1 << 6
    });
}