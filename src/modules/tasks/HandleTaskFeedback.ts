import { ButtonInteraction, MessageFlags } from "discord.js";
import type { TaskService } from "./TaskService.js";

export async function handleTaskFeedback(interaction: ButtonInteraction, tasks: TaskService) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const customId = interaction.customId;
        let direction: string | undefined;
        let taskId: string | undefined;
        let eventId: string | undefined;

        if (customId.includes("|")) {
            // New format: task-feedback|up|taskId|eventId
            const [prefix, parsedDirection, parsedTaskId, parsedEventId] = customId.split("|");
            if (prefix !== "task-feedback") {
                await interaction.editReply({ content: "Invalid feedback action." });
                return;
            }
            direction = parsedDirection;
            taskId = parsedTaskId;
            eventId = parsedEventId;
        } else {
            // Legacy format: task-feedback-up-${taskId}-${eventId}
            const parts = customId.split("-");
            if (parts.length < 5 || parts[0] !== "task" || parts[1] !== "feedback") {
                await interaction.editReply({ content: "Invalid feedback action." });
                return;
            }
            direction = parts[2];
            taskId = parts[3];
            const eventSuffix = parts.slice(4).join("-");
            if (!eventSuffix) {
                eventId = taskId;
            } else if (eventSuffix.startsWith(`${taskId}-`)) {
                // Some legacy buttons already embed the task id in the suffix.
                eventId = eventSuffix;
            } else {
                eventId = `${taskId}-${eventSuffix}`;
            }
        }

        if (!taskId || !eventId) {
            await interaction.editReply({ content: "Invalid task or event ID." });
            return;
        }

        if (direction !== "up" && direction !== "down") {
            await interaction.editReply({ content: "Unknown feedback type." });
            return;
        }

        const userId = interaction.user.id;
        const task = await tasks.repository.getTaskById(taskId);

        if (!task) {
            await interaction.editReply({ content: "Task not found." });
            return;
        }

        const previous = await tasks.repository.voteOnTaskOnce({ taskId, eventId, userId, vote: direction });
        let message: string;

        if (!previous) {
            // First time vote
            await tasks.incrementWeight(taskId, direction === "up" ? +1 : -1);
            message = "Thanks for your feedback!";
        } else if (previous === direction) {
            // Same vote again
            message = `You already gave this task a ${direction === "up" ? "👍" : "👎"}.`;
        } else {
            // Changed vote
            await tasks.incrementWeight(taskId, direction === "up" ? +2 : -2);
            message = "Feedback updated!";
        }
        await interaction.editReply({ content: message });
    } catch (err) {
        console.error("[TaskFeedback] File error:", err);
        await interaction.editReply({ content: "Error reading task data." });
    }
}
