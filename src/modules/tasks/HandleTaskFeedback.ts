import { ButtonInteraction } from 'discord.js';
import type { TaskFeedback } from '../../models/TaskFeedback.js';
import type { ITaskRepository } from '../../core/database/interfaces/ITaskRepo.js';

export async function handleTaskFeedback(interaction: ButtonInteraction, repo: ITaskRepository) {
    await interaction.deferReply({ flags: 1 << 6 });

    try {
        const customId = interaction.customId;
        let direction: string | undefined;
        let taskId: string | undefined;
        let eventId: string | undefined;

        let isLegacy = false;

        if (customId.includes('|')) {
            // New format: task-feedback|up|taskId|eventId
            const [prefix, parsedDirection, parsedTaskId, parsedEventId] = customId.split('|');
            if (prefix !== 'task-feedback') {
                await interaction.editReply({ content: 'Invalid feedback action.' });
                return;
            }
            direction = parsedDirection;
            taskId = parsedTaskId;
            eventId = parsedEventId;
        } else {
            // Legacy format: task-feedback-up-${taskId}-${eventId}
            const parts = customId.split('-');
            if (parts.length < 5 || parts[0] !== 'task' || parts[1] !== 'feedback') {
                await interaction.editReply({ content: 'Invalid feedback action.' });
                return;
            }
            direction = parts[2];
            taskId = parts[3];
            const eventSuffix = parts.slice(4).join('-');
            if (!eventSuffix) {
                eventId = taskId;
            } else if (eventSuffix.startsWith(`${taskId}-`)) {
                // Some legacy buttons already embed the task id in the suffix.
                eventId = eventSuffix;
            } else {
                eventId = `${taskId}-${eventSuffix}`;
            }
            isLegacy = true;
        }

        if (!taskId || !eventId) {
            await interaction.editReply({ content: 'Invalid task or event ID.' });
            return;
        }

        if (direction !== 'up' && direction !== 'down') {
            await interaction.editReply({ content: 'Unknown feedback type.' });
            return;
        }

        const userId = interaction.user.id;
        let task = await repo.getTaskById(taskId);

        if (!task) {
            await interaction.editReply({ content: 'Task not found.' });
            return;
        }

        const allFeedback = await repo.getFeedbackForTask(taskId);
        const existing = allFeedback.find(
            (entry) => entry.userId === userId && entry.taskId === taskId
        );
        let message: string;

        if (!existing) {
            // First time vote
            const feedback: TaskFeedback = { id: Date.now().toString(), taskId, eventId, userId, vote: direction };
            await repo.addFeedback(feedback);
            await repo.incrementWeight(taskId, direction === "up" ? +1 : -1);
            message = 'Thanks for your feedback!';
        } else if (existing.vote === direction) {
            // Same vote again
            message = `You already gave this task a ${direction === 'up' ? '👍' : '👎'} for this event.`;
        } else {
            // Changed vote
            existing.vote = direction;
            await repo.addFeedback(existing); 
            await repo.incrementWeight(taskId, direction === "up" ? +2 : -2);
            message = "Feedback updated!";
        }
        await interaction.editReply({ content: message });
    } catch (err) {
        console.error('[TaskFeedback] File error:', err);
        await interaction.editReply({ content: 'Error reading task data.' });
    }
}
