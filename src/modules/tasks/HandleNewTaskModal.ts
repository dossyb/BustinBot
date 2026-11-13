import { MessageFlags, type ModalSubmitInteraction } from "discord.js";
import { Skill, TaskCategory, TaskType, type Task } from "../../models/Task.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { AMOUNTS_ERROR, nextTaskId, parseAmounts } from "./TaskForm.js";
import { DEFAULT_TASK_WEIGHT } from "./TaskSelector.js";

export const NEW_TASK_MODAL = "new_task_modal|";

export async function handleNewTaskModal(interaction: ModalSubmitInteraction, services: ServiceContainer) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [rawCategory, rawType, rawSkill] = interaction.customId.slice(NEW_TASK_MODAL.length).split("|");
    const category = Object.values(TaskCategory).find((value) => value === rawCategory);
    const type = Object.values(TaskType).find((value) => value === rawType);
    const skill = Object.values(Skill).find((value) => value === rawSkill);
    if (!category || !type) {
        await interaction.editReply({ content: "Could not read the category or type. Please run /newtask again." });
        return;
    }

    const amounts = parseAmounts(interaction.fields.getTextInputValue("amounts"));
    if (!amounts) {
        await interaction.editReply({ content: `${AMOUNTS_ERROR} Nothing was saved.` });
        return;
    }

    const id =
        interaction.fields.getTextInputValue("id").trim() || nextTaskId(await services.tasks.getAllTasks(), category);
    if (!id) {
        await interaction.editReply({
            content: `There are no ${category} tasks to number from yet, so an ID is needed. Nothing was saved.`,
        });
        return;
    }

    const task: Task = {
        id,
        taskName: interaction.fields.getTextInputValue("taskName").trim(),
        shortName: interaction.fields.getTextInputValue("shortName").trim(),
        category,
        type,
        ...(skill && { skill }),
        ...amounts,
        weight: DEFAULT_TASK_WEIGHT,
    };
    if (!(await services.tasks.addTask(task))) {
        await interaction.editReply({ content: `Task **${id}** already exists. Nothing was saved.` });
        return;
    }

    await interaction.editReply({ content: `Task **${id}** created successfully.` });
}
