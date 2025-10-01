import { ButtonInteraction } from 'discord.js';
import type { TaskFeedback } from '../../models/TaskFeedback';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function handleTaskFeedback(interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: 1 << 6 });

    try {
        const [_, __, direction, taskIdStr = ''] = interaction.customId.split('-');
        const taskId = parseInt(taskIdStr);
        if (isNaN(taskId)) {
            await interaction.editReply({ content: 'Invalid task ID.', flags: 1 << 6 });
            return;
        }

        if (direction !== 'up' && direction !== 'down') {
            await interaction.editReply({ content: 'Unknown feedback type.'});
            return;
        }

        const tasksPath = path.join(__dirname, '../../data/tasks.json');
        const feedbackPath = path.join(__dirname, '../../data/taskFeedback.json');

        const raw = fs.readFileSync(tasksPath, 'utf8');
        const tasks = JSON.parse(raw);
        const task = tasks.find((t: any) => t.id === taskId);
        if (!task) {
            await interaction.editReply({ content: 'Task not found.', flags: 1 << 6 });
            return;
        }

        let feedback: TaskFeedback[] = [];
        if (fs.existsSync(feedbackPath)) {
            feedback = JSON.parse(fs.readFileSync(feedbackPath, 'utf8'));
        }

        const userId = interaction.user.id;
        const key = `${userId}:${taskId}`;
        const existing = feedback.find(entry => entry.userId === userId && entry.taskId === taskId);
        const oldWeight = task.weight ?? 50;

        let message: string;

        if (!existing) {
            // First time vote
            feedback.push({ taskId, userId, vote: direction });
            task.weight = direction === 'up' ? Math.min(oldWeight + 1, 100) : Math.max(oldWeight - 1, 0);
            message = 'Thanks for your feedback!';
        } else if (existing.vote === direction) {
            // Same vote again
            message = `You already gave this task a ${direction === 'up' ? '👍' : '👎'}`;
        } else {
            // Changed vote
            existing.vote = direction;
            task.weight = direction === 'up' ? Math.min(oldWeight + 2, 100) : Math.max(oldWeight - 2, 0);
            message = `Feedback updated!`;
        }

        fs.writeFileSync(feedbackPath, JSON.stringify(feedback, null, 2));
        fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));

        await interaction.editReply({ content: message });
    } catch (err) {
        console.error('[TaskFeedback] File error:', err);
        await interaction.editReply({ content: 'Error reading task data.', flags: 1 << 6 });
    }
}