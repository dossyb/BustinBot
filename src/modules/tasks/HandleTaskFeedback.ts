import { ButtonInteraction } from 'discord.js';
import type { TaskFeedback } from '../../models/TaskFeedback';
import type { ITaskRepository } from '../../core/database/interfaces/ITaskRepo';

export async function handleTaskFeedback(interaction: ButtonInteraction, repo: ITaskRepository) {
    await interaction.deferReply({ flags: 1 << 6 });

    try {
        const parts = interaction.customId.split('-');
        const direction = parts[2];
        const taskId = parts.slice(3).join('-');

        if (!taskId) {
            await interaction.editReply({ content: 'Invalid task ID.', flags: 1 << 6 });
            return;
        }

        if (direction !== 'up' && direction !== 'down') {
            await interaction.editReply({ content: 'Unknown feedback type.'});
            return;
        }

        const userId = interaction.user.id;
        const task = await repo.getTaskById(taskId);
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
            const feedback: TaskFeedback = { id: Date.now().toString(), taskId, userId, vote: direction };
            await repo.addFeedback(feedback);
            await repo.incrementWeight(taskId, direction === "up" ? +1 : -1);
            message = 'Thanks for your feedback!';
        } else if (existing.vote === direction) {
            // Same vote again
            message = `You already gave this task a ${direction === 'up' ? '👍' : '👎'}`;
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
        await interaction.editReply({ content: 'Error reading task data.', flags: 1 << 6 });
    }
}