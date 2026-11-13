import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { TaskCategory } from "../../../models/Task.js";
import { CATEGORY_ALL, buildTaskListPage, toCategoryFilter } from "../../tasks/TaskList.js";

const listtasks: Command = {
    name: "listtasks",
    description: "View the full task list with optional category filtering.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName("listtasks")
        .setDescription("View the full task list with optional category filtering.")
        .addStringOption((option) =>
            option
                .setName("category")
                .setDescription("Filter tasks by category.")
                .setRequired(false)
                .addChoices(
                    { name: "All", value: CATEGORY_ALL },
                    { name: TaskCategory.PvM, value: TaskCategory.PvM },
                    { name: TaskCategory.Skilling, value: TaskCategory.Skilling },
                    { name: TaskCategory.MinigameMisc, value: TaskCategory.MinigameMisc },
                    { name: TaskCategory.Leagues, value: TaskCategory.Leagues },
                )
        ),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const category = toCategoryFilter(interaction.options.getString("category"));
        await interaction.editReply(await buildTaskListPage(services, category, 0));
    },
};

export default listtasks;
