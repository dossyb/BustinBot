import type { ModalSubmitInteraction, TextChannel } from "discord.js";
import { buildTaskEventEmbed } from "./TaskEmbeds";
import { isTextChannel } from "utils/ChannelUtils";
import { TaskCategory, TaskType } from "models/Task";
import { normaliseFirestoreDates } from "utils/DateUtils";
import type { ServiceContainer } from "core/services/ServiceContainer";
import { refreshTaskPollMessage, syncActivePollSelection } from "./HandleTaskPoll";

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

        let channel = interaction.client.channels.cache.get(activeEvent.channelId) as TextChannel | undefined;
        if (!channel) {
            const fetched = await interaction.client.channels.fetch(activeEvent.channelId).catch(() => null);
            channel = fetched && fetched.isTextBased() ? (fetched as TextChannel) : undefined;
        }

        if (!channel || !isTextChannel(channel)) {
            console.warn(`[HandleUpdateTaskModal] Could not resolve text channel ${activeEvent.channelId} for live embed update.`);
        } else {
            try {
                const message = await channel.messages.fetch(activeEvent.messageId);
                if (message) await message.edit({ embeds, components, files });
            } catch (err) {
                console.error('[HandleUpdateTaskModal] Failed to update active task event embed:', err);
            }
        }

        await repo.createTaskEvent(activeEvent);
    }

    if (task.category) {
        const activePoll = await repo.getActiveTaskPollByCategory(task.category as TaskCategory);
        if (activePoll?.options?.some(option => option.id === task.id)) {
            activePoll.options = activePoll.options.map(option =>
                option.id === task.id ? { ...option, ...task } : option
            );
            await repo.createTaskPoll(activePoll);
            syncActivePollSelection(activePoll.messageId, task);
            try {
                await refreshTaskPollMessage(interaction.client, activePoll);
            } catch (err) {
                console.error('[HandleUpdateTaskModal] Failed to refresh active task poll embed:', err);
            }
        }
    }

    await interaction.reply({
        content: `Task **${taskId}** updated successfully.`,
        flags: 1 << 6
    });
}
