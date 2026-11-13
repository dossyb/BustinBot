import {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    MessageFlags,
} from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { Skill, TaskCategory, TaskType } from "../../../models/Task.js";
import { nextTaskId, taskFormFields } from "../../tasks/TaskForm.js";
import { NEW_TASK_MODAL } from "../../tasks/HandleNewTaskModal.js";

const CATEGORY_CHOICES = [
    { name: `${TaskCategory.Skilling}: Gain XP or gather resources in a skill`, value: TaskCategory.Skilling },
    { name: `${TaskCategory.PvM}: Kill bosses or monsters, or get their drops`, value: TaskCategory.PvM },
    {
        name: `${TaskCategory.MinigameMisc}: Minigame points and rewards, pets, and anything else`,
        value: TaskCategory.MinigameMisc,
    },
    { name: `${TaskCategory.Leagues}: Tasks for the current Leagues`, value: TaskCategory.Leagues },
];

const newtask: Command = {
    name: "newtask",
    description: "Create a new task.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.TaskAdmin, CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("newtask")
        .setDescription("Create a new task.")
        .addStringOption((opt) =>
            opt
                .setName("category")
                .setDescription("The task category")
                .setRequired(true)
                .addChoices(...CATEGORY_CHOICES),
        )
        .addStringOption((opt) =>
            opt
                .setName("type")
                .setDescription("How completion is verified")
                .setRequired(true)
                .addChoices(...Object.values(TaskType).map((type) => ({ name: type, value: type }))),
        )
        .addStringOption((opt) =>
            opt
                .setName("skill")
                .setDescription("The skill, for skilling tasks")
                .setRequired(false)
                .addChoices(...Object.values(Skill).map((skill) => ({ name: skill, value: skill }))),
        ),

    async execute({ interaction, services }) {
        if (!interaction) return;

        const category = Object.values(TaskCategory).find(
            (value) => value === interaction.options.getString("category", true),
        );
        if (!category) {
            await interaction.reply({
                content: "Could not read the category. Please run /newtask again.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const type = interaction.options.getString("type", true);
        const skill = interaction.options.getString("skill") ?? "";
        const nextId = nextTaskId(await services.tasks.getAllTasks(), category);

        const modal = new ModalBuilder()
            .setCustomId(`${NEW_TASK_MODAL}${category}|${type}|${skill}`)
            .setTitle(`New ${category} task`);

        const id = new LabelBuilder()
            .setLabel("ID")
            .setDescription(
                nextId ? `Leave blank to use ${nextId}` : `No ${category} tasks to number from yet, so give one`,
            )
            .setTextInputComponent(
                new TextInputBuilder().setCustomId("id").setStyle(TextInputStyle.Short).setRequired(!nextId),
            );
        modal.addLabelComponents(...taskFormFields(), id);

        await interaction.showModal(modal);
    },
};

export default newtask;
