import { MessageFlags, type ModalSubmitInteraction } from "discord.js";
import { DateTime } from "luxon";
import { TaskCategory, TaskType, type Task } from "../../models/Task.js";
import type { TaskEvent } from "../../models/TaskEvent.js";
import type { ITaskRepository } from "../../core/database/interfaces/ITaskRepo.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { configuredChannel } from "../../utils/ChannelUtils.js";
import { generateTaskEventId, postTaskEvent, refreshTaskEventMessage } from "./HandleTaskStart.js";

export const MONIS_CHOICE_MODAL = "monis_choice_modal";

const WHOLE_NUMBER = /^\d+$/;

export async function runningTaskWeek(repo: ITaskRepository): Promise<{ regularEvents: TaskEvent[]; monisChoice: TaskEvent | undefined }> {
    const now = new Date();
    const running = await repo.getTaskEventsBetween(now, DateTime.fromJSDate(now).plus({ weeks: 1 }).toJSDate());

    return {
        regularEvents: running.filter((event) => event.category !== TaskCategory.MonisChoice),
        monisChoice: running.find((event) => event.category === TaskCategory.MonisChoice),
    };
}

export async function handleMonisChoiceModal(interaction: ModalSubmitInteraction, services: ServiceContainer) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const repo = services.repos.taskRepo;

    const taskName = interaction.fields.getTextInputValue("taskName").trim();
    const description = interaction.fields.getTextInputValue("description").trim();
    if (!taskName || !description) {
        await interaction.editReply({ content: "The task name and description can't be empty. Nothing was saved." });
        return;
    }

    const bronze = interaction.fields.getTextInputValue("bronze").trim();
    const silver = interaction.fields.getTextInputValue("silver").trim();
    const gold = interaction.fields.getTextInputValue("gold").trim();
    if (![bronze, silver, gold].every((amount) => WHOLE_NUMBER.test(amount))) {
        await interaction.editReply({ content: "The bronze, silver and gold amounts must be whole numbers. Nothing was saved." });
        return;
    }

    const { regularEvents, monisChoice } = await runningTaskWeek(repo);
    const [firstEvent] = regularEvents;
    if (!firstEvent) {
        await interaction.editReply({ content: "There are no weekly tasks running for Moni's Choice to end with. Nothing was saved." });
        return;
    }

    const task: Task = {
        id: "MONIS",
        taskName,
        description,
        category: TaskCategory.MonisChoice,
        type: TaskType.Other,
        amtBronze: Number(bronze),
        amtSilver: Number(silver),
        amtGold: Number(gold),
    };
    const amounts = { bronze: task.amtBronze, silver: task.amtSilver, gold: task.amtGold };

    if (monisChoice) {
        await repo.updateTaskEventTask(monisChoice.id, task, amounts);
        try {
            await refreshTaskEventMessage(interaction.client, { ...monisChoice, task, amounts });
        } catch (err) {
            console.error("[HandleMonisChoiceModal] Failed to update the Moni's Choice post:", err);
        }
        await interaction.editReply({ content: "Moni's Choice updated." });
        return;
    }

    const channel = await configuredChannel(interaction.client, services, "taskChannel");
    if (!channel) {
        await interaction.editReply({ content: "The task channel isn't set up, so Moni's Choice can't be posted. Nothing was saved." });
        return;
    }

    const event: TaskEvent = {
        id: generateTaskEventId(task.id),
        task,
        category: TaskCategory.MonisChoice,
        keyword: firstEvent.keyword,
        startTime: new Date(Math.min(...regularEvents.map((regularEvent) => regularEvent.startTime.getTime()))),
        endTime: new Date(Math.max(...regularEvents.map((regularEvent) => regularEvent.endTime.getTime()))),
        amounts,
        completionCounts: {
            bronze: 0,
            silver: 0,
            gold: 0
        },
        completedUserIds: [],
        createdAt: new Date(),
    };

    await postTaskEvent(services, channel, event);

    await interaction.editReply({ content: "Moni's Choice posted." });
}
